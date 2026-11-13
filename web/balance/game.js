// «Удержи экономику»: отрисовка, управление, звук и сочность поверх BalanceEngine.
(function () {
  'use strict';
  const E = window.BalanceEngine;
  const $ = (id) => document.getElementById(id);
  const cv = $('cv');
  const ctx = cv.getContext('2d');
  const INK = '#161616', PAPER = '#f6f3ea', CARD = '#fffdf7', RED = '#d62a2a', GREEN = '#1f9d48';

  // ---------- деньги и цвета, как у Лёхи ----------
  function money(b) {
    const a = Math.abs(b);
    if (a >= 1000) return '$' + (b / 1000).toFixed(2).replace('.', ',') + ' трлн';
    return '$' + Math.round(b) + ' млрд';
  }
  function moneyShort(b) {
    if (b >= 1000) return '$' + (b / 1000).toFixed(1).replace('.', ',') + 'T';
    return '$' + Math.round(b) + 'B';
  }
  const lerp = (a, b, t) => a + (b - a) * t;
  function mix(c1, c2, t) {
    const p = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
    const [a, b] = [p(c1), p(c2)];
    return `rgb(${a.map((v, i) => Math.round(lerp(v, b[i], t))).join(',')})`;
  }
  function tileColor(t) {
    const v = Math.max(-1, Math.min(1, (t.changePct || 0) / 3));
    if (v >= 0) return mix('#3d5a45', '#22b350', Math.pow(v, 0.6));
    return mix('#5e3434', '#e3262b', Math.pow(-v, 0.6));
  }
  const fmtPct = (p) => (p > 0 ? '+' : p < 0 ? '−' : '') + Math.abs(p).toFixed(2).replace('.', ',') + '%';

  // ---------- состояние ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('balance.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('balance.' + k, JSON.stringify(v)); } catch {} },
  };
  // На телефоне поле ниже (15 рядов), чтобы плитки были крупнее.
  let game = E.createGame({ H: innerWidth <= 720 ? 15 : 18 });
  let mode = 'start'; // start | play | pause | crash | over
  let best = store.get('best', 0);
  let muted = store.get('muted', false);
  let quotesLive = false;
  let demoQuotes = null;
  let freezeUntil = 0; // хит-стоп: игра замирает, отрисовка идёт
  let trauma = 0, shakeT = 0;
  let crashT = 0, crashSide = 1;
  const pv = { x: 0, y: 0 }; // плавное положение падающей плитки
  const landAnim = new Map(); // id → время посадки (сплющивание)
  const particles = [];
  const toasts = [];
  let debris = [];
  let G = null; // геометрия поля

  // ---------- звук: синтез в браузере, без файлов ----------
  let ac = null;
  function audio() {
    if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { ac = null; } }
    if (ac && ac.state === 'suspended') ac.resume();
    return ac;
  }
  function tone(freq, dur, type, vol, slideTo, delay) {
    if (muted) return;
    const a = audio(); if (!a) return;
    const t0 = a.currentTime + (delay || 0);
    const o = a.createOscillator(), gn = a.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    gn.gain.setValueAtTime(0.0001, t0);
    gn.gain.exponentialRampToValueAtTime(vol || 0.2, t0 + 0.01);
    gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(gn).connect(a.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function noise(dur, vol, lp) {
    if (muted) return;
    const a = audio(); if (!a) return;
    const n = Math.floor(a.sampleRate * dur);
    const buf = a.createBuffer(1, n, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2);
    const src = a.createBufferSource(); src.buffer = buf;
    const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp || 800;
    const gn = a.createGain(); gn.gain.value = vol || 0.3;
    src.connect(f).connect(gn).connect(a.destination);
    src.start();
  }
  const sfx = {
    move() { tone(520, 0.04, 'square', 0.03); },
    land(heavy) { tone(160 - heavy * 90, 0.18, 'triangle', 0.25 + heavy * 0.2, 50); noise(0.12, 0.12 + heavy * 0.25, 500); },
    lines(n) { [523, 659, 784, 1047].slice(0, n + 1).forEach((f, i) => tone(f, 0.22, 'triangle', 0.16, null, i * 0.07)); },
    warn() { tone(880, 0.08, 'square', 0.05, 660); },
    crash() { noise(1.2, 0.5, 400); tone(220, 1.1, 'sawtooth', 0.12, 40); },
    start() { tone(392, 0.1, 'triangle', 0.15); tone(587, 0.16, 'triangle', 0.15, null, 0.09); },
  };

  // ---------- котировки: живые с сервера форка, иначе демо ----------
  function hash(s) { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0; return h; }
  async function loadQuotes() {
    try {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 4000);
      const r = await fetch('api/quotes', { cache: 'no-store', signal: ctl.signal });
      clearTimeout(to);
      if (!r.ok) throw new Error(r.status);
      const snap = await r.json();
      if (!snap || !Array.isArray(snap.quotes)) throw new Error('bad');
      quotesLive = snap.quotes.some((q) => q.live);
      if (quotesLive) {
        game.setQuotes(snap.quotes);
        renderMarket(snap.quotes, snap.marketOpen);
        return;
      }
    } catch (e) { /* статическая копия без сервера — демо */ }
    // Демо: стабильные «котировки» от имени бумаги, чтобы плитки были разного цвета.
    demoQuotes = E.TICKERS.map((t) => ({ symbol: t.symbol, cap: t.cap, changePct: (((hash(t.symbol) >>> 0) % 900) / 100 - 4.5) * 0.7, live: false }));
    game.setQuotes(demoQuotes);
    renderMarket(null, false);
  }
  function renderMarket(quotes, open) {
    const nv = quotes && quotes.find((q) => q.symbol === 'NVDA');
    if (quotes && nv) {
      const k = Math.round((game.kMul - 1) * 100);
      $('mdot').style.background = open ? 'var(--up)' : '#9a958c';
      $('mstate').textContent = `живые котировки · NVDA ${fmtPct(nv.changePct)} → палка ${k < 0 ? 'слабее на ' + -k + '%' : k > 0 ? 'крепче на ' + k + '%' : 'как обычно'}`;
    } else {
      $('mdot').style.background = '#f3c33b';
      $('mstate').textContent = 'демо-котировки: сервер форка не найден';
    }
  }

  // ---------- геометрия ----------
  function layout() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const vw = innerWidth, vh = innerHeight;
    cv.width = Math.round(vw * dpr); cv.height = Math.round(vh * dpr);
    cv.style.width = vw + 'px'; cv.style.height = vh + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const mobile = vw <= 720;
    let ax = 0, ay = 0, aw = vw, ah = vh;
    const hud = $('hud').getBoundingClientRect();
    if (mobile) {
      const pad = $('pad').getBoundingClientRect();
      ay = hud.bottom + 4; ah = pad.top - 4 - ay;
    } else {
      ax = hud.right + 12; aw = vw - ax - 12;
      if (aw < 360) { ax = 0; aw = vw; }
    }
    const W = game.W, H = game.H, h0 = game.cfg.h0;
    const stick = mobile ? 2.2 : 3.0;
    const unitsH = H + h0 + 1.7 + stick + 2.1; // заголовок + поле + подставка + палка + постамент
    const c = Math.max(8, Math.floor(Math.min(ah / unitsH, aw / (W + 4.5))));
    const used = unitsH * c;
    const top = ay + Math.max(0, (ah - used) / 2);
    G = {
      c, W, H, h0, mobile, dpr, stick,
      px: Math.round(ax + aw / 2),
      py: Math.round(top + (1.7 + H + h0) * c),
      top, ax, aw,
    };
    // Модальные окна — в центре поля, а не всего экрана.
    for (const m of document.querySelectorAll('.modal')) {
      m.style.left = (mobile ? vw / 2 : ax + aw / 2) + 'px';
      m.style.top = (mobile ? (ay + ah / 2) : vh / 2) + 'px';
    }
  }

  // Точка поля (колонка, ряд снизу) → экран, с учётом крена.
  function toScreen(col, row, theta) {
    const lx = (col - G.W / 2) * G.c, ly = -(row + G.h0) * G.c;
    const cs = Math.cos(theta), sn = Math.sin(theta);
    return [G.px + lx * cs - ly * sn, G.py + lx * sn + ly * cs];
  }
  // Экран → колонка поля.
  function toCol(x, y) {
    const th = game.theta;
    const dx = x - G.px, dy = y - G.py;
    const lx = dx * Math.cos(-th) - dy * Math.sin(-th);
    return lx / G.c + G.W / 2;
  }

  // ---------- HUD по событиям ----------
  function hudScore() {
    // После краха на поле ничего не осталось: показываем только зафиксированное.
    $('cap').textContent = money(game.banked + (game.over ? 0 : game.boardCap()));
    $('banked').textContent = money(game.banked);
    $('best').textContent = best ? money(best) : '—';
    $('lines').textContent = game.lines;
    $('level').textContent = game.level;
    $('placed').textContent = game.placed;
  }
  function hudNext() {
    const n = game.next;
    $('nextSym').textContent = n ? n.symbol : '—';
    $('nextCap').textContent = n ? money(n.cap) + ' · ' + n.size + '×' + n.size : '—';
    const nc = $('nextCv'), x = nc.getContext('2d');
    x.clearRect(0, 0, nc.width, nc.height);
    if (!n) return;
    const s = (nc.width - 8) * (0.5 + 0.5 * (n.size - 1) / 2);
    const o = (nc.width - s) / 2;
    drawTile(x, o, o, s, s, n, Math.max(14, s / 4.2), true);
  }
  // Крен в процентах от критического: 100% — мир падает.
  const tiltPct = (th) => Math.min(99, Math.round(Math.abs(th) / game.cfg.crit * 100));
  let lastTiltTxt = '', lastAfterTxt = '';
  function hudTilt(pred) {
    const th = game.theta;
    const pos = (v) => 50 + Math.max(-1, Math.min(1, v / game.cfg.crit)) * 46;
    $('nowMark').style.left = pos(th) + '%';
    const gm = $('ghostMark');
    let after = '—';
    if (pred && mode === 'play') {
      gm.style.display = 'block';
      if (pred.fall) { gm.style.left = (th >= 0 ? 97 : 3) + '%'; gm.classList.add('fall'); after = 'после сброса: УПАДЁТ'; }
      else { gm.style.left = pos(pred.theta) + '%'; gm.classList.remove('fall'); after = 'после сброса: ' + tiltPct(pred.theta) + '%'; }
    } else gm.style.display = 'none';
    const p = tiltPct(th);
    const now = p < 3 ? 'в равновесии' : (th > 0 ? 'вправо ' : 'влево ') + p + '%';
    if (now !== lastTiltTxt) { $('tiltNow').textContent = now; $('tiltNow').className = p > 66 ? 'down' : ''; lastTiltTxt = now; }
    if (after !== lastAfterTxt) { $('tiltAfter').textContent = after; $('tiltAfter').className = pred && pred.fall ? 'down' : ''; lastAfterTxt = after; }
  }

  // ---------- рисование ----------
  function rr(x, c0, y, w, h, r) {
    x.beginPath();
    x.moveTo(c0 + r, y); x.arcTo(c0 + w, y, c0 + w, y + h, r); x.arcTo(c0 + w, y + h, c0, y + h, r);
    x.arcTo(c0, y + h, c0, y, r); x.arcTo(c0, y, c0 + w, y, r); x.closePath();
  }
  function drawTile(x, tx, ty, w, h, t, fs, withPct) {
    x.fillStyle = tileColor(t);
    x.fillRect(tx, ty, w, h);
    x.strokeStyle = INK; x.lineWidth = Math.max(2, fs / 7);
    x.strokeRect(tx, ty, w, h);
    label(x, tx, ty, w, h, t, fs, withPct);
  }
  function label(x, tx, ty, w, h, t, fs, withPct) {
    fs = Math.min(fs, w / (t.symbol.length * 0.62 + 0.4));
    if (fs < 7) return;
    x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle';
    const lines = [[t.symbol, 900, fs]];
    if (h > fs * 2.1) lines.push([moneyShort(t.cap), 700, fs * 0.62]);
    if (withPct && h > fs * 3) lines.push([fmtPct(t.changePct || 0), 500, fs * 0.55]);
    const tot = lines.reduce((s, l) => s + l[2] * 1.12, 0);
    let y = ty + h / 2 - tot / 2;
    for (const [txt, wt, sz] of lines) {
      x.font = `${wt} ${Math.round(sz)}px Rubik, system-ui, sans-serif`;
      x.fillText(txt, tx + w / 2, y + sz * 0.56);
      y += sz * 1.12;
    }
  }

  function drawStatic(now) {
    const c = G.c, px = G.px, py = G.py;
    // Заголовок мема и фигурная скобка над полем.
    const fw = G.W * c;
    ctx.fillStyle = INK; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    const tf = Math.min(c * 1.0, fw / 14.5);
    ctx.font = `900 ${Math.round(tf)}px Rubik, system-ui, sans-serif`;
    const ty = G.top + c * 0.85;
    ctx.fillText('ВСЯ МИРОВАЯ ЭКОНОМИКА', px, ty);
    const by = ty + c * 0.3;
    ctx.lineWidth = 2.5; ctx.strokeStyle = INK; ctx.lineCap = 'round';
    ctx.beginPath();
    const l = px - fw / 2 + c * 0.2, r = px + fw / 2 - c * 0.2, q = c * 0.35;
    ctx.moveTo(l, by + q); ctx.quadraticCurveTo(l, by, l + q, by); ctx.lineTo(px - q, by);
    ctx.quadraticCurveTo(px, by, px, by - q * 0.8); ctx.quadraticCurveTo(px, by, px + q, by);
    ctx.lineTo(r - q, by); ctx.quadraticCurveTo(r, by, r, by + q);
    ctx.stroke();

    // Палка Хуанга и постамент.
    const danger = Math.min(1, Math.abs(game.theta) / game.cfg.crit);
    const stickH = G.stick * c;
    const bend = (mode === 'crash' || mode === 'over') ? crashSide * c * 0.6 * Math.min(1, crashT * 2) : game.theta * c * 1.2;
    ctx.strokeStyle = INK; ctx.lineWidth = Math.max(4, c * 0.32);
    ctx.beginPath(); ctx.moveTo(px, py + stickH);
    ctx.quadraticCurveTo(px + bend * 0.2, py + stickH * 0.5, px + bend * 0.05, py); ctx.stroke();
    ctx.strokeStyle = danger > 0.6 ? mix('#f6f3ea', '#d62a2a', (danger - 0.6) / 0.4) : PAPER;
    ctx.lineWidth = Math.max(2, c * 0.16);
    ctx.beginPath(); ctx.moveTo(px, py + stickH - 2);
    ctx.quadraticCurveTo(px + bend * 0.2, py + stickH * 0.5, px + bend * 0.05, py + 3); ctx.stroke();

    const s1w = 3.8 * c, s2w = 6.4 * c, sh = 0.75 * c;
    const sy = py + stickH;
    ctx.fillStyle = 'rgba(0,0,0,.08)';
    ctx.beginPath(); ctx.ellipse(px, sy + sh * 2 + 3, s2w * 0.62, sh * 0.5, 0, 0, Math.PI * 2); ctx.fill();
    for (const [w, y] of [[s2w, sy + sh], [s1w, sy]]) {
      ctx.fillStyle = CARD; ctx.strokeStyle = INK; ctx.lineWidth = 3;
      rr(ctx, px - w / 2, y, w, sh, 4); ctx.fill(); ctx.stroke();
    }
    // Подпись со стрелкой, как в меме.
    const lf = Math.max(11, Math.round(c * 0.62));
    ctx.font = `900 ${lf}px Rubik, system-ui, sans-serif`;
    ctx.textAlign = 'left'; ctx.fillStyle = INK;
    const lx = px + s1w * 0.62, lyy = py + stickH * 0.62;
    ctx.fillText('ЧЛЕН', lx, lyy); ctx.fillText('ХУАНГА', lx, lyy + lf * 1.05);
    ctx.lineWidth = 2; ctx.beginPath();
    ctx.moveTo(lx - 4, lyy - lf * 0.3); ctx.quadraticCurveTo(px + c * 0.9, lyy - lf * 0.9, px + c * 0.35, py + stickH * 0.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(px + c * 0.35 + 7, py + stickH * 0.5 - 3); ctx.lineTo(px + c * 0.35, py + stickH * 0.5); ctx.lineTo(px + c * 0.35 + 3, py + stickH * 0.5 - 8); ctx.stroke();

    // «Крен рынка −N%» рядом с палкой, как у Лёхи.
    if (mode === 'play' && danger > 0.15) {
      ctx.font = `900 ${Math.max(12, Math.round(c * 0.7))}px Rubik, system-ui, sans-serif`;
      ctx.textAlign = 'right';
      ctx.fillStyle = danger > 0.66 ? RED : INK;
      const wob = danger > 0.8 ? Math.sin(now / 40) * 2 : 0;
      ctx.fillText(`Крен рынка −${tiltPct(game.theta)}%`, px - s1w * 0.62 + wob, py + stickH * 0.7);
    }
  }

  function drawBoard(now, pred) {
    if (mode === 'crash' || mode === 'over') return; // мир уже обломками
    const c = G.c, W = G.W, H = G.H, h0 = G.h0;
    ctx.save();
    ctx.translate(G.px, G.py);
    ctx.rotate(game.theta);
    // Подставка, на которой стоит экономика.
    ctx.fillStyle = CARD; ctx.strokeStyle = INK; ctx.lineWidth = 3;
    rr(ctx, -W / 2 * c - 4, -h0 * c, W * c + 8, h0 * c, 5); ctx.fill(); ctx.stroke();
    // Колонки-направляющие и полоса прицела.
    const p = game.piece;
    if (p && mode === 'play') {
      const gx = (pv.x - W / 2) * c;
      ctx.fillStyle = pred && pred.fall ? 'rgba(214,42,42,.10)' : 'rgba(22,22,22,.05)';
      ctx.fillRect(gx, -(H + h0) * c, p.size * c, H * c);
    }
    ctx.strokeStyle = 'rgba(22,22,22,.10)'; ctx.lineWidth = 1;
    ctx.setLineDash([2, 6]);
    for (let i = 1; i < W; i++) { ctx.beginPath(); ctx.moveTo((i - W / 2) * c, -h0 * c); ctx.lineTo((i - W / 2) * c, -(H + h0) * c); ctx.stroke(); }
    ctx.setLineDash([]);
    // Потолок: выше — завал.
    ctx.strokeStyle = 'rgba(214,42,42,.35)'; ctx.setLineDash([8, 6]); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-W / 2 * c, -(H + h0) * c); ctx.lineTo(W / 2 * c, -(H + h0) * c); ctx.stroke(); ctx.setLineDash([]);

    if (mode !== 'crash' && mode !== 'over') {
      // Блоки на поле: каждый блок — прямоугольник клеток.
      const boxes = new Map();
      for (let r = 0; r < H; r++) for (let col = 0; col < W; col++) {
        const id = game.cells[r][col];
        if (id === null) continue;
        let b = boxes.get(id);
        if (!b) boxes.set(id, (b = { c0: col, c1: col, r0: r, r1: r }));
        b.c0 = Math.min(b.c0, col); b.c1 = Math.max(b.c1, col); b.r0 = Math.min(b.r0, r); b.r1 = Math.max(b.r1, r);
      }
      for (const [id, b] of boxes) {
        const blk = game.blocks.get(id);
        const w = (b.c1 - b.c0 + 1) * c, h = (b.r1 - b.r0 + 1) * c;
        let x = (b.c0 - W / 2) * c, y = -(b.r1 + 1 + h0) * c;
        // Сплющивание при посадке: короткий «шлёп» и возврат с перелётом.
        const la = landAnim.get(id);
        let sx = 1, sy = 1;
        if (la != null) {
          const t = (now - la) / 220;
          if (t >= 1) landAnim.delete(id);
          else { const k = Math.sin(t * Math.PI) * (1 - t) * 0.5 * (0.3 + blk.size * 0.25); sy = 1 - k; sx = 1 + k * 0.6; }
        }
        ctx.save();
        ctx.translate(x + w / 2, y + h);
        ctx.scale(sx, sy);
        drawTile(ctx, -w / 2, -h, w, h, blk, c * 0.55 * Math.min(2.2, blk.size * 0.75 + 0.35), blk.size >= 2);
        ctx.restore();
      }
      // Тень посадки и падающая плитка.
      if (p && mode === 'play') {
        if (pred) {
          ctx.strokeStyle = pred.fall ? RED : INK; ctx.lineWidth = 2; ctx.setLineDash([6, 5]);
          ctx.strokeRect((pred.x - W / 2) * c + 2, -(pred.y + p.size + h0) * c + 2, p.size * c - 4, p.size * c - 4);
          ctx.setLineDash([]);
        }
        const x = (pv.x - W / 2) * c, y = -(pv.y + p.size + h0) * c;
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,.25)'; ctx.shadowOffsetX = 4; ctx.shadowOffsetY = 4;
        ctx.fillStyle = tileColor(p); ctx.fillRect(x, y, p.size * c, p.size * c);
        ctx.restore();
        drawTile(ctx, x, y, p.size * c, p.size * c, p, c * 0.55 * Math.min(2.2, p.size * 0.75 + 0.35), p.size >= 2);
      }
    }
    ctx.restore();
  }

  function drawFx(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const q = particles[i];
      q.t += dt;
      if (q.t >= q.life) { particles.splice(i, 1); continue; }
      const k = q.t / q.life;
      if (q.kind === 'dollar') {
        // Летят к цифре капитализации по кривой и растворяются.
        const e = k * k * (3 - 2 * k);
        const x = lerp(q.x, q.tx, e) + Math.sin(k * Math.PI) * q.sw;
        const y = lerp(q.y, q.ty, e) - Math.sin(k * Math.PI) * 60;
        ctx.globalAlpha = 1 - k * 0.6;
        ctx.fillStyle = GREEN; ctx.font = `900 ${Math.round(q.size)}px Rubik, sans-serif`; ctx.textAlign = 'center';
        ctx.fillText('$', x, y);
      } else if (q.kind === 'flash') {
        ctx.globalAlpha = 1 - k;
        ctx.fillStyle = '#fff';
        ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.rot);
        ctx.fillRect(-q.s / 2 - 2, -q.s / 2 - 2, q.s + 4, q.s + 4); ctx.restore();
      } else {
        q.vy += 900 * dt; q.x += q.vx * dt; q.y += q.vy * dt;
        ctx.globalAlpha = 1 - k;
        ctx.fillStyle = q.color;
        ctx.fillRect(q.x - q.s / 2, q.y - q.s / 2, q.s, q.s);
      }
      ctx.globalAlpha = 1;
    }
    // Обломки краха.
    for (const d of debris) {
      d.vy += 1500 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.rot += d.vr * dt;
      const floor = innerHeight - d.s * 0.5;
      if (d.y > floor) { d.y = floor; d.vy *= -0.35; d.vx *= 0.7; d.vr *= 0.6; }
      ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.rot);
      if (d.blk) drawTile(ctx, -d.s / 2, -d.s / 2, d.s, d.s, d.blk, d.s * 0.3, false);
      else { ctx.fillStyle = CARD; ctx.strokeStyle = INK; ctx.lineWidth = 3; rr(ctx, -d.w / 2, -d.h / 2, d.w, d.h, 5); ctx.fill(); ctx.stroke(); }
      ctx.restore();
    }
    // Всплывающие надписи.
    for (let i = toasts.length - 1; i >= 0; i--) {
      const t = toasts[i];
      t.t += dt;
      if (t.t > t.dur) { toasts.splice(i, 1); continue; }
      const k = t.t / t.dur;
      const pop = t.t < 0.25 ? 1 + 0.35 * Math.sin((t.t / 0.25) * Math.PI) : 1;
      const fs = Math.round(G.c * t.size * pop);
      ctx.globalAlpha = k > 0.75 ? (1 - k) / 0.25 : 1;
      ctx.font = `900 ${fs}px Rubik, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = Math.max(3, fs / 6); ctx.strokeStyle = CARD; ctx.fillStyle = t.color;
      const y = t.y - k * G.c * 1.5;
      ctx.strokeText(t.text, G.px, y); ctx.fillText(t.text, G.px, y);
      ctx.globalAlpha = 1;
    }
  }

  function toast(text, color, size, y) {
    toasts.push({ text, color: color || INK, size: size || 1.1, t: 0, dur: 1.6, y: y || (G.py - (G.H * 0.6 + G.h0) * G.c) });
  }

  // ---------- события движка → сочность ----------
  function capPoint() {
    const r = $('cap').getBoundingClientRect();
    return [r.left + r.width * 0.4, r.top + r.height / 2];
  }
  function handleEvents(now) {
    for (const e of game.drainEvents()) {
      if (e.type === 'move') sfx.move();
      else if (e.type === 'spawn') { pv.x = e.piece.x; pv.y = e.piece.y; hudNext(); }
      else if (e.type === 'land') {
        landAnim.set(e.id, now);
        trauma = Math.min(1, trauma + 0.08 + e.heavy * 0.32);
        sfx.land(e.heavy);
        const p = e.piece;
        for (const side of [0, 1]) {
          const [x, y] = toScreen(p.x + side * p.size, p.y, game.theta);
          for (let i = 0; i < 4 + p.size * 2; i++)
            particles.push({ kind: 'dust', x, y, vx: (side ? 1 : -1) * (40 + Math.random() * 120), vy: -60 - Math.random() * 120, s: 3 + Math.random() * 4, t: 0, life: 0.45, color: 'rgba(22,22,22,.45)' });
        }
        hudScore();
      } else if (e.type === 'lines') {
        freezeUntil = now + 70 + e.count * 25;
        trauma = Math.min(1, trauma + 0.15 + e.count * 0.1);
        sfx.lines(e.count);
        const [tx, ty] = capPoint();
        for (const cell of e.cells) {
          const [x, y] = toScreen(cell.c + 0.5, cell.r + 0.5, game.theta);
          particles.push({ kind: 'flash', x, y, s: G.c, rot: game.theta, t: 0, life: 0.25 });
          if (Math.random() < 0.6) particles.push({ kind: 'dollar', x, y, tx, ty, sw: (Math.random() - 0.5) * 80, size: G.c * (0.6 + Math.random() * 0.4), t: 0, life: 0.7 + Math.random() * 0.35 });
        }
        const names = ['', 'Слияние!', 'Двойное слияние!', 'Тройное слияние!', 'Мегаслияние!'];
        toast(`${names[Math.min(4, e.count)]} +${money(e.gain)}`, GREEN, 1.0 + e.count * 0.12);
        hudScore();
      } else if (e.type === 'crash') {
        startCrash(e, now);
      }
    }
  }

  function startCrash(e, now) {
    mode = 'crash';
    crashT = 0;
    crashSide = e.theta >= 0 ? 1 : -1;
    freezeUntil = now + 130;
    trauma = 1;
    sfx.crash();
    // Каждая клетка — обломок, летит в сторону крена.
    debris = [];
    const th = game.theta;
    for (let r = 0; r < game.H; r++) for (let c = 0; c < game.W; c++) {
      const id = game.cells[r][c];
      if (id === null) continue;
      const [x, y] = toScreen(c + 0.5, r + 0.5, th);
      debris.push({ x, y, s: G.c, blk: game.blocks.get(id), rot: th, vx: crashSide * (120 + r * 25 + Math.random() * 200), vy: -150 - Math.random() * 250, vr: (Math.random() - 0.5) * 8 });
    }
    const [bx, by] = toScreen(game.W / 2, -game.cfg.h0 / 2, th);
    debris.push({ x: bx, y: by, w: game.W * G.c + 8, h: game.cfg.h0 * G.c, s: G.c, rot: th, vx: crashSide * 160, vy: -60, vr: crashSide * 2.2 });
    const total = game.banked;
    const isBest = total > best;
    if (isBest) { best = total; store.set('best', best); }
    $('overLine').textContent = `Вся мировая экономика −${e.pct.toFixed(1).replace('.', ',')}%`;
    $('overWhy').textContent = e.reason === 'top' ? 'Башня упёрлась в потолок — пузырь лопнул.' : `Перекосило ${crashSide > 0 ? 'вправо' : 'влево'}: Хуанг не удержал.`;
    $('overScore').textContent = money(total);
    $('overBest').textContent = isBest ? '★ Новый рекорд!' : 'рекорд ' + money(best);
    hudScore();
    setTimeout(() => { if (mode === 'crash') { mode = 'over'; show('overCard'); } }, 1500);
  }

  // ---------- окна ----------
  function show(id) {
    for (const m of document.querySelectorAll('.modal')) m.classList.toggle('show', m.id === id);
    const b = id && $(id).querySelector('button');
    if (b) setTimeout(() => b.focus(), 30);
  }
  function startGame() {
    audio();
    game.reset();
    debris = []; particles.length = 0; toasts.length = 0; landAnim.clear();
    mode = 'play';
    show(null);
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    hudScore(); hudNext();
    sfx.start();
    cv.focus && cv.focus();
  }
  function pause(on) {
    if (on && mode === 'play') { mode = 'pause'; show('pauseCard'); }
    else if (!on && mode === 'pause') { mode = 'play'; show(null); last = performance.now(); }
  }

  // ---------- ввод ----------
  window.addEventListener('keydown', (e) => {
    const k = e.code;
    if (mode === 'start' || mode === 'over') {
      if (k === 'Space' || k === 'Enter') { e.preventDefault(); startGame(); }
      return;
    }
    if (k === 'KeyP' || k === 'Escape') { e.preventDefault(); pause(mode === 'play'); return; }
    if (k === 'KeyM') { toggleMute(); return; }
    if (mode !== 'play') { if (k === 'Space' || k === 'Enter') { e.preventDefault(); pause(false); } return; }
    if (k === 'ArrowLeft' || k === 'KeyA') { e.preventDefault(); game.move(-1); }
    else if (k === 'ArrowRight' || k === 'KeyD') { e.preventDefault(); game.move(1); }
    else if (k === 'ArrowDown' || k === 'KeyS') { e.preventDefault(); game.setSoft(true); }
    else if (k === 'Space' || k === 'ArrowUp' || k === 'KeyW' || k === 'Enter') { e.preventDefault(); if (!e.repeat) game.hardDrop(); }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'ArrowDown' || e.code === 'KeyS') game.setSoft(false);
  });
  // Мышь и палец: ведёшь — плитка едет за тобой, клик или тап без сдвига — сброс.
  let ptr = null;
  function aim(x, y) {
    const p = game.piece;
    if (!p || mode !== 'play') return;
    game.moveTo(Math.round(toCol(x, y) - p.size / 2));
  }
  cv.addEventListener('pointerdown', (e) => {
    audio();
    ptr = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
    if (e.pointerType !== 'mouse') aim(e.clientX, e.clientY);
  });
  cv.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse' && !ptr) { aim(e.clientX, e.clientY); return; }
    if (!ptr || ptr.id !== e.pointerId) return;
    if (Math.hypot(e.clientX - ptr.x, e.clientY - ptr.y) > 10) ptr.moved = true;
    aim(e.clientX, e.clientY);
  });
  cv.addEventListener('pointerup', (e) => {
    if (!ptr || ptr.id !== e.pointerId) return;
    const tap = !ptr.moved && performance.now() - ptr.t < 400;
    ptr = null;
    if (tap && mode === 'play') { aim(e.clientX, e.clientY); game.hardDrop(); }
  });
  cv.addEventListener('pointercancel', () => { ptr = null; });

  // Кнопки телефона: удержание ◀ ▶ повторяет шаг.
  function holdBtn(el, fn) {
    let timer = null;
    const stop = () => { clearTimeout(timer); timer = null; };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); audio();
      if (mode !== 'play') return;
      fn();
      const rep = (d) => { timer = setTimeout(() => { if (mode === 'play') fn(); rep(70); }, d); };
      rep(220);
    });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(ev, stop);
  }
  holdBtn($('padL'), () => game.move(-1));
  holdBtn($('padR'), () => game.move(1));
  $('padDrop').addEventListener('pointerdown', (e) => { e.preventDefault(); audio(); if (mode === 'play') game.hardDrop(); });

  $('startBtn').onclick = startGame;
  $('againBtn').onclick = startGame;
  $('resumeBtn').onclick = () => pause(false);
  $('pauseBtn').onclick = () => pause(mode === 'play');
  function toggleMute() {
    muted = !muted; store.set('muted', muted);
    $('muteBtn').textContent = muted ? '🔇' : '🔊';
  }
  $('muteBtn').onclick = toggleMute;
  $('muteBtn').textContent = muted ? '🔇' : '🔊';
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(true); });

  // ---------- цикл ----------
  let last = performance.now();
  let warnT = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const frozen = now < freezeUntil;
    if (mode === 'play' && !frozen) {
      game.tick(dt);
    }
    if (mode === 'crash' || mode === 'over') crashT += dt;
    handleEvents(now);
    const p = game.piece;
    if (p) {
      const k = Math.min(1, dt * 22);
      pv.x += (p.x - pv.x) * k;
      pv.y += (p.y - pv.y) * Math.min(1, dt * 30);
      if (Math.abs(p.y - pv.y) > 3) pv.y = p.y + Math.sign(pv.y - p.y) * 3;
    }
    const pred = mode === 'play' ? game.predict() : null;
    // Предупреждение звуком, когда мир на грани.
    const danger = Math.abs(game.theta) / game.cfg.crit;
    warnT -= dt;
    if (mode === 'play' && danger > 0.8 && warnT <= 0) { sfx.warn(); warnT = 0.5; }

    // Тряска камеры: «травма» затухает, сдвиг ~ травма², плавный синус, не случайный шум.
    trauma = Math.max(0, trauma - dt * 1.6);
    shakeT += dt * 30;
    const sh = trauma * trauma;
    const ox = 14 * sh * Math.sin(shakeT * 1.7), oy = 10 * sh * Math.sin(shakeT * 2.3);

    // Масштаб — в каждом кадре: Chrome может сбросить состояние canvas без ошибки.
    ctx.setTransform(G.dpr, 0, 0, G.dpr, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.fillStyle = PAPER; ctx.fillRect(0, 0, innerWidth, innerHeight);
    // Красная виньетка, когда крен опасный.
    if (mode === 'play' && danger > 0.55) {
      const a = Math.min(0.28, (danger - 0.55) * 0.6) * (0.75 + 0.25 * Math.sin(now / 120));
      const gr = ctx.createRadialGradient(G.px, innerHeight / 2, Math.min(innerWidth, innerHeight) * 0.35, G.px, innerHeight / 2, Math.max(innerWidth, innerHeight) * 0.75);
      gr.addColorStop(0, 'rgba(214,42,42,0)'); gr.addColorStop(1, `rgba(214,42,42,${a})`);
      ctx.fillStyle = gr; ctx.fillRect(0, 0, innerWidth, innerHeight);
    }
    ctx.save();
    ctx.translate(ox, oy);
    drawStatic(now);
    drawBoard(now, pred);
    ctx.restore();
    drawFx(dt);
    hudTilt(pred);
    requestAnimationFrame(frame);
  }

  // Для проверок из браузера (Playwright): состояние и управление.
  window.__balance = { get game() { return game; }, get mode() { return mode; }, start: startGame, layout: () => G };

  window.addEventListener('resize', layout);
  layout();
  hudScore(); hudNext();
  show('startCard');
  loadQuotes();
  requestAnimationFrame(frame);
})();
