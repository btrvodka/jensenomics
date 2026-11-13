import * as THREE from 'three';

// ---------- общие настройки ----------
const S = 1.6;            // масштаб сердца-«мировой экономики»
const K = 1.25;           // «толщина» сердца по глубине
const TEX_W = 4096, TEX_H = 2048;
const MAIN_TOP = 0.13, MAIN_BOT = 0.9; // какую полосу текстуры занимает treemap

const state = { quotes: [], bySym: {}, avg: 0, avgAbs: 0, loaded: false, marketOpen: false };

// ---------- неявное уравнение 3D-сердца (z — вверх, y — глубина) ----------
function F(x, y, z) {
  const a = x * x + K * y * y + z * z - 1;
  return a * a * a - x * x * z * z * z - (K / 20) * y * y * z * z * z;
}
function gradF(x, y, z) {
  const a = x * x + K * y * y + z * z - 1, a2 = 3 * a * a;
  return [
    a2 * 2 * x - 2 * x * z * z * z,
    a2 * 2 * K * y - (K / 10) * y * z * z * z,
    a2 * 2 * z - 3 * x * x * z * z - (3 * K / 20) * y * y * z * z,
  ];
}
function radiusAlong(dx, dy, dz) {
  let r = 0;
  const step = 0.01;
  while (r < 2.5 && F(dx * r, dy * r, dz * r) <= 0) r += step;
  let lo = Math.max(0, r - step), hi = r;
  for (let i = 0; i < 24; i++) {
    const m = (lo + hi) / 2;
    if (F(dx * m, dy * m, dz * m) <= 0) lo = m; else hi = m;
  }
  return lo;
}
function surfaceTop(x, y) {           // высота верхней поверхности в точке (x, y)
  for (let z = 1.6; z > -1; z -= 0.003) if (F(x, y, z) <= 0) return z;
  return 0;
}
function halfWidthAt(z) {
  for (let x = 1.4; x > 0; x -= 0.005) if (F(x, 0, z) <= 0) return x;
  return 0;
}

// ---------- рендерер / сцена ----------
const host = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
host.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);

scene.add(new THREE.HemisphereLight(0xffffff, 0xb8b0a0, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(4, 6, 8);
scene.add(sun);

const gradientMap = new THREE.DataTexture(new Uint8Array([110, 190, 255]), 3, 1, THREE.RedFormat);
gradientMap.minFilter = gradientMap.magFilter = THREE.NearestFilter;
gradientMap.needsUpdate = true;
const toon = (opts) => new THREE.MeshToonMaterial({ gradientMap, ...opts });
const INK = new THREE.MeshBasicMaterial({ color: 0x161616, side: THREE.BackSide });

function outlineByNormals(mesh, t) {
  const g = mesh.geometry.clone();
  const p = g.attributes.position, n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i, p.getX(i) + n.getX(i) * t, p.getY(i) + n.getY(i) * t, p.getZ(i) + n.getZ(i) * t);
  }
  const o = new THREE.Mesh(g, INK);
  o.raycast = () => {};
  mesh.add(o);
  return o;
}
function outlineByScale(mesh, t) {
  mesh.geometry.computeBoundingBox();
  const s = new THREE.Vector3();
  mesh.geometry.boundingBox.getSize(s);
  const o = new THREE.Mesh(mesh.geometry, INK);
  o.scale.set(1 + 2 * t / s.x, 1 + 2 * t / s.y, 1 + 2 * t / s.z);
  o.raycast = () => {};
  mesh.add(o);
  return o;
}

// иерархия: pivot (кончик пальца) → tilt (качание) → spinner (вращение) → heartGroup
const pivot = new THREE.Group();
scene.add(pivot);
const tilt = new THREE.Group();
pivot.add(tilt);
const spinner = new THREE.Group();
tilt.add(spinner);
const heartGroup = new THREE.Group();
heartGroup.scale.setScalar(S);
spinner.add(heartGroup);

