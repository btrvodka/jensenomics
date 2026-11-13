// «Удержи экономику» v2: отрисовка, управление, звук и сочность поверх BalanceEngine.
// Мир: ночная неоновая биржа, желейные кубики по цвету отрасли, подставка-видеокарта.
(function () {
  'use strict';
  const E = window.BalanceEngine;
  const $ = (id) => document.getElementById(id);
  const cv = $('cv');
  const ctx = cv.getContext('2d');
  const VERSION = 2;

  const C = {
    night: '#120d33', cream: '#fff3d6', text: '#f6f1ff', muted: '#b9afe0',
    mint: '#4ff0b0', pink: '#ff5fa8', gold: '#ffc84a', red: '#ff4d5e', cyan: '#46c8ff',
  };
  // Цвет плитки — отрасль (как в легенде), изменение за день — значок ▲▼.
  const GROUP = { chips: '#2fd890', megacaps: '#7d6bff', software: '#ff8f3a', hardware: '#3cbcff' };
  const FONT_D = "'Unbounded', 'Rubik', system-ui, sans-serif";
  const FONT_B = "'Rubik', system-ui, sans-serif";

  // ---------- числа и цвета ----------
  function money(b) {
    const a = Math.abs(b);
    if (a >= 1000) return '$' + (b / 1000).toFixed(2).replace('.', ',') + ' трлн';
    return '$' + Math.round(b) + ' млрд';
  }
  function moneyShort(b) {
    if (b >= 1000) return '$' + (b / 1000).toFixed(1).replace('.', ',') + 'T';
    return '$' + Math.round(b) + 'B';
  }
  const fmtPct = (p) => (p > 0 ? '+' : p < 0 ? '−' : '') + Math.abs(p).toFixed(1).replace('.', ',') + '%';
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function hexRgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
  function shade(h, k) { // k>0 светлее, k<0 темнее
    const c = hexRgb(h).map((v) => Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k)));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }
  function rgba(h, a) { const c = hexRgb(h); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; }
  const colorOf = (t) => GROUP[t.group] || '#9c8cff';

  // ---------- состояние ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('balance.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('balance.' + k, JSON.stringify(v)); } catch {} },
  };
  // На телефоне поле ниже (15 рядов), чтобы кубики были крупнее.
  let game = E.createGame({ H: innerWidth <= 720 ? 15 : 18 });
  let mode = 'start'; // start | play | pause | crash | over
  let best = store.get('best', 0);
  let muted = store.get('muted', false);
  let freezeUntil = 0; // хит-стоп: игра на миг замирает, отрисовка идёт
  let trauma = 0, shakeT = 0, flash = 0;
  let crashT = 0, crashSide = 1;
  let shownCap = 0; // «бегущий» счётчик капитализации
  const pv = { x: 0, y: 0 }; // плавное положение падающей плитки
  let spawnT = 0;
  const anim = new Map(); // id блока → { t0, amp } — желейная пружинка после посадки
  const parts = [];
  const toasts = [];
  const trails = [];
  let debris = [];
  const bubbles = [];
  let G = null;

  // ---------- картинки ----------
  const img = (src) => { const i = new Image(); i.src = src; return i; };
  const BG = img('balance/assets/bg-night.webp');
  const GPU = img('balance/assets/gpu.webp');

  // ---------- звук: синтез в браузере ----------
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
    const o = a.createOscillator(), g = a.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.2, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(a.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function noise(dur, vol, f0, f1, type) {
    if (muted) return;
    const a = audio(); if (!a) return;
    const n = Math.floor(a.sampleRate * dur);
    const buf = a.createBuffer(1, n, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2);
    const src = a.createBufferSource(); src.buffer = buf;
    const f = a.createBiquadFilter(); f.type = type || 'lowpass';
    f.frequency.setValueAtTime(f0 || 800, a.currentTime);
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, a.currentTime + dur);
    const g = a.createGain(); g.gain.value = vol || 0.3;
    src.connect(f).connect(g).connect(a.destination);
    src.start();
  }
  const sfx = {
    move() { tone(640, 0.035, 'triangle', 0.035); },
    // «Плюх»: мягкий удар с падением тона — чем больше кубик, тем ниже.
    plop(size) {
      const base = [0, 320, 220, 150][size];
      tone(base, 0.16, 'sine', 0.32, base * 0.32);
      tone(base * 2.1, 0.05, 'triangle', 0.08);
      noise(0.09 + size * 0.03, 0.08 + size * 0.06, 900 - size * 150);
    },
    coin(i) { tone(1320 + i * 90, 0.07, 'square', 0.035, null, i * 0.035); },
    merge(n) {
      [523, 659, 784, 1047, 1319].slice(0, n + 2).forEach((f, i) => tone(f, 0.24, 'triangle', 0.14, null, i * 0.06));
      noise(0.5, 0.05, 6000, 2000, 'highpass');
    },
    miss() { noise(0.45, 0.18, 2400, 300, 'bandpass'); tone(500, 0.4, 'sine', 0.06, 120); },
    warn() { tone(880, 0.07, 'square', 0.045, 700); },
    crash() { noise(1.3, 0.5, 600, 80); tone(200, 1.2, 'sawtooth', 0.1, 35); tone(90, 0.5, 'sine', 0.3, 30); },
    start() { tone(392, 0.1, 'triangle', 0.15); tone(587, 0.12, 'triangle', 0.15, null, 0.08); tone(784, 0.18, 'triangle', 0.15, null, 0.16); },
  };

  // ---------- котировки ----------
  function hash(s) { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0; return h; }
  async function loadQuotes() {
    try {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 4000);
      const r = await fetch('api/quotes', { cache: 'no-store', signal: ctl.signal });
      clearTimeout(to);
      if (!r.ok) throw new Error(r.status);
      const snap = await r.json();
      if (snap && Array.isArray(snap.quotes) && snap.quotes.some((q) => q.live)) {
        game.setQuotes(snap.quotes);
        renderMarket(snap.quotes, snap.marketOpen);
        return;
      }
    } catch (e) { /* статическая копия — демо */ }
    // Демо: стабильные «котировки» от имени бумаги; на силу палки не влияют.
    game.setQuotes(E.TICKERS.map((t) => ({ symbol: t.symbol, cap: t.cap, changePct: (((hash(t.symbol) >>> 0) % 900) / 100 - 4.5) * 0.7, live: false })));
    renderMarket(null, false);
  }
  function renderMarket(quotes, open) {
    const nv = quotes && quotes.find((q) => q.symbol === 'NVDA');
    if (nv) {
      const k = Math.round((game.kMul - 1) * 100);
      $('mdot').style.background = open ? 'var(--mint)' : 'var(--muted)';
      $('mstate').textContent = `живые котировки · NVDA ${fmtPct(nv.changePct)} → палка ${k < 0 ? 'слабее на ' + -k + '%' : k > 0 ? 'крепче на ' + k + '%' : 'как обычно'}`;
    } else {
      $('mstate').textContent = 'демо-котировки: живые — на сервере форка';
    }
  }

  // ---------- геометрия ----------
  function layout() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const vw = innerWidth, vh = innerHeight;
    cv.width = Math.round(vw * dpr); cv.height = Math.round(vh * dpr);
    cv.style.width = vw + 'px'; cv.style.height = vh + 'px';
    const mobile = vw <= 720;
    let ax = 0, ay = 0, aw = vw, ah = vh;
    const hud = $('hud').getBoundingClientRect();
    if (mobile) {
      const pad = $('pad').getBoundingClientRect();
      ay = hud.bottom + 4; ah = pad.top - 6 - ay;
    } else {
      ax = hud.right + 12; aw = vw - ax - 12;
      if (aw < 380) { ax = 0; aw = vw; }
    }
    const W = game.W, H = game.H, h0 = game.cfg.h0;
    const stick = mobile ? 2.0 : 2.6;
    const gpuH = mobile ? 3.0 : 3.7; // высота видеокарты в клетках
    const unitsH = 1.6 + H + h0 + stick + gpuH + 0.3;
    const c = Math.max(8, Math.floor(Math.min(ah / unitsH, aw / (W + 1.5))));
    const top = ay + Math.max(0, (ah - unitsH * c) / 2);
    G = { c, W, H, h0, mobile, dpr, stick, gpuH, top, ax, aw, vw, vh,
      px: Math.round(ax + aw / 2), py: Math.round(top + (1.6 + H + h0) * c) };
    for (const m of document.querySelectorAll('.modal')) {
      m.style.left = (mobile ? vw / 2 : ax + aw / 2) + 'px';
      m.style.top = (mobile ? ay + ah / 2 : vh / 2) + 'px';
    }
  }
  function toScreen(col, row, theta) {
    const lx = (col - G.W / 2) * G.c, ly = -(row + G.h0) * G.c;
    const cs = Math.cos(theta), sn = Math.sin(theta);
    return [G.px + lx * cs - ly * sn, G.py + lx * sn + ly * cs];
  }
  function toCol(x, y) {
    const th = game.theta, dx = x - G.px, dy = y - G.py;
    return (dx * Math.cos(-th) - dy * Math.sin(-th)) / G.c + G.W / 2;
  }

  // ---------- HUD по событиям ----------
  function hudScore() {
    $('banked').textContent = money(game.banked);
    $('best').textContent = best ? money(best) : '—';
    $('lines').textContent = game.lines;
    $('level').textContent = game.level;
    $('missed').textContent = game.missed;
  }
  function bump(id) { const e = $(id); e.classList.remove('bump'); void e.offsetWidth; e.classList.add('bump'); }
  function hudNext() {
    const n = game.next;
    $('nextSym').textContent = n ? n.symbol : '—';
    $('nextCap').textContent = n ? moneyShort(n.cap) : '—';
    const nc = $('nextCv'), x = nc.getContext('2d');
    x.clearRect(0, 0, nc.width, nc.height);
    if (!n) return;
    const s = (nc.width - 16) * (0.5 + 0.5 * (n.size - 1) / 2);
    const o = (nc.width - s) / 2;
    drawCube(x, o, o, s, s, n, s / n.size, 1, 1);
  }
  const tiltPct = (th) => Math.min(99, Math.round(Math.abs(th) / game.cfg.crit * 100));
  let lastNow = '', lastAfter = '';
  function hudTilt(pred) {
    const th = game.theta;
    const pos = (v) => 50 + clamp(v / game.cfg.crit, -1, 1) * 46;
    $('nowMark').style.left = pos(th) + '%';
    const gm = $('ghostMark');
    let after = '—', cls = '';
    if (pred && mode === 'play') {
      gm.style.display = 'block';
      if (pred.miss) { gm.style.left = pos(th) + '%'; gm.classList.remove('fall'); after = 'мимо подставки!'; cls = 'bad'; }
      else if (pred.fall) { gm.style.left = (th >= 0 ? 97 : 3) + '%'; gm.classList.add('fall'); after = 'после: УПАДЁТ'; cls = 'bad'; }
      else { gm.style.left = pos(pred.theta) + '%'; gm.classList.remove('fall'); after = 'после: ' + tiltPct(pred.theta) + '%'; cls = tiltPct(pred.theta) > 66 ? 'bad' : 'gold'; }
    } else gm.style.display = 'none';
    const p = tiltPct(th);
    const now = p < 3 ? 'в равновесии' : (th > 0 ? 'вправо ' : 'влево ') + p + '%';
    if (now !== lastNow) { $('tiltNow').textContent = now; $('tiltNow').className = p > 66 ? 'bad' : ''; lastNow = now; }
    if (after + cls !== lastAfter) { $('tiltAfter').textContent = after; $('tiltAfter').className = cls; lastAfter = after + cls; }
  }
  function hudCap(dt) {
    const target = game.banked + (game.over ? 0 : game.boardCap());
    shownCap += (target - shownCap) * Math.min(1, dt * 6);
    if (Math.abs(target - shownCap) < 1) shownCap = target;
    const txt = money(shownCap);
    const el = $('cap');
    if (el.textContent !== txt) el.textContent = txt;
  }

  // ---------- рисование кубика ----------
  function rr(x, l, t, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    x.beginPath();
    x.moveTo(l + r, t); x.arcTo(l + w, t, l + w, t + h, r); x.arcTo(l + w, t + h, l, t + h, r);
    x.arcTo(l, t + h, l, t, r); x.arcTo(l, t, l + w, t, r); x.closePath();
  }
  // Глянцевый «желейный» кубик: градиент, блик сверху, тёмный низ, подпись.
  function drawCube(x, l, t, w, h, b, cell, alpha, glow) {
    const base = colorOf(b);
    const r = Math.max(4, cell * 0.22);
    x.save();
    x.globalAlpha = alpha == null ? 1 : alpha;
    if (glow) { x.shadowColor = rgba(base, 0.55); x.shadowBlur = cell * 0.5; }
    else { x.shadowColor = 'rgba(4,2,18,.45)'; x.shadowBlur = cell * 0.25; x.shadowOffsetY = cell * 0.08; }
    const gr = x.createLinearGradient(0, t, 0, t + h);
    gr.addColorStop(0, shade(base, 0.32)); gr.addColorStop(0.45, base); gr.addColorStop(1, shade(base, -0.35));
    rr(x, l, t, w, h, r); x.fillStyle = gr; x.fill();
    x.shadowColor = 'transparent'; x.shadowBlur = 0; x.shadowOffsetY = 0;
    x.lineWidth = Math.max(1.5, cell * 0.06); x.strokeStyle = shade(base, -0.5); x.stroke();
    // блик
    rr(x, l + w * 0.1, t + cell * 0.08, w * 0.8, Math.min(h * 0.3, cell * 0.32), r * 0.7);
    const hg = x.createLinearGradient(0, t, 0, t + cell * 0.4);
    hg.addColorStop(0, 'rgba(255,255,255,.55)'); hg.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = hg; x.fill();
    // искорка в углу
    x.fillStyle = 'rgba(255,255,255,.8)';
    x.beginPath(); x.arc(l + cell * 0.24, t + cell * 0.22, cell * 0.05, 0, Math.PI * 2); x.fill();
    label(x, l, t, w, h, b, cell);
    x.restore();
  }
  function label(x, l, t, w, h, b, cell) {
    const sym = b.symbol;
    let fs = Math.min(cell * (b.size >= 2 ? 0.62 : 0.4), (w * 0.86) / (sym.length * 0.66));
    if (fs < 6.5) return;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    const lines = [[sym, `900 ${fs}px ${FONT_B}`, fs, '#fff']];
    if (h > fs * 2.3) lines.push([moneyShort(b.cap), `700 ${fs * 0.6}px ${FONT_B}`, fs * 0.6, 'rgba(255,255,255,.88)']);
    if (b.size >= 2 && h > fs * 3.2) {
      const up = (b.changePct || 0) >= 0;
      lines.push([(up ? '▲ ' : '▼ ') + fmtPct(b.changePct || 0), `700 ${fs * 0.5}px ${FONT_B}`, fs * 0.5, up ? '#d9ffef' : '#ffd9de']);
    }
    const tot = lines.reduce((s, q) => s + q[2] * 1.15, 0);
    let y = t + h / 2 - tot / 2 + h * 0.03;
    for (const [txt, font, sz, col] of lines) {
      x.font = font;
      x.fillStyle = 'rgba(10,5,30,.35)'; x.fillText(txt, l + w / 2, y + sz * 0.58 + Math.max(1, sz * 0.08));
      x.fillStyle = col; x.fillText(txt, l + w / 2, y + sz * 0.58);
      y += sz * 1.15;
    }
  }

  // ---------- сцена ----------
  function drawBackground(now) {
    const vw = G.vw, vh = G.vh;
    ctx.fillStyle = C.night; ctx.fillRect(0, 0, vw, vh);
    if (BG.complete && BG.naturalWidth) {
      const s = Math.max(vw / BG.naturalWidth, vh / BG.naturalHeight) * 1.06;
      const w = BG.naturalWidth * s, h = BG.naturalHeight * s;
      const par = clamp(game.theta, -0.4, 0.4) * 40; // параллакс от крена
      ctx.drawImage(BG, (vw - w) / 2 - par + Math.sin(now / 9000) * 6, (vh - h) / 2 + Math.cos(now / 11000) * 4, w, h);
    }
    // Затемнение к центру поля, чтобы кубики читались.
    const g = ctx.createRadialGradient(G.px, G.py - G.H * G.c * 0.45, G.c * 2, G.px, G.py - G.H * G.c * 0.45, Math.max(vw, vh) * 0.75);
    g.addColorStop(0, 'rgba(14,9,40,.62)'); g.addColorStop(0.55, 'rgba(14,9,40,.38)'); g.addColorStop(1, 'rgba(8,4,24,.7)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, vw, vh);
    // Пузыри — ведь это пузырь.
    for (const b of bubbles) {
      b.y -= b.v * 0.016; b.x += Math.sin(now / 1000 * b.w + b.ph) * 0.15;
      if (b.y < -20) { b.y = vh + 20; b.x = Math.random() * vw; }
      ctx.strokeStyle = 'rgba(200,230,255,.22)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.28)';
      ctx.beginPath(); ctx.arc(b.x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.22, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawTitle() {
    const c = G.c, px = G.px, fw = game.PW * c;
    const tf = Math.min(c * 0.85, fw / 15.5);
    const ty = G.top + c * 0.8;
    ctx.font = `900 ${Math.round(tf)}px ${FONT_D}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(8,4,24,.5)'; ctx.fillText('ВСЯ МИРОВАЯ ЭКОНОМИКА', px, ty + 2);
    ctx.fillStyle = C.cream; ctx.fillText('ВСЯ МИРОВАЯ ЭКОНОМИКА', px, ty);
    const by = ty + c * 0.28, q = c * 0.32, l = px - fw / 2 + c * 0.2, r = px + fw / 2 - c * 0.2;
    ctx.strokeStyle = rgba('#fff3d6', 0.8); ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(l, by + q); ctx.quadraticCurveTo(l, by, l + q, by); ctx.lineTo(px - q, by);
    ctx.quadraticCurveTo(px, by, px, by - q * 0.8); ctx.quadraticCurveTo(px, by, px + q, by);
    ctx.lineTo(r - q, by); ctx.quadraticCurveTo(r, by, r, by + q); ctx.stroke();
  }

  function drawStand(now) {
    const c = G.c, px = G.px, py = G.py;
    const danger = clamp(Math.abs(game.theta) / game.cfg.crit, 0, 1);
    const hot = mode === 'play' ? clamp((danger - 0.5) / 0.5, 0, 1) : (mode === 'crash' || mode === 'over') ? 1 : 0;
    const stickH = G.stick * c;
    const gy = py + stickH; // верх видеокарты
    // Видеокарта-постамент и свечение под ней.
    const gh = G.gpuH * c * 0.96, gw = Math.min(G.aw * 0.92, gh * (GPU.naturalWidth ? GPU.naturalWidth / GPU.naturalHeight : 1.53));
    const glow = ctx.createRadialGradient(px, gy + gh * 0.55, 4, px, gy + gh * 0.55, gw * 0.7);
    const gc = hot > 0 ? `rgba(255,${Math.round(77 + 160 * (1 - hot))},94,` : 'rgba(79,240,176,';
    glow.addColorStop(0, gc + (0.32 + 0.1 * Math.sin(now / 300)) + ')'); glow.addColorStop(1, gc + '0)');
    ctx.fillStyle = glow; ctx.fillRect(px - gw, gy - gh * 0.2, gw * 2, gh * 1.6);
    if (GPU.complete && GPU.naturalWidth) {
      ctx.drawImage(GPU, px - gw / 2, gy - gh * 0.08, gw, gh);
      // Вентиляторы крутятся: быстрее, когда мир кренится («нужно больше охлаждения»).
      const spin = now / 1000 * (4 + danger * 18);
      for (const fx of [0.348, 0.75]) {
        const cx = px - gw / 2 + gw * fx, cy = gy - gh * 0.08 + gh * 0.34, rad = gw * 0.165;
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(spin);
        ctx.strokeStyle = hot > 0.3 ? 'rgba(255,120,120,.35)' : 'rgba(180,255,220,.28)'; ctx.lineWidth = rad * 0.16;
        for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(0, 0, rad * 0.62, k * 2.09, k * 2.09 + 0.9); ctx.stroke(); }
        ctx.restore();
      }
    }
    // Палка Хуанга: хромированный стержень, краснеет и искрит на грани.
    const bend = (mode === 'crash' || mode === 'over') ? crashSide * c * 0.7 * Math.min(1, crashT * 2) : game.theta * c * 1.3;
    const sw = Math.max(5, c * 0.32);
    const sg = ctx.createLinearGradient(px - sw, 0, px + sw, 0);
    sg.addColorStop(0, '#5d5a7a'); sg.addColorStop(0.45, '#f2f0ff'); sg.addColorStop(1, '#4a4766');
    ctx.save();
    if (hot > 0) { ctx.shadowColor = `rgba(255,77,94,${0.4 + 0.5 * hot})`; ctx.shadowBlur = c * (0.4 + hot); }
    ctx.strokeStyle = sg; ctx.lineWidth = sw; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(px, gy + 2); ctx.quadraticCurveTo(px + bend * 0.2, py + stickH * 0.5, px + bend * 0.05, py); ctx.stroke();
    if (hot > 0) {
      ctx.strokeStyle = `rgba(255,77,94,${0.6 * hot})`; ctx.lineWidth = sw * 0.45;
      ctx.beginPath(); ctx.moveTo(px, gy); ctx.quadraticCurveTo(px + bend * 0.2, py + stickH * 0.5, px + bend * 0.05, py); ctx.stroke();
    }
    ctx.restore();
    if (mode === 'play' && danger > 0.75 && Math.random() < danger * 0.5) {
      parts.push({ k: 'spark', x: px + (Math.random() - 0.5) * 6, y: py + 4, vx: (Math.random() - 0.5) * 260, vy: -80 - Math.random() * 160, t: 0, life: 0.45, col: Math.random() < 0.5 ? C.gold : C.red, s: 2 + Math.random() * 2 });
    }
    // Подпись мема со стрелкой.
    const lf = Math.max(10, Math.round(c * 0.5));
    ctx.font = `900 ${lf}px ${FONT_D}`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    const lx = px + c * 1.25, ly = py + stickH * 0.5;
    ctx.fillStyle = C.cream; ctx.fillText('ЧЛЕН', lx, ly); ctx.fillText('ХУАНГА', lx, ly + lf * 1.1);
    ctx.strokeStyle = C.cream; ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(lx - 5, ly - lf * 0.35); ctx.quadraticCurveTo(px + c * 0.7, ly - lf * 0.9, px + c * 0.32, ly - lf * 0.1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(px + c * 0.32 + 7, ly - lf * 0.1 - 2); ctx.lineTo(px + c * 0.32, ly - lf * 0.1); ctx.lineTo(px + c * 0.32 + 3, ly - lf * 0.1 - 8); ctx.stroke();
    // «Крен рынка −N%» рядом с палкой.
    if (mode === 'play' && danger > 0.15) {
      ctx.font = `900 ${Math.max(11, Math.round(c * 0.5))}px ${FONT_D}`; ctx.textAlign = 'right';
      ctx.fillStyle = danger > 0.66 ? C.red : C.cream;
      ctx.fillText(`Крен рынка −${tiltPct(game.theta)}%`, px - c * 1.2 + (danger > 0.8 ? Math.sin(now / 40) * 2 : 0), py + stickH * 0.62);
    }
  }

  function drawBoard(now, pred) {
    if (mode === 'crash' || mode === 'over') return; // мир уже обломками
    const c = G.c, W = G.W, H = G.H, h0 = G.h0, O = game.O, PW = game.PW;
    ctx.save();
    ctx.translate(G.px, G.py);
    ctx.rotate(game.theta);
    const X = (col) => (col - W / 2) * c;
    // «Воздух» по бокам: сюда можно свесить плитку.
    ctx.fillStyle = 'rgba(79,240,176,.035)';
    ctx.fillRect(X(0), -(H + h0) * c, O * c, H * c); ctx.fillRect(X(O + PW), -(H + h0) * c, O * c, H * c);
    ctx.strokeStyle = 'rgba(79,240,176,.18)'; ctx.setLineDash([3, 7]); ctx.lineWidth = 1.5;
    for (const col of [O, O + PW]) { ctx.beginPath(); ctx.moveTo(X(col), -h0 * c); ctx.lineTo(X(col), -(H + h0) * c); ctx.stroke(); }
    ctx.setLineDash([]);
    // Полоса прицела под падающей плиткой.
    const p = game.piece;
    if (p && mode === 'play') {
      const lane = ctx.createLinearGradient(0, -(H + h0) * c, 0, -h0 * c);
      const col = pred && (pred.fall || pred.miss) ? '255,77,94' : '255,255,255';
      lane.addColorStop(0, `rgba(${col},0)`); lane.addColorStop(1, `rgba(${col},.10)`);
      ctx.fillStyle = lane; ctx.fillRect(X(pv.x), -(H + h0) * c, p.size * c, H * c);
    }
    // Потолок.
    ctx.strokeStyle = 'rgba(255,77,94,.4)'; ctx.setLineDash([10, 8]); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(X(0), -(H + h0) * c); ctx.lineTo(X(W), -(H + h0) * c); ctx.stroke(); ctx.setLineDash([]);
    // Подставка: тёмная плита с неоновой кромкой.
    const pg = ctx.createLinearGradient(0, -h0 * c, 0, 0);
    pg.addColorStop(0, '#3a2c86'); pg.addColorStop(1, '#1d1550');
    ctx.save(); ctx.shadowColor = 'rgba(79,240,176,.5)'; ctx.shadowBlur = c * 0.5;
    rr(ctx, X(O) - 4, -h0 * c, PW * c + 8, h0 * c, 6); ctx.fillStyle = pg; ctx.fill(); ctx.restore();
    ctx.strokeStyle = C.mint; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(X(O) + 2, -h0 * c + 1); ctx.lineTo(X(O + PW) - 2, -h0 * c + 1); ctx.stroke();

    // Кубики на поле.
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
      const x = X(b.c0), y = -(b.r1 + 1 + h0) * c;
      // Желейная пружинка: сплющился, подпрыгнул, успокоился.
      let sx = 1, sy = 1;
      const a = anim.get(id);
      if (a) {
        const t = (now - a.t0) / 1000;
        if (t > 0.9) anim.delete(id);
        else if (t > 0) { const k = a.amp * Math.exp(-t * 7) * Math.cos(t * 30); sy = 1 - k; sx = 1 + k * 0.7; }
      }
      ctx.save(); ctx.translate(x + w / 2, y + h); ctx.scale(sx, sy);
      drawCube(ctx, -w / 2, -h, w, h, blk, c, 1, false);
      ctx.restore();
    }
    // Тень посадки и падающая плитка.
    if (p && mode === 'play') {
      if (pred && !pred.miss) {
        ctx.save();
        ctx.strokeStyle = pred.fall ? C.red : C.gold; ctx.lineWidth = 2.5; ctx.setLineDash([7, 6]);
        ctx.lineDashOffset = -now / 40;
        rr(ctx, X(pred.x) + 3, -(pred.y + p.size + h0) * c + 3, p.size * c - 6, p.size * c - 6, c * 0.2); ctx.stroke();
        ctx.restore();
      }
      const st = clamp((now - spawnT) / 260, 0, 1);
      const pop = st < 1 ? 1 + Math.sin(st * Math.PI) * 0.18 - (1 - st) * 0.6 : 1;
      const stretch = game.soft ? 1.08 : 1;
      const x = X(pv.x), y = -(pv.y + p.size + h0) * c, s = p.size * c;
      ctx.save(); ctx.translate(x + s / 2, y + s / 2); ctx.scale(pop / Math.sqrt(stretch), pop * stretch);
      drawCube(ctx, -s / 2, -s / 2, s, s, p, c, 1, true);
      ctx.restore();
    }
    ctx.restore();
  }

  function drawFx(dt, now) {
    for (const tr of trails.splice(0)) if (tr.t + dt < tr.life) { tr.t += dt; trails.push(tr); }
    for (const tr of trails) {
      const k = 1 - tr.t / tr.life;
      const g = ctx.createLinearGradient(tr.x0, tr.y0, tr.x1, tr.y1);
      g.addColorStop(0, rgba(tr.col, 0)); g.addColorStop(1, rgba(tr.col, 0.45 * k));
      ctx.strokeStyle = g; ctx.lineWidth = tr.w * k; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(tr.x0, tr.y0); ctx.lineTo(tr.x1, tr.y1); ctx.stroke();
    }
    for (let i = parts.length - 1; i >= 0; i--) {
      const q = parts[i];
      q.t += dt;
      if (q.t >= q.life) { parts.splice(i, 1); continue; }
      const k = q.t / q.life;
      if (q.k === 'coin') {
        const e = k * k * (3 - 2 * k);
        const x = lerp(q.x, q.tx, e) + Math.sin(k * Math.PI) * q.sw, y = lerp(q.y, q.ty, e) - Math.sin(k * Math.PI) * q.arc;
        const r = q.s * (1 - k * 0.4), sq = Math.abs(Math.cos(now / 90 + q.ph));
        ctx.fillStyle = '#ffb21f'; ctx.beginPath(); ctx.ellipse(x, y, r * Math.max(0.25, sq), r, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = C.gold; ctx.beginPath(); ctx.ellipse(x, y, r * 0.78 * Math.max(0.25, sq), r * 0.78, 0, 0, Math.PI * 2); ctx.fill();
        if (!q.done && k > 0.97) { q.done = true; sfx.coin(q.n % 6); }
      } else if (q.k === 'ring') {
        ctx.strokeStyle = rgba(q.col, 0.7 * (1 - k)); ctx.lineWidth = 3 * (1 - k) + 1;
        ctx.beginPath(); ctx.ellipse(q.x, q.y, q.r * (0.4 + k * 1.2), q.r * 0.28 * (0.4 + k * 1.2), q.rot, 0, Math.PI * 2); ctx.stroke();
      } else if (q.k === 'puff') {
        q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 0.92; q.vy *= 0.92;
        ctx.fillStyle = `rgba(230,225,255,${0.35 * (1 - k)})`;
        ctx.beginPath(); ctx.arc(q.x, q.y, q.s * (0.6 + k), 0, Math.PI * 2); ctx.fill();
      } else if (q.k === 'flash') {
        ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.rot);
        ctx.fillStyle = `rgba(255,255,255,${1 - k})`; rr(ctx, -q.s / 2 - 2, -q.s / 2 - 2, q.s + 4, q.s + 4, q.s * 0.2); ctx.fill();
        ctx.restore();
      } else if (q.k === 'confetti') {
        q.vy += 700 * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.rot += q.vr * dt;
        ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.rot); ctx.globalAlpha = 1 - k;
        ctx.fillStyle = q.col; ctx.fillRect(-q.s, -q.s * 0.4, q.s * 2, q.s * 0.8); ctx.restore();
      } else { // spark
        q.vy += 600 * dt; q.x += q.vx * dt; q.y += q.vy * dt;
        ctx.globalAlpha = 1 - k; ctx.fillStyle = q.col;
        ctx.beginPath(); ctx.arc(q.x, q.y, q.s * (1 - k * 0.5), 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
      }
    }
    for (const d of debris) {
      d.vy += 1500 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.rot += d.vr * dt;
      const floor = G.vh - d.h * 0.5;
      if (d.y > floor && !d.gone) { d.y = floor; d.vy *= -0.35; d.vx *= 0.7; d.vr *= 0.6; }
      ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.rot);
      if (d.blk) drawCube(ctx, -d.w / 2, -d.h / 2, d.w, d.h, d.blk, G.c, 1, false);
      else { ctx.fillStyle = '#2b2070'; rr(ctx, -d.w / 2, -d.h / 2, d.w, d.h, 6); ctx.fill(); ctx.strokeStyle = C.mint; ctx.lineWidth = 2; ctx.stroke(); }
      ctx.restore();
    }
    for (let i = toasts.length - 1; i >= 0; i--) {
      const t = toasts[i];
      t.t += dt;
      if (t.t > t.dur) { toasts.splice(i, 1); continue; }
      const k = t.t / t.dur;
      const pop = t.t < 0.3 ? 1 + 0.4 * Math.sin((t.t / 0.3) * Math.PI) * (1 - t.t / 0.3) + (t.t / 0.3 - 1) * 0.0 : 1;
      const fs = Math.round(G.c * t.size * (t.t < 0.12 ? t.t / 0.12 : pop));
      if (fs < 2) continue;
      ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
      ctx.font = `900 ${fs}px ${FONT_D}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const y = t.y - k * G.c * t.rise;
      ctx.lineWidth = Math.max(3, fs / 5); ctx.strokeStyle = 'rgba(14,8,40,.9)'; ctx.lineJoin = 'round';
      ctx.strokeText(t.text, t.x, y); ctx.fillStyle = t.col; ctx.fillText(t.text, t.x, y);
      ctx.globalAlpha = 1;
    }
    if (mode === 'crash' || mode === 'over') drawBurst(now);
    if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${flash})`; ctx.fillRect(0, 0, G.vw, G.vh); flash = Math.max(0, flash - dt * 4); }
  }

  // Комикс-взрыв позади окна «КРАХ!».
  function drawBurst(now) {
    const k = clamp(crashT / 0.35, 0, 1);
    const e = 1 - Math.pow(1 - k, 3);
    const cx = G.mobile ? G.vw / 2 : G.ax + G.aw / 2, cy = G.mobile ? G.top + G.H * G.c * 0.45 : G.vh / 2;
    const R = Math.min(G.aw, G.vh) * 0.48 * e;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(now / 4000);
    for (const [rad, col] of [[1, 'rgba(255,77,94,.85)'], [0.8, 'rgba(255,200,74,.9)']]) {
      ctx.beginPath();
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * Math.PI * 2, rr2 = R * rad * (i % 2 ? 0.72 : 1);
        ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rr2, Math.sin(a) * rr2);
      }
      ctx.closePath(); ctx.fillStyle = col; ctx.fill();
    }
    ctx.restore();
  }

  function toast(text, col, size, x, y, rise, dur) {
    toasts.push({ text, col: col || C.cream, size: size || 1, x: x == null ? G.px : x, y: y == null ? G.py - (G.H * 0.6 + G.h0) * G.c : y, rise: rise == null ? 1.6 : rise, t: 0, dur: dur || 1.5 });
  }

  // ---------- события движка → сочность ----------
  function capPoint() { const r = $('cap').getBoundingClientRect(); return [r.left + r.width * 0.35, r.top + r.height / 2]; }
  function handleEvents(now) {
    for (const e of game.drainEvents()) {
      if (e.type === 'move') sfx.move();
      else if (e.type === 'spawn') { pv.x = e.piece.x; pv.y = e.piece.y; spawnT = now; hudNext(); }
      else if (e.type === 'land') onLand(e, now);
      else if (e.type === 'lines') onLines(e, now);
      else if (e.type === 'miss') onMiss(e, now);
      else if (e.type === 'crash') startCrash(e, now);
    }
  }
  function onLand(e, now) {
    const p = e.piece, c = G.c, th = game.theta;
    const amp = [0, 0.16, 0.2, 0.24][p.size];
    anim.set(e.id, { t0: now, amp });
    // Волна по стопке: кубики под ним тоже чуть сплющиваются, с задержкой.
    for (let r = p.y - 1; r >= 0; r--) for (let col = p.x; col < p.x + p.size; col++) {
      const id = game.cells[r] && game.cells[r][col];
      if (id != null && id !== e.id && !anim.has(id)) anim.set(id, { t0: now + (p.y - r) * 35, amp: amp * 0.45 * Math.pow(0.75, p.y - r) });
    }
    trauma = Math.min(1, trauma + 0.06 + e.heavy * 0.34);
    if (p.size === 3) freezeUntil = now + 45;
    sfx.plop(p.size);
    const [bx, by] = toScreen(p.x + p.size / 2, p.y, th);
    const col = colorOf(p);
    parts.push({ k: 'ring', x: bx, y: by, r: p.size * c * 0.9, rot: th, col, t: 0, life: 0.45 });
    for (const side of [-1, 1]) for (let i = 0; i < 3 + p.size * 2; i++)
      parts.push({ k: 'puff', x: bx + side * p.size * c * 0.45, y: by - 2, vx: side * (60 + Math.random() * 140), vy: -20 - Math.random() * 70, s: 3 + Math.random() * 4 + p.size, t: 0, life: 0.5 + Math.random() * 0.2 });
    if (p.size >= 2) for (let i = 0; i < p.size * 5; i++)
      parts.push({ k: 'spark', x: bx + (Math.random() - 0.5) * p.size * c, y: by - 3, vx: (Math.random() - 0.5) * 380, vy: -120 - Math.random() * 260, s: 1.5 + Math.random() * 2, col: Math.random() < 0.5 ? C.gold : shade(col, 0.4), t: 0, life: 0.6 });
    if (e.dropRows > 2) {
      const [tx, ty] = toScreen(p.x + p.size / 2, p.y + p.size + Math.min(e.dropRows, 8), th);
      const [ux, uy] = toScreen(p.x + p.size / 2, p.y + p.size, th);
      trails.push({ x0: tx, y0: ty, x1: ux, y1: uy, w: p.size * c * 0.9, col, t: 0, life: 0.22 });
    }
    const [sx, sy] = toScreen(p.x + p.size / 2, p.y + p.size + 0.3, th);
    toast('+' + moneyShort(p.cap * 0.1), C.gold, 0.5 + p.size * 0.07, sx, sy, 1.2, 0.9);
    hudScore();
  }
  function onLines(e, now) {
    freezeUntil = now + 80 + e.count * 30;
    trauma = Math.min(1, trauma + 0.2 + e.count * 0.1);
    sfx.merge(e.count);
    const [tx, ty] = capPoint();
    let n = 0;
    for (const cell of e.cells) {
      const [x, y] = toScreen(cell.c + 0.5, cell.r + 0.5, game.theta);
      parts.push({ k: 'flash', x, y, s: G.c, rot: game.theta, t: 0, life: 0.3 });
      for (let i = 0; i < 2; i++) parts.push({ k: 'confetti', x, y, vx: (Math.random() - 0.5) * 420, vy: -200 - Math.random() * 300, vr: (Math.random() - 0.5) * 14, rot: 0, s: 3 + Math.random() * 3, col: [C.mint, C.pink, C.gold, C.cyan][(Math.random() * 4) | 0], t: 0, life: 1 });
      if (Math.random() < 0.7) parts.push({ k: 'coin', x, y, tx, ty, sw: (Math.random() - 0.5) * 120, arc: 40 + Math.random() * 80, s: G.c * 0.28, ph: Math.random() * 6, n: n++, t: 0, life: 0.75 + Math.random() * 0.4 });
    }
    const names = ['', 'СЛИЯНИЕ', 'ДВОЙНОЕ СЛИЯНИЕ', 'ТРОЙНОЕ СЛИЯНИЕ', 'МЕГАСЛИЯНИЕ'];
    toast(names[Math.min(4, e.count)] + (e.mult > 1 ? ' ×' + String(e.mult).replace('.', ',') : ''), C.mint, 0.9 + e.count * 0.12, null, null, 1.2, 1.6);
    toast('+' + money(e.gain), C.gold, 0.75, null, G.py - (G.H * 0.6 + G.h0) * G.c + G.c * 1.3, 1.2, 1.6);
    setTimeout(() => bump('cap'), 750);
    hudScore();
  }
  function onMiss(e, now) {
    const p = e.piece, c = G.c;
    const [x, y] = toScreen(p.x + p.size / 2, p.size / 2, game.theta);
    debris.push({ x, y, w: p.size * c, h: p.size * c, blk: p, rot: game.theta, vx: (p.x < game.W / 2 ? -1 : 1) * 120, vy: 60, vr: (p.x < game.W / 2 ? -1 : 1) * 3, gone: true });
    setTimeout(() => { debris = debris.filter((d) => !d.gone || d.y < G.vh + 200); }, 2000);
    sfx.miss();
    toast(p.symbol + ' мимо!', C.red, 0.8, x, G.py - G.c * 2, 1.4, 1.3);
    hudScore();
  }
  function startCrash(e, now) {
    mode = 'crash';
    crashT = 0;
    crashSide = e.theta >= 0 ? 1 : -1;
    freezeUntil = now + 140;
    trauma = 1; flash = 0.55;
    sfx.crash();
    debris = [];
    const th = game.theta, c = G.c;
    const boxes = new Map();
    for (let r = 0; r < game.H; r++) for (let col = 0; col < game.W; col++) {
      const id = game.cells[r][col];
      if (id === null) continue;
      const b = boxes.get(id) || { c0: col, c1: col, r0: r, r1: r };
      b.c0 = Math.min(b.c0, col); b.c1 = Math.max(b.c1, col); b.r0 = Math.min(b.r0, r); b.r1 = Math.max(b.r1, r);
      boxes.set(id, b);
    }
    for (const [id, b] of boxes) {
      const [x, y] = toScreen((b.c0 + b.c1 + 1) / 2, (b.r0 + b.r1 + 1) / 2, th);
      debris.push({ x, y, w: (b.c1 - b.c0 + 1) * c, h: (b.r1 - b.r0 + 1) * c, blk: game.blocks.get(id), rot: th,
        vx: crashSide * (140 + b.r0 * 30 + Math.random() * 220), vy: -180 - Math.random() * 280, vr: (Math.random() - 0.5) * 7 });
    }
    const [bx, by] = toScreen(game.W / 2, -game.cfg.h0 / 2, th);
    debris.push({ x: bx, y: by, w: game.PW * c + 8, h: game.cfg.h0 * c, rot: th, vx: crashSide * 170, vy: -60, vr: crashSide * 2.4 });
    const total = game.banked;
    const isBest = total > best;
    if (isBest) { best = total; store.set('best', best); }
    $('overLine').textContent = `Вся мировая экономика −${e.pct.toFixed(1).replace('.', ',')}%`;
    $('overWhy').textContent = e.reason === 'top' ? 'Башня упёрлась в потолок — пузырь лопнул.' : `Перекосило ${crashSide > 0 ? 'вправо' : 'влево'}: Хуанг не удержал.`;
    $('overScore').textContent = money(total);
    $('overBest').textContent = isBest && total > 0 ? '★ Новый рекорд!' : 'рекорд ' + money(best);
    hudScore();
    setTimeout(() => { if (mode === 'crash') { mode = 'over'; show('overCard'); } }, 1400);
  }

  // ---------- окна ----------
  function show(id) {
    for (const m of document.querySelectorAll('.modal')) m.classList.toggle('show', m.id === id);
    const b = id && $(id).querySelector('.btn.go');
    if (b) setTimeout(() => b.focus(), 30);
  }
  function startGame() {
    audio();
    game.reset();
    debris = []; parts.length = 0; toasts.length = 0; trails.length = 0; anim.clear();
    shownCap = 0; flash = 0;
    mode = 'play';
    show(null);
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    hudScore(); hudNext();
    sfx.start();
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
  window.addEventListener('keyup', (e) => { if (e.code === 'ArrowDown' || e.code === 'KeyS') game.setSoft(false); });
  // Мышь и палец: ведёшь — плитка едет, клик или тап без сдвига — сброс.
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
    $('muteBtn').querySelector('use').setAttribute('href', muted ? '#i-mute' : '#i-sound');
  }
  $('muteBtn').onclick = toggleMute;
  $('muteBtn').querySelector('use').setAttribute('href', muted ? '#i-mute' : '#i-sound');
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(true); });

  // ---------- цикл ----------
  let last = performance.now();
  let warnT = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (mode === 'play' && now >= freezeUntil) game.tick(dt);
    if (mode === 'crash' || mode === 'over') crashT += dt;
    handleEvents(now);
    const p = game.piece;
    if (p) {
      pv.x += (p.x - pv.x) * Math.min(1, dt * 22);
      pv.y += (p.y - pv.y) * Math.min(1, dt * 30);
      if (Math.abs(p.y - pv.y) > 3) pv.y = p.y + Math.sign(pv.y - p.y) * 3;
    }
    const pred = mode === 'play' ? game.predict() : null;
    const danger = Math.abs(game.theta) / game.cfg.crit;
    warnT -= dt;
    if (mode === 'play' && danger > 0.8 && warnT <= 0) { sfx.warn(); warnT = 0.5; }
    // Тряска: «травма» затухает, сдвиг ~ травма², плавный синус.
    trauma = Math.max(0, trauma - dt * 1.6);
    shakeT += dt * 30;
    const sh = trauma * trauma;
    const ox = 14 * sh * Math.sin(shakeT * 1.7), oy = 10 * sh * Math.sin(shakeT * 2.3);

    // Масштаб — в каждом кадре: Chrome может сбросить состояние canvas без ошибки.
    ctx.setTransform(G.dpr, 0, 0, G.dpr, 0, 0);
    drawBackground(now);
    if (mode === 'play' && danger > 0.55) {
      const a = Math.min(0.32, (danger - 0.55) * 0.7) * (0.75 + 0.25 * Math.sin(now / 120));
      const g = ctx.createRadialGradient(G.px, G.vh / 2, Math.min(G.vw, G.vh) * 0.3, G.px, G.vh / 2, Math.max(G.vw, G.vh) * 0.75);
      g.addColorStop(0, 'rgba(255,77,94,0)'); g.addColorStop(1, `rgba(255,77,94,${a})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, G.vw, G.vh);
    }
    ctx.save();
    ctx.translate(ox, oy);
    drawTitle();
    drawStand(now);
    drawBoard(now, pred);
    ctx.restore();
    drawFx(dt, now);
    hudTilt(pred);
    hudCap(dt);
    requestAnimationFrame(frame);
  }

  // Для проверок из браузера (Playwright).
  window.__balance = { get game() { return game; }, get mode() { return mode; }, start: startGame, layout: () => G, version: VERSION, toScreen };

  window.addEventListener('resize', layout);
  layout();
  for (let i = 0; i < 14; i++) bubbles.push({ x: Math.random() * innerWidth, y: Math.random() * innerHeight, r: 4 + Math.random() * 12, v: 10 + Math.random() * 22, w: 0.5 + Math.random(), ph: Math.random() * 6 });
  hudScore(); hudNext();
  show('startCard');
  loadQuotes();
  requestAnimationFrame(frame);
})();
