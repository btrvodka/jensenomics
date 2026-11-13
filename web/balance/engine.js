// Движок игры «Удержи экономику»: тетрис на палке Хуанга.
// Чистая логика без DOM: сетка, падающая плитка, сброс, линии, крен и крах.
// Работает и в браузере (window.BalanceEngine), и в node (require).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BalanceEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Те же бумаги и примерные капитализации, что в tickers.go (млрд $).
  const TICKERS = [
    ['NVDA', 'chips', 4500], ['AVGO', 'chips', 1600], ['TSM', 'chips', 1500], ['AMD', 'chips', 400],
    ['ASML', 'chips', 400], ['MU', 'chips', 260], ['INTC', 'chips', 180], ['QCOM', 'chips', 180],
    ['AMAT', 'chips', 190], ['LRCX', 'chips', 190], ['KLAC', 'chips', 150], ['ARM', 'chips', 160],
    ['TXN', 'chips', 150], ['ADI', 'chips', 120], ['MRVL', 'chips', 75], ['SMCI', 'chips', 25],
    ['AAPL', 'megacaps', 4000], ['MSFT', 'megacaps', 3700], ['GOOGL', 'megacaps', 3400], ['AMZN', 'megacaps', 2400],
    ['META', 'megacaps', 1600], ['TSLA', 'megacaps', 1400], ['NFLX', 'megacaps', 470], ['UBER', 'megacaps', 190],
    ['SHOP', 'megacaps', 200], ['SPOT', 'megacaps', 130],
    ['ORCL', 'software', 700], ['PLTR', 'software', 420], ['SAP', 'software', 300], ['CRM', 'software', 230],
    ['NOW', 'software', 180], ['APP', 'software', 200], ['ADBE', 'software', 140], ['PANW', 'software', 140],
    ['CRWD', 'software', 130], ['SNOW', 'software', 85], ['NET', 'software', 75], ['CDNS', 'software', 90],
    ['SNPS', 'software', 70], ['DDOG', 'software', 55], ['COIN', 'software', 80],
    ['CSCO', 'hardware', 280], ['IBM', 'hardware', 290], ['ANET', 'hardware', 170], ['DELL', 'hardware', 90],
    ['VRT', 'hardware', 60], ['WDC', 'hardware', 50], ['STX', 'hardware', 50], ['HPE', 'hardware', 30],
    ['CRWV', 'hardware', 50], ['NBIS', 'hardware', 25],
  ].map(([symbol, group, cap]) => ({ symbol, group, cap, changePct: 0, live: false }));

  // Сторона квадрата в клетках: мегакэпы 3×3, крупные 2×2, остальные 1×1.
  const sizeFor = (cap) => (cap >= 2000 ? 3 : cap >= 300 ? 2 : 1);
  // Вес растёт с капитализацией, но мягче неё: NVDA ≈ 6,7, мелочь ≈ 0,5–1,4.
  const massFor = (cap) => Math.sqrt(cap / 100);
  // Множитель за одновременные линии, как в тетрисе.
  const LINE_MULT = [0, 1, 2.5, 4, 6];

  function rngFrom(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function createGame(opts) {
    opts = opts || {};
    const W = opts.W || 10;
    const H = opts.H || 18;
    const cfg = {
      K: opts.K || 200, // «сила Хуанга»: насколько палка возвращает мир в равновесие
      crit: opts.crit || 0.3, // крен, после которого мир слетает (рад, ≈ 17°)
      h0: 0.6, // толщина подставки над точкой опоры, в клетках
      I0: 30, // инерция пустой подставки
      damp: 0.45, // доля критического демпфирования: мир покачивается, но успокаивается
      wobble: opts.wobble == null ? 1 : opts.wobble, // множитель «рынок штормит»
    };
    const rand = rngFrom(opts.seed == null ? (Date.now() & 0xffffffff) : opts.seed);
    let tickers = (opts.tickers || TICKERS).map((t) => Object.assign({}, t));

    const g = {
      W, H, cfg,
      cells: [], // cells[row][col] = null | id блока; row 0 — нижний ряд на подставке
      blocks: new Map(), // id → { id, symbol, cap, changePct, live, size, mass, cellMass, cellCap, left }
      piece: null, // падающая плитка: { symbol, cap, size, mass, x, y, ... }
      next: null,
      theta: 0, omega: 0, time: 0,
      banked: 0, // зафиксированная капитализация (очки), млрд $
      lines: 0, level: 1, placed: 0,
      over: false, crashPct: 0, crashReason: '',
      kMul: 1, // «палка» слабее или сильнее от NVDA за день
      events: [],
      fallAcc: 0, soft: false, lastSymbol: '',
    };
    let nextId = 1;

    function reset() {
      g.cells = [];
      for (let r = 0; r < H; r++) g.cells.push(new Array(W).fill(null));
      g.blocks.clear();
      g.theta = 0; g.omega = 0; g.time = 0;
      g.banked = 0; g.lines = 0; g.level = 1; g.placed = 0;
      g.over = false; g.crashPct = 0; g.crashReason = '';
      g.events = []; g.fallAcc = 0; g.soft = false;
      g.next = draw();
      spawn();
    }

    function setQuotes(quotes) {
      const bySym = new Map((quotes || []).map((q) => [q.symbol, q]));
      tickers = tickers.map((t) => {
        const q = bySym.get(t.symbol);
        return q ? Object.assign({}, t, { cap: q.cap || t.cap, changePct: q.changePct || 0, live: !!q.live }) : t;
      });
      const nvda = bySym.get('NVDA');
      // NVDA за день −5% → палка на 20% слабее, +5% → на 10% крепче.
      g.kMul = nvda && nvda.live ? Math.max(0.8, Math.min(1.1, 1 + nvda.changePct / 25)) : 1;
    }

    function draw() {
      let t;
      for (let i = 0; i < 4; i++) {
        t = tickers[Math.floor(rand() * tickers.length)];
        if (t.symbol !== g.lastSymbol) break;
      }
      g.lastSymbol = t.symbol;
      const size = sizeFor(t.cap);
      return {
        symbol: t.symbol, group: t.group, cap: t.cap, changePct: t.changePct, live: t.live,
        size, mass: massFor(t.cap),
      };
    }

    function fits(x, y, s) {
      if (x < 0 || x + s > W || y < 0) return false;
      for (let r = y; r < y + s; r++) {
        if (r >= H) continue; // выше поля — свободно
        for (let c = x; c < x + s; c++) if (g.cells[r][c] !== null) return false;
      }
      return true;
    }

    function landingY(x, s) {
      let y = g.piece ? g.piece.y : H - s;
      if (!fits(x, y, s)) return -1;
      while (y > 0 && fits(x, y - 1, s)) y--;
      return y;
    }

    function spawn() {
      const p = g.next;
      g.next = draw();
      p.x = Math.floor((W - p.size) / 2);
      p.y = H - p.size;
      g.piece = p;
      g.fallAcc = 0;
      if (!fits(p.x, p.y, p.size)) {
        crash('top');
        return;
      }
      g.events.push({ type: 'spawn', piece: p });
    }

    // Суммы для физики: момент от сдвига (tau0), момент от высоты (S), инерция (I).
    function sums(extra) {
      let tau0 = 0, S = 0, I = cfg.I0, mass = 0;
      const add = (col, row, m) => {
        const dx = col + 0.5 - W / 2;
        const dy = row + 0.5 + cfg.h0;
        tau0 += m * dx; S += m * dy; I += m * (dx * dx + dy * dy); mass += m;
      };
      for (let r = 0; r < H; r++) {
        for (let c = 0; c < W; c++) {
          const id = g.cells[r][c];
          if (id !== null) add(c, r, g.blocks.get(id).cellMass);
        }
      }
      if (extra) {
        const m = extra.mass / (extra.size * extra.size);
        for (let r = extra.y; r < extra.y + extra.size; r++)
          for (let c = extra.x; c < extra.x + extra.size; c++) add(c, r, m);
      }
      return { tau0, S, I, mass };
    }

    // Крен, в котором мир застынет: K·θ = τ0·cosθ + S·sinθ. null — равновесия нет, мир упадёт.
    function equilibrium(s) {
      const K = cfg.K * g.kMul;
      if (s.S >= K) return null;
      let th = s.tau0 / (K - s.S);
      for (let i = 0; i < 40; i++) {
        const f = K * th - s.tau0 * Math.cos(th) - s.S * Math.sin(th);
        const df = K + s.tau0 * Math.sin(th) - s.S * Math.cos(th);
        if (Math.abs(df) < 1e-9) break;
        const nt = th - f / df;
        if (Math.abs(nt - th) < 1e-7) { th = nt; break; }
        th = nt;
      }
      return Math.abs(th) > cfg.crit ? null : th;
    }

    // Что будет, если сбросить текущую плитку в колонку x: где ляжет и какой станет крен.
    function predict(x) {
      const p = g.piece;
      if (!p || g.over) return null;
      x = Math.max(0, Math.min(W - p.size, x == null ? p.x : x));
      const y = landingY(x, p.size);
      if (y < 0) return null;
      const s = sums({ x, y, size: p.size, mass: p.mass });
      const th = equilibrium(s);
      return { x, y, theta: th, fall: th === null, danger: th === null ? 1 : Math.abs(th) / cfg.crit };
    }

    function move(dx) {
      const p = g.piece;
      if (!p || g.over) return false;
      if (fits(p.x + dx, p.y, p.size)) { p.x += dx; g.events.push({ type: 'move' }); return true; }
      return false;
    }

    function moveTo(x) {
      const p = g.piece;
      if (!p || g.over) return false;
      x = Math.max(0, Math.min(W - p.size, x));
      let moved = false;
      while (p.x !== x && move(Math.sign(x - p.x))) moved = true;
      return moved;
    }

    function lock(dropRows) {
      const p = g.piece;
      const id = nextId++;
      const n = p.size * p.size;
      g.blocks.set(id, {
        id, symbol: p.symbol, group: p.group, cap: p.cap, changePct: p.changePct, live: p.live,
        size: p.size, mass: p.mass, cellMass: p.mass / n, cellCap: p.cap / n, left: n,
      });
      for (let r = p.y; r < p.y + p.size; r++) {
        if (r >= H) continue;
        for (let c = p.x; c < p.x + p.size; c++) g.cells[r][c] = id;
      }
      g.placed++;
      // «Дивиденды» за удачную посадку: 10% капитализации сразу в копилку.
      g.banked += p.cap * 0.1;
      // Удар при посадке раскачивает мир: чем тяжелее, дальше от центра и выше падала, тем сильнее.
      const s = sums();
      const dx = p.x + p.size / 2 - W / 2;
      g.omega += (p.mass * dx * 0.12 * (1 + Math.min(dropRows, H) / H)) / s.I;
      g.events.push({ type: 'land', piece: p, id, dropRows, heavy: p.mass / massFor(4500) });
      g.piece = null;
      clearLines();
      if (!g.over) spawn();
    }

    function clearLines() {
      const full = [];
      for (let r = 0; r < H; r++) if (g.cells[r].every((v) => v !== null)) full.push(r);
      if (!full.length) return;
      let cap = 0;
      const syms = new Set();
      const gone = []; // клетки, которые исчезли: для анимации
      for (const r of full) {
        for (let c = 0; c < W; c++) {
          const id = g.cells[r][c];
          const b = g.blocks.get(id);
          gone.push({ r, c, symbol: b.symbol, changePct: b.changePct, live: b.live });
          cap += b.cellCap; b.left--; syms.add(b.symbol);
          if (b.left <= 0) g.blocks.delete(id);
        }
      }
      // Удаляем ряды сверху вниз и сдвигаем всё выше вниз — как в тетрисе.
      for (let i = full.length - 1; i >= 0; i--) {
        g.cells.splice(full[i], 1);
        g.cells.push(new Array(W).fill(null));
      }
      const mult = LINE_MULT[Math.min(full.length, LINE_MULT.length - 1)];
      const gain = cap * mult;
      g.banked += gain;
      g.lines += full.length;
      g.level = 1 + Math.floor(g.lines / 8);
      g.events.push({ type: 'lines', rows: full, count: full.length, gain, mult, symbols: [...syms], cells: gone });
    }

    function boardCap() {
      let cap = 0;
      for (const b of g.blocks.values()) cap += b.cellCap * b.left;
      return cap;
    }

    function crash(reason) {
      if (g.over) return;
      const lost = boardCap();
      const total = lost + g.banked;
      g.over = true;
      g.crashReason = reason;
      g.crashPct = total > 0 ? (lost / total) * 100 : 0;
      g.events.push({ type: 'crash', reason, pct: g.crashPct, lost, banked: g.banked, theta: g.theta });
    }

    function hardDrop() {
      const p = g.piece;
      if (!p || g.over) return;
      const y = landingY(p.x, p.size);
      const rows = p.y - y;
      p.y = y;
      lock(rows);
    }

    function stepDown() {
      const p = g.piece;
      if (!p) return;
      if (fits(p.x, p.y - 1, p.size)) { p.y--; return; }
      lock(0);
    }

    function gravityMs() {
      return Math.max(110, 800 * Math.pow(0.85, g.level - 1));
    }

    function physics(dt) {
      const s = sums();
      const K = cfg.K * g.kMul;
      const c = cfg.damp * 2 * Math.sqrt(K * s.I);
      // Рынок штормит: лёгкое покачивание, сильнее при большой волатильности.
      const vol = tickers.reduce((a, t) => a + Math.abs(t.changePct), 0) / tickers.length;
      const dist = cfg.wobble * (0.6 + vol * 0.5) * Math.sin(g.time * 1.3) * Math.sin(g.time * 0.47 + 1);
      const torque = s.tau0 * Math.cos(g.theta) + s.S * Math.sin(g.theta) + dist - K * g.theta - c * g.omega;
      g.omega += (torque / s.I) * dt;
      g.theta += g.omega * dt;
      if (Math.abs(g.theta) > cfg.crit) crash('tilt');
    }

    // dt в секундах. Гравитация плитки и физика крена подшагами по 1/120 с.
    function tick(dt) {
      if (g.over) return;
      dt = Math.min(dt, 0.1);
      g.fallAcc += dt * 1000 * (g.soft ? 12 : 1);
      const gms = gravityMs();
      while (g.fallAcc >= gms && g.piece && !g.over) {
        g.fallAcc -= gms;
        stepDown();
      }
      let left = dt;
      while (left > 1e-6 && !g.over) {
        const h = Math.min(left, 1 / 120);
        g.time += h;
        physics(h);
        left -= h;
      }
    }

    function drainEvents() {
      const e = g.events;
      g.events = [];
      return e;
    }

    Object.assign(g, {
      reset, setQuotes, tick, move, moveTo, hardDrop, predict, drainEvents, boardCap,
      setSoft: (v) => { g.soft = !!v; },
      equilibriumNow: () => equilibrium(sums()),
      gravityMs, landingY, fits,
      // для тестов: положить плитку без падения
      _place: (symbolOrPiece, x) => {
        const t = typeof symbolOrPiece === 'string'
          ? tickers.find((q) => q.symbol === symbolOrPiece) : symbolOrPiece;
        const size = t.size || sizeFor(t.cap);
        g.piece = Object.assign({ changePct: 0, live: false }, t, { size, mass: t.mass || massFor(t.cap), x, y: H - size });
        hardDrop();
      },
    });
    reset();
    return g;
  }

  return { createGame, TICKERS, sizeFor, massFor, LINE_MULT };
});