// ---------- текстура treemap ----------
const texCanvas = document.createElement('canvas');
texCanvas.width = TEX_W; texCanvas.height = TEX_H;
const tctx = texCanvas.getContext('2d');
const heartTex = new THREE.CanvasTexture(texCanvas);
heartTex.colorSpace = THREE.SRGBColorSpace;
heartTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
let tiles = []; // [{x,y,w,h,q}]

// ---------- геометрия сердца ----------
{
  const geo = new THREE.SphereGeometry(1, 192, 144);
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    // three: X вправо, Y вверх, Z на нас → сердце: x = X, z = Y, y = Z
    const X = pos.getX(i), Y = pos.getY(i), Z = pos.getZ(i);
    const r = radiusAlong(X, Z, Y);
    const hx = X * r, hy = Z * r, hz = Y * r;
    pos.setXYZ(i, hx, hz, hy);
    const g = gradF(hx, hy, hz);
    let nx = g[0], ny = g[2], nz = g[1];
    let len = Math.hypot(nx, ny, nz);
    if (len < 1e-4) { nx = X; ny = Y; nz = Z; len = 1; }
    nrm.setXYZ(i, nx / len, ny / len, nz / len);
  }
  const heart = new THREE.Mesh(geo, toon({ map: heartTex }));
  heart.position.y = 1; // кончик сердца (z = -1) ровно на пальце
  heart.name = 'heart';
  heartGroup.add(heart);
  outlineByNormals(heart, 0.022);
}
const heartMesh = heartGroup.getObjectByName('heart');

// ---------- башенки на «ушах» сердца ----------
const stacks = [
  { x: -0.55, y: 0.02, blocks: [[0.25, 0.34, 'NVDA'], [0.18, 0.24, 'AMD'], [0.12, 0.18, 'ARM'], [0.06, 0.12, null]] },
  { x: -0.87, y: 0.06, blocks: [[0.13, 0.24, 'INTC'], [0.08, 0.12, null]] },
  { x: -0.28, y: -0.12, blocks: [[0.14, 0.28, 'AVGO'], [0.09, 0.14, 'MU']] },
  { x: 0.55, y: 0.0, blocks: [[0.25, 0.3, 'MSFT'], [0.19, 0.24, 'GOOGL'], [0.13, 0.18, 'META'], [0.06, 0.13, null]] },
  { x: 0.85, y: -0.07, blocks: [[0.13, 0.22, 'ORCL'], [0.08, 0.11, null]] },
  { x: 0.3, y: 0.13, blocks: [[0.13, 0.26, 'PLTR'], [0.08, 0.12, 'AMZN']] },
];
const towerBlocks = []; // {mesh, canvas, tex, sym, parentSym}
for (const st of stacks) {
  let y = surfaceTop(st.x, st.y) + 1 - 0.14; // +1: сердце смещено вверх
  for (const [r, h, sym] of st.blocks) {
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 128;
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.repeat.x = r > 0.15 ? 2 : 1;
    const side = toon({ map: tex });
    const cap = toon({ color: 0x444444 });
    const geo = new THREE.CylinderGeometry(r, r * 1.04, h, 28);
    const m = new THREE.Mesh(geo, [side, cap, cap]);
    m.position.set(st.x, y + h / 2, st.y);
    heartGroup.add(m);
    outlineByScale(m, 0.012);
    const b = { mesh: m, cv, tex, cap, sym, parentSym: st.blocks[0][2], small: r < 0.1 };
    m.userData.block = b;
    towerBlocks.push(b);
    y += h - 0.01;
  }
}

// ---------- постамент и красный стержень, как в исходном меме ----------
{
  const ROD_H = 2.2;
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, ROD_H, 24), toon({ color: 0xd62a2a }));
  rod.position.y = -ROD_H / 2;
  scene.add(rod);
  outlineByScale(rod, 0.025);
  const shine = new THREE.Mesh(new THREE.BoxGeometry(0.025, ROD_H * 0.85, 0.02), new THREE.MeshBasicMaterial({ color: 0xff8a80 }));
  shine.position.set(-0.04, -ROD_H / 2, 0.085);
  scene.add(shine);

  const white = toon({ color: 0xf2f0ea });
  const top = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.32, 1.4), white);
  top.position.y = -ROD_H - 0.16;
  scene.add(top);
  outlineByScale(top, 0.03);
  const base = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.3, 2.2), white);
  base.position.y = -ROD_H - 0.32 - 0.15;
  scene.add(base);
  outlineByScale(base, 0.03);

  const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 40),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.1 }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.set(2.6, 1.3, 1);
  shadow.position.y = -ROD_H - 0.63;
  scene.add(shadow);
}

// ---------- вихри вокруг пузыря ----------
const swirlMat = new THREE.MeshBasicMaterial({ color: 0x1b1b1b });
const swirls = [];
{
  const defs = [
    [0.35, 1.9, 0.0, 2.3], [0.85, 2.0, 2.4, 1.6], [1.35, 1.7, 4.2, 2.0],
    [1.7, 1.8, 1.0, 1.5], [2.15, 1.6, 3.3, 1.9], [2.7, 1.5, 5.4, 1.3], [3.2, 1.3, 0.6, 1.2],
  ];
  for (let [hWorld, speed, a0, span] of defs) {
    hWorld *= S / 1.6;
    const z = hWorld / S - 1;
    const R = (halfWidthAt(Math.max(-0.95, Math.min(1.1, z))) + 0.22) * S;
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const a = a0 + span * (i / 40);
      pts.push(new THREE.Vector3(Math.cos(a) * R, 0.06 * Math.sin(a * 2), Math.sin(a) * R));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 60, 0.022, 6, false), swirlMat);
    const g = new THREE.Group();
    g.position.y = hWorld;
    g.rotation.x = 0.12;
    g.add(tube);
    tilt.add(g);
    swirls.push({ g, speed });
  }
}

// ---------- цвета ----------
function lerp(a, b, t) { return a + (b - a) * t; }
function mix(c1, c2, t) {
  const p = (c) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  const [a, b] = [p(c1), p(c2)];
  return `rgb(${a.map((v, i) => Math.round(lerp(v, b[i], t))).join(',')})`;
}
function tileColor(q) {
  if (!q || !q.live) return '#7d7a74';
  const v = Math.max(-1, Math.min(1, q.changePct / 3));
  if (v >= 0) return mix('#3d5a45', '#22b350', Math.pow(v, 0.6));
  return mix('#5e3434', '#e3262b', Math.pow(-v, 0.6));
}
const fmtPct = (p) => (p > 0 ? '+' : '') + p.toFixed(2) + '%';

// ---------- squarified treemap ----------
function squarify(items, x, y, w, h) {
  const out = [];
  const total = items.reduce((s, it) => s + it.v, 0);
  if (!total) return out;
  const scale = (w * h) / total;
  const nodes = items.map((it) => ({ ...it, a: it.v * scale })).sort((a, b) => b.a - a.a);
  let row = [];
  const worst = (r, side) => {
    const s = r.reduce((t, n) => t + n.a, 0);
    let mx = 0;
    for (const n of r) mx = Math.max(mx, (side * side * n.a) / (s * s), (s * s) / (side * side * n.a));
    return mx;
  };
  const layoutRow = (r) => {
    const s = r.reduce((t, n) => t + n.a, 0);
    if (w >= h) {
      const rw = s / h; let yy = y;
      for (const n of r) { const nh = n.a / rw; out.push({ ...n, x, y: yy, w: rw, h: nh }); yy += nh; }
      x += rw; w -= rw;
    } else {
      const rh = s / w; let xx = x;
      for (const n of r) { const nw = n.a / rh; out.push({ ...n, x: xx, y, w: nw, h: rh }); xx += nw; }
      y += rh; h -= rh;
    }
  };
  for (const n of nodes) {
    const side = Math.min(w, h);
    if (!row.length || worst([...row, n], side) <= worst(row, side)) row.push(n);
    else { layoutRow(row); row = [n]; }
  }
  if (row.length) layoutRow(row);
  return out;
}

function rng(seed) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
}

function drawTile(ctx, t, q, labels = true) {
  const pad = 3;
  const x = t.x + pad, y = t.y + pad, w = t.w - pad * 2, h = t.h - pad * 2;
  if (w <= 1 || h <= 1) return;
  ctx.fillStyle = tileColor(q);
  ctx.fillRect(x, y, w, h);
  // мультяшный объём: блик сверху, тень снизу
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.fillRect(x, y, w, Math.min(h * 0.18, 18));
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(x, y + h - Math.min(h * 0.12, 12), w, Math.min(h * 0.12, 12));
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#161616';
  ctx.strokeRect(x, y, w, h);
  if (!labels || !q) return;
  const fs = Math.min(w / (q.symbol.length * 0.68 + 0.6), h / 2.6, 150);
  if (fs < 16) return;
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${fs}px Rubik, sans-serif`;
  ctx.lineWidth = Math.max(3, fs / 9);
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  const cy = y + h / 2 - fs * 0.32;
  ctx.strokeText(q.symbol, x + w / 2, cy);
  ctx.fillText(q.symbol, x + w / 2, cy);
  const fs2 = fs * 0.5;
  if (fs2 >= 11 && q.live) {
    ctx.font = `700 ${fs2}px Rubik, sans-serif`;
    ctx.lineWidth = Math.max(2, fs2 / 8);
    ctx.strokeText(fmtPct(q.changePct), x + w / 2, cy + fs * 0.82);
    ctx.fillText(fmtPct(q.changePct), x + w / 2, cy + fs * 0.82);
  }
}

function drawTexture() {
  const ctx = tctx;
  ctx.fillStyle = '#161616';
  ctx.fillRect(0, 0, TEX_W, TEX_H);
  const qs = state.quotes;
  if (!qs.length) { heartTex.needsUpdate = true; return; }

  // мозаика из мелких плиток у «полюсов» (выемка сверху и кончик снизу)
  const r = rng(42);
  const band = (y0, y1) => {
    let y = y0;
    while (y < y1) {
      const rh = Math.min(30 + r() * 50, y1 - y);
      let x = 0;
      while (x < TEX_W) {
        const rw = Math.min(30 + r() * 90, TEX_W - x);
        drawTile(ctx, { x, y, w: rw, h: rh }, qs[Math.floor(r() * qs.length)], false);
        x += rw;
      }
      y += rh;
    }
  };
  band(0, TEX_H * MAIN_TOP);
  band(TEX_H * MAIN_BOT, TEX_H);

  // основной treemap: группы → бумаги
  const groups = {};
  for (const q of qs) (groups[q.group] ||= []).push(q);
  const gItems = Object.entries(groups).map(([name, list]) => ({ name, list, v: list.reduce((s, q) => s + Math.pow(q.cap, 0.45), 0) }));
  const y0 = TEX_H * MAIN_TOP, gh = TEX_H * (MAIN_BOT - MAIN_TOP);
  tiles = [];
  for (const g of squarify(gItems, 0, y0, TEX_W, gh)) {
    const inner = squarify(g.list.map((q) => ({ q, v: Math.pow(q.cap, 0.45) })), g.x + 6, g.y + 6, g.w - 12, g.h - 12);
    for (const t of inner) { drawTile(ctx, t, t.q); tiles.push(t); }
    ctx.lineWidth = 12;
    ctx.strokeStyle = '#161616';
    ctx.strokeRect(g.x + 3, g.y + 3, g.w - 6, g.h - 6);
  }
  heartTex.needsUpdate = true;
}

function drawTowers() {
  for (const b of towerBlocks) {
    const q = state.bySym[b.sym] || state.bySym[b.parentSym];
    const c = b.cv.getContext('2d');
    c.fillStyle = tileColor(q);
    c.fillRect(0, 0, 256, 128);
    c.fillStyle = 'rgba(255,255,255,0.18)'; c.fillRect(0, 0, 256, 18);
    c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(0, 110, 256, 18);
    c.strokeStyle = '#161616'; c.lineWidth = 6;
    for (let x = 0; x <= 256; x += b.small ? 64 : 256) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, 128); c.stroke(); }
    if (b.sym && q) {
      c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = `900 ${b.sym.length > 4 ? 46 : 54}px Rubik, sans-serif`;
      c.fillText(b.sym, 128, 46);
      if (q.live) { c.font = '700 32px Rubik, sans-serif'; c.fillText(fmtPct(q.changePct), 128, 92); }
    }
    b.tex.needsUpdate = true;
    b.cap.color.set(tileColor(q)).multiplyScalar(0.7);
  }
}

// ---------- панель ----------
const $ = (id) => document.getElementById(id);

// ---------- языки ----------
const I18N = {
  ru: {
    docTitle: 'Вся мировая экономика',
    title: ['ВСЯ МИРОВАЯ ЭКОНОМИКА'], titleNarrow: ['ВСЯ МИРОВАЯ', 'ЭКОНОМИКА'],
    label: ['ЧЛЕН ХУАНГА'], labelNarrow: ['ЧЛЕН', 'ХУАНГА'],
    capTitle: 'Капитализация всей мировой экономики', hypeTitle: 'Индекс надутости',
    gainersTitle: 'Надуваются', losersTitle: 'Сдуваются',
    more: 'ещё', less: 'скрыть', loading: 'загрузка…',
    disclaimer: 'Данные: Yahoo Finance, с задержкой. Размер плиток ≈ капитализация. Не инвестиционный совет, а мем.',
    perDay: 'за день', waiting: 'ждём котировки…', inGreen: (u, n) => `${u}/${n} в плюсе`,
    moods: ['ЛОПАЕТСЯ', 'шипит и сдувается', 'лёгкая утечка воздуха', 'крутится ровно', 'Хуанг доволен', 'надувается как никогда', 'TO THE MOON'],
    demo: 'ДЕМО-режим: котировки выдуманы', open: 'Биржа открыта — крутим', closed: 'Биржа закрыта — крутится по инерции',
    updated: 'обновлено ', noServer: 'нет связи с сервером: ', noData: 'нет данных',
    trn: ' трлн', bln: ' млрд', decimal: ',', locale: 'ru-RU',
    groups: { chips: 'Чипы', megacaps: 'Мегакэпы', software: 'Софт', hardware: 'Железо' },
  },
  en: {
    docTitle: 'The Entire World Economy',
    title: ['THE ENTIRE WORLD ECONOMY'], titleNarrow: ['THE ENTIRE', 'WORLD ECONOMY'],
    label: ["HUANG'S DICK"], labelNarrow: ["HUANG'S", 'DICK'],
    capTitle: 'Market cap of the entire world economy', hypeTitle: 'Hype index',
    gainersTitle: 'Inflating', losersTitle: 'Deflating',
    more: 'more', less: 'hide', loading: 'loading…',
    disclaimer: 'Data: Yahoo Finance, delayed. Tile size ≈ market cap. Not investment advice, just a meme.',
    perDay: 'today', waiting: 'waiting for quotes…', inGreen: (u, n) => `${u}/${n} in the green`,
    moods: ['POPPING', 'hissing and deflating', 'slow air leak', 'spinning steady', 'Jensen is pleased', 'inflating like never before', 'TO THE MOON'],
    demo: 'DEMO mode: quotes are made up', open: 'Market open — spinning', closed: 'Market closed — spinning on inertia',
    updated: 'updated ', noServer: 'no connection to server: ', noData: 'no data',
    trn: 'T', bln: 'B', decimal: '.', locale: 'en-US',
    groups: { chips: 'Chips', megacaps: 'Megacaps', software: 'Software', hardware: 'Hardware' },
  },
};
let lang = 'ru';
try { lang = localStorage.getItem('lang') || ''; } catch {}
if (!I18N[lang]) lang = (navigator.language || '').toLowerCase().startsWith('ru') ? 'ru' : 'en';
const T = () => I18N[lang];
let lastSnap = null;
function applyLang() {
  document.documentElement.lang = lang;
  document.title = T().docTitle;
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const v = T()[el.dataset.i18n];
    if (typeof v === 'string') el.textContent = v;
  }
  if (!$('panel').classList.contains('collapsed')) $('toggle').textContent = T().less;
  for (const b of document.querySelectorAll('#lang button')) b.classList.toggle('on', b.dataset.lang === lang);
  if (lastSnap) renderPanel(lastSnap);
}
for (const b of document.querySelectorAll('#lang button')) {
  b.onclick = () => {
    lang = b.dataset.lang;
    try { localStorage.setItem('lang', lang); } catch {}
    applyLang();
  };
}
function moneyB(b) {
  const a = Math.abs(b);
  if (a >= 1000) return '$' + (b / 1000).toFixed(2).replace('.', T().decimal) + T().trn;
  return '$' + Math.round(b) + T().bln;
}
function renderPanel(snap) {
  const qs = state.quotes.filter((q) => q.live);
  const cap = state.quotes.reduce((s, q) => s + q.cap, 0);
  const dCap = qs.reduce((s, q) => s + q.cap * (q.changePct / 100) / (1 + q.changePct / 100), 0);
  $('cap').textContent = '≈ ' + moneyB(cap);
  $('capchg').innerHTML = qs.length
    ? `<span>${T().perDay}</span><b class="${dCap >= 0 ? 'up' : 'down'}">${dCap >= 0 ? '+' : '−'}${moneyB(Math.abs(dCap))}</b>`
    : `<span>${T().waiting}</span>`;

  const avg = state.avg;
  const up = qs.filter((q) => q.changePct > 0).length;
  $('breadth').textContent = qs.length ? T().inGreen(up, qs.length) : '—';
  const mi = [-4, -1.5, -0.2, 0.2, 1.5, 3].filter((x) => avg > x).length;
  $('mood').textContent = T().moods[mi];
  $('meter').style.width = Math.max(3, Math.min(100, 50 + avg * 12)) + '%';

  const sorted = [...qs].sort((a, b) => b.changePct - a.changePct);
  const row = (q) => `<div class="row"><span><b>${q.symbol}</b> <span style="color:var(--muted)">$${q.price.toFixed(2)}</span></span><b class="${q.changePct >= 0 ? 'up' : 'down'}">${fmtPct(q.changePct)}</b></div>`;
  $('gainers').innerHTML = sorted.slice(0, 5).map(row).join('');
  $('losers').innerHTML = sorted.slice(-5).reverse().map(row).join('');

  $('mdot').style.background = snap.marketOpen ? 'var(--up)' : '#9a958c';
  $('mstate').textContent = snap.demo ? T().demo : snap.marketOpen ? T().open : T().closed;
  $('upd').textContent = snap.updated ? T().updated + new Date(snap.updated * 1000).toLocaleTimeString(T().locale) : T().loading;
}
$('toggle').onclick = () => {
  const p = $('panel');
  p.classList.toggle('collapsed');
  $('toggle').textContent = p.classList.contains('collapsed') ? T().more : T().less;
};

async function load() {
  try {
    const r = await fetch('api/quotes', { cache: 'no-store' });
    const snap = await r.json();
    state.quotes = snap.quotes;
    state.bySym = Object.fromEntries(snap.quotes.map((q) => [q.symbol, q]));
    state.marketOpen = snap.marketOpen;
    const live = snap.quotes.filter((q) => q.live);
    const capLive = live.reduce((s, q) => s + q.cap, 0) || 1;
    state.avg = live.reduce((s, q) => s + q.changePct * q.cap, 0) / capLive;
    state.avgAbs = live.reduce((s, q) => s + Math.abs(q.changePct) * q.cap, 0) / capLive;
    drawTexture();
    drawTowers();
    lastSnap = snap;
    renderPanel(snap);
  } catch (e) {
    $('upd').textContent = T().noServer + e.message;
  }
}

// ---------- подписи поверх сцены ----------
const ov = document.getElementById('overlay');
const octx = ov.getContext('2d');
const tmpV = new THREE.Vector3();
function toScreen(x, y, z) {
  tmpV.set(x, y, z).project(camera);
  return [(tmpV.x + 1) / 2 * innerWidth, (1 - tmpV.y) / 2 * innerHeight];
}
function drawOverlay() {
  const dpr = Math.min(devicePixelRatio, 2);
  octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  octx.clearRect(0, 0, innerWidth, innerHeight);
  octx.strokeStyle = octx.fillStyle = '#161616';
  octx.lineCap = 'round'; octx.lineJoin = 'round';

  // «ВСЯ МИРОВАЯ ЭКОНОМИКА» с фигурной скобкой
  const topY = (1 + 1.2 + 0.75) * S + 0.15;
  const [lx, ly] = toScreen(-1.25 * S, topY, 0);
  const [rx] = toScreen(1.25 * S, topY, 0);
  const bw = rx - lx, mid = (lx + rx) / 2, bh = Math.max(14, bw * 0.07);
  octx.lineWidth = Math.max(2.5, bw / 120);
  octx.beginPath();
  octx.moveTo(lx, ly);
  octx.quadraticCurveTo(lx, ly - bh / 2, lx + bh, ly - bh / 2);
  octx.lineTo(mid - bh, ly - bh / 2);
  octx.quadraticCurveTo(mid, ly - bh / 2, mid, ly - bh);
  octx.quadraticCurveTo(mid, ly - bh / 2, mid + bh, ly - bh / 2);
  octx.lineTo(rx - bh, ly - bh / 2);
  octx.quadraticCurveTo(rx, ly - bh / 2, rx, ly);
  octx.stroke();
  const narrow = innerWidth < 720;
  const title = narrow ? T().titleNarrow : T().title;
  octx.font = '900 100px Rubik, sans-serif';
  const w100 = Math.max(...title.map((l) => octx.measureText(l).width));
  const fs = Math.max(20, Math.min(84, Math.min(bw * 1.35, innerWidth - 32) / w100 * 100));
  octx.font = `900 ${fs}px Rubik, sans-serif`;
  octx.textAlign = 'center'; octx.textBaseline = 'bottom';
  title.forEach((l, i) => octx.fillText(l, mid, ly - bh - fs * 0.25 - (title.length - 1 - i) * fs * 1.05));

  // подпись к стержню со стрелкой
  const [fx, fy] = toScreen(0.1, -1.0, 0);
  const lines = narrow ? T().labelNarrow : T().label;
  const fs2 = narrow ? Math.max(16, Math.min(34, (innerWidth - fx - 60) / 4.6)) : Math.max(18, Math.min(48, fs * 0.75));
  octx.font = `900 ${fs2}px Rubik, sans-serif`;
  const tw = Math.max(...lines.map((l) => octx.measureText(l).width));
  let tx, ty, sx, sy, cx, cy;
  if (narrow) {
    tx = Math.min(fx + 55, innerWidth - tw - 10);
    ty = fy + fs2 * 0.6;
    sx = tx + tw * 0.3; sy = ty + fs2 * 1.75;
    cx = sx - 10; cy = fy + fs2 * 3;
  } else {
    tx = Math.min(fx + Math.max(70, bw * 0.3), innerWidth - tw - 16);
    ty = fy - fs2 * 1.6;
    sx = tx + tw * 0.3; sy = ty + fs2 * 0.7;
    cx = sx - 10; cy = fy + 28;
  }
  octx.textAlign = 'left'; octx.textBaseline = 'middle';
  lines.forEach((l, i) => octx.fillText(l, tx, ty + i * fs2 * 1.05));
  const ex = fx + 10, ey = fy + 4;
  octx.lineWidth = Math.max(2.5, fs2 / 14);
  octx.beginPath();
  octx.moveTo(sx, sy);
  octx.quadraticCurveTo(cx, cy, ex, ey);
  octx.stroke();
  const ang = Math.atan2(ey - cy, ex - cx);
  const ah = Math.max(10, fs2 * 0.35);
  octx.beginPath();
  octx.moveTo(ex + Math.cos(ang - 2.6) * ah, ey + Math.sin(ang - 2.6) * ah);
  octx.lineTo(ex, ey);
  octx.lineTo(ex + Math.cos(ang + 2.6) * ah, ey + Math.sin(ang + 2.6) * ah);
  octx.stroke();
}

// ---------- подсказка при наведении ----------
const ray = new THREE.Raycaster();
const ptr = new THREE.Vector2();
const tip = $('tip');
let pointer = null;
function onPointer(e) { pointer = { x: e.clientX, y: e.clientY }; }
addEventListener('pointermove', onPointer);
addEventListener('pointerdown', onPointer);
addEventListener('pointerleave', () => { pointer = null; tip.style.display = 'none'; });

function pick() {
  if (!pointer) return;
  ptr.set(pointer.x / innerWidth * 2 - 1, -(pointer.y / innerHeight) * 2 + 1);
  ray.setFromCamera(ptr, camera);
  const hits = ray.intersectObjects([heartMesh, ...towerBlocks.map((b) => b.mesh)], false);
  let q = null;
  if (hits.length) {
    const h = hits[0];
    if (h.object === heartMesh && h.uv) {
      const px = h.uv.x * TEX_W, py = (1 - h.uv.y) * TEX_H;
      const t = tiles.find((t) => px >= t.x && px < t.x + t.w && py >= t.y && py < t.y + t.h);
      q = t && t.q;
    } else if (h.object.userData.block) {
      const b = h.object.userData.block;
      q = state.bySym[b.sym] || state.bySym[b.parentSym];
    }
  }
  if (!q) { tip.style.display = 'none'; document.body.style.cursor = ''; return; }
  document.body.style.cursor = 'pointer';
  tip.style.display = 'block';
  tip.innerHTML = `<div class="t">${q.symbol}</div><div>${q.name}</div>` +
    (q.live ? `<div class="row"><span>$${q.price.toFixed(2)}</span><b class="${q.changePct >= 0 ? 'up' : 'down'}">${fmtPct(q.changePct)}</b></div>` : `<div>${T().noData}</div>`) +
    `<div style="color:var(--muted)">≈ ${moneyB(q.cap)} · ${T().groups[q.group] || q.group}</div>`;
  const tx = Math.min(pointer.x + 16, innerWidth - tip.offsetWidth - 8);
  const ty = Math.min(pointer.y + 16, innerHeight - tip.offsetHeight - 8);
  tip.style.left = tx + 'px'; tip.style.top = ty + 'px';
}

// ---------- размеры / камера ----------
const lookY = 1.4, lookX = 0;
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h);
  const dpr = Math.min(devicePixelRatio, 2);
  ov.width = w * dpr; ov.height = h * dpr;
  ov.style.width = w + 'px'; ov.style.height = h + 'px';
  camera.aspect = w / h;
  const vHalf = THREE.MathUtils.degToRad(camera.fov / 2);
  const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
  const wide = w > 720;
  const needW = wide ? 3.3 : 3.0;
  const dist = Math.max(4.9 / Math.tan(vHalf), needW / Math.tan(hHalf));
  camera.position.set(lookX, lookY + 1.0, dist);
  camera.lookAt(lookX, lookY, 0);
  if (wide) camera.setViewOffset(w, h, -Math.min(170, w * 0.12), 0, w, h);
  else camera.setViewOffset(w, h, 0, h * 0.06, w, h);
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ---------- анимация ----------
const clock = new THREE.Clock();
let t = 0;
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  t += dt;
  const spin = Math.min(6, 1.4 + state.avgAbs * 0.7) * (state.marketOpen ? 1 : 0.7);
  spinner.rotation.y += spin * dt;
  const wob = Math.min(0.32, 0.05 + Math.max(0, -state.avg) * 0.05);
  tilt.rotation.x = wob * Math.sin(t * 1.7);
  tilt.rotation.z = wob * Math.cos(t * 1.7);
  if (state.avg < -4) { // пузырь лопается — трясёт
    pivot.position.x = (Math.random() - 0.5) * 0.06;
    pivot.position.y = (Math.random() - 0.5) * 0.06;
  }
  for (const s of swirls) s.g.rotation.y -= s.speed * spin * 0.6 * dt;
  renderer.render(scene, camera);
  drawOverlay();
  pick();
  requestAnimationFrame(frame);
}

applyLang();
document.fonts.load('900 40px Rubik').finally(() => { drawTexture(); load(); });
setInterval(load, 30000);
frame();
