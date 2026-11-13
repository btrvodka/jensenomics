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

const hemi = new THREE.HemisphereLight(0xffffff, 0xb8b0a0, 1.6);
scene.add(hemi);
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

// иерархия: pivot (кончик стержня) → tilt (качание) → spinner (вращение) → heartGroup
const pivot = new THREE.Group();
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
// иерархия: stand (двигается) → rodPivot (наклон стержня у основания) → pivot (кончик, на нём мир)
const ROD_H = 2.2;
const stand = new THREE.Group();
scene.add(stand);
const rodPivot = new THREE.Group();
rodPivot.position.y = -ROD_H;
stand.add(rodPivot);
rodPivot.add(pivot);
pivot.position.y = ROD_H;
const baseMeshes = [];
let rodHit;
{
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, ROD_H, 24, 16), toon({ color: 0xd62a2a }));
  rod.name = 'rod';
  rod.position.y = ROD_H / 2;
  rodPivot.add(rod);
  outlineByScale(rod, 0.025);
  const shine = new THREE.Mesh(new THREE.BoxGeometry(0.025, ROD_H * 0.85, 0.02), new THREE.MeshBasicMaterial({ color: 0xff8a80 }));
  shine.position.set(-0.04, ROD_H / 2, 0.085);
  shine.name = 'shine';
  rodPivot.add(shine);
  // невидимый толстый цилиндр, чтобы по тонкой палке было легко попасть
  rodHit = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, ROD_H, 8), new THREE.MeshBasicMaterial({ visible: false }));
  rodHit.position.y = ROD_H / 2;
  rodHit.userData.kind = 'rod';
  rodPivot.add(rodHit);

  const white = toon({ color: 0xf2f0ea });
  const top = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.32, 1.4), white);
  top.position.y = -ROD_H - 0.16;
  stand.add(top);
  outlineByScale(top, 0.03);
  const base = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.3, 2.2), white);
  base.position.y = -ROD_H - 0.32 - 0.15;
  stand.add(base);
  outlineByScale(base, 0.03);
  for (const m of [top, base]) { m.userData.kind = 'base'; baseMeshes.push(m); }

  const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 40),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.1 }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.set(2.6, 1.3, 1);
  shadow.position.y = -ROD_H - 0.63;
  stand.add(shadow);
}
heartMesh.userData.kind = 'heart';
for (const b of towerBlocks) b.mesh.userData.kind = 'heart';

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
  if (chaos.green) return '#1fb34f';
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

function drawHole(ctx, t) {
  ctx.fillStyle = '#0c0c0e';
  ctx.fillRect(t.x + 3, t.y + 3, t.w - 6, t.h - 6);
  ctx.strokeStyle = '#2a2a2e';
  ctx.lineWidth = 6;
  ctx.strokeRect(t.x + 10, t.y + 10, t.w - 20, t.h - 20);
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
    for (const t of inner) { if (chaos.removed.has(t.q.symbol)) drawHole(ctx, t); else drawTile(ctx, t, t.q); tiles.push(t); }
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
    tiltLabel: 'Крен рынка', crash: 'КРАХ!', crashLine: 'Вся мировая экономика', fixing: 'Хуанг уже везёт новые видеокарты…',
    hint: 'Пасхалки: тащи постамент, тыкай в палку, раскручивай мир, дважды ткни в компанию, набери NVDA. И это не всё.',
    suggest: 'Предложить идею',
    leftChat: (s) => `${s} покинула чат`, overheat: 'ПЕРЕГРЕВ! Нужно больше охлаждения (и видеокарт)',
    lost: 'Улетело капитализации', pop: 'ПУФ!', happy: 'Хуанг доволен: NVDA +∞%', rebalanced: 'Индекс ребалансирован',
    crashes: (n) => `Экономику обрушили ${n} ${n % 10 === 1 && n % 100 !== 11 ? 'раз' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'раза' : 'раз'}`,
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
    tiltLabel: 'Market tilt', crash: 'CRASH!', crashLine: 'The entire world economy', fixing: 'Jensen is shipping more GPUs…',
    hint: 'Easter eggs: drag the pedestal, poke the stick, spin the world, double-tap a company, type NVDA. And there is more.',
    suggest: 'Suggest an idea',
    leftChat: (s) => `${s} has left the chat`, overheat: 'OVERHEATING! Needs more cooling (and GPUs)',
    lost: 'Market cap flung off', pop: 'POP!', happy: 'Jensen is pleased: NVDA +∞%', rebalanced: 'Index rebalanced',
    crashes: (n) => `World economy crashed ${n} time${n === 1 ? '' : 's'}`,
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
  updateLostRow();
  setCrashes(state.crashes);
}
function updateLostRow() {
  const el = $('lost');
  el.style.display = chaos.lost > 0 ? '' : 'none';
  if (chaos.lost > 0) el.innerHTML = `<span>${T().lost}</span><b class="down">−${moneyB(chaos.lost)}</b>`;
}
function setCrashes(n) {
  state.crashes = n || 0;
  $('crashes').textContent = T().crashes(state.crashes);
}
async function reportCrash() {
  try {
    const r = await fetch('api/crash', { method: 'POST' });
    setCrashes((await r.json()).crashes);
  } catch {}
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
    state.demo = snap.demo;
    state.loaded = true;
    state.crashes = snap.crashes || 0;
    if ((state.bySym.NVDA?.changePct ?? 0) > 5) chaos.jump = 0; // NVDA растёт — мир подпрыгивает
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
const tmpV = new THREE.Vector3(), tmpW = new THREE.Vector3();
function toScreen(x, y, z) {
  tmpV.set(x, y, z).project(camera);
  return [(tmpV.x + 1) / 2 * innerWidth, (1 - tmpV.y) / 2 * innerHeight];
}
function drawOverlay() {
  const dpr = Math.min(devicePixelRatio, 2);
  octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  octx.clearRect(0, 0, innerWidth, innerHeight);
  const INKC = chaos.night > 0.5 ? '#efe9dc' : '#161616';
  octx.strokeStyle = octx.fillStyle = INKC;
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
  titleBox = { x0: mid - bw * 0.7, x1: mid + bw * 0.7, y0: ly - bh - fs * 1.3 * title.length, y1: ly };

  // подпись к стержню со стрелкой
  tmpW.set(0.1, ROD_H * 0.545, 0);
  rodPivot.localToWorld(tmpW);
  const [fx, fy] = toScreen(tmpW.x, tmpW.y, tmpW.z);
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

  // «падение в процентах»: крен рынка, пока мир держит баланс
  if (phys.mode === 'balance' && Math.abs(phys.ang) > 0.03) {
    tmpW.set(0, ROD_H * 0.8, 0);
    rodPivot.localToWorld(tmpW);
    const [kx, ky] = toScreen(tmpW.x, tmpW.y, tmpW.z);
    const pct = Math.min(99, Math.abs(phys.ang) / TOPPLE * 100);
    octx.font = `900 ${Math.round(fs2 * 0.7)}px Rubik, sans-serif`;
    octx.textAlign = 'right';
    octx.fillStyle = pct > 66 ? '#d62a2a' : INKC;
    octx.fillText(`${T().tiltLabel} −${pct.toFixed(0)}%`, kx - 24, ky);
    octx.fillStyle = INKC;
  }

  // крах
  if (phys.mode === 'fall' || (phys.mode === 'reset' && phys.t < 0.6)) {
    const cx2 = innerWidth / 2 + (innerWidth > 720 ? Math.min(170, innerWidth * 0.12) / 2 : 0);
    const cy2 = innerHeight * 0.42;
    const big = Math.min(140, innerWidth / 6);
    octx.textAlign = 'center'; octx.textBaseline = 'middle';
    octx.lineWidth = big / 10;
    octx.strokeStyle = '#fffdf7';
    octx.fillStyle = '#d62a2a';
    octx.font = `900 ${big}px Rubik, sans-serif`;
    const shake = phys.mode === 'fall' && phys.t < 1.2 ? (Math.random() - 0.5) * 8 : 0;
    octx.strokeText(T().crash, cx2 + shake, cy2);
    octx.fillText(T().crash, cx2 + shake, cy2);
    const small = big * 0.32;
    octx.font = `900 ${small}px Rubik, sans-serif`;
    octx.lineWidth = small / 6;
    const line = `${T().crashLine} ${phys.pct.toFixed(1).replace('.', T().decimal)}%`.replace('-', '−');
    octx.strokeText(line, cx2, cy2 + big * 0.75);
    octx.fillText(line, cx2, cy2 + big * 0.75);
    if (phys.t > 2.5 && phys.mode === 'fall') {
      octx.fillStyle = INKC;
      octx.font = `700 ${small * 0.7}px Rubik, sans-serif`;
      octx.strokeText(T().fixing, cx2, cy2 + big * 1.25);
      octx.fillText(T().fixing, cx2, cy2 + big * 1.25);
    }
    octx.strokeStyle = octx.fillStyle = INKC;
  }

  // ночью мир спит
  if (chaos.night > 0.5 && phys.mode === 'balance') {
    tmpW.set(1.15 * S, 1.9 * S, 0);
    tilt.localToWorld(tmpW);
    const [zx, zy] = toScreen(tmpW.x, tmpW.y, tmpW.z);
    octx.textAlign = 'left'; octx.textBaseline = 'middle';
    for (let i = 0; i < 3; i++) {
      const ph = (t * 0.35 + i / 3) % 1;
      octx.globalAlpha = (1 - ph) * Math.min(1, ph * 5);
      octx.fillStyle = INKC;
      octx.font = `900 ${Math.round(16 + ph * 30)}px Rubik, sans-serif`;
      octx.fillText('Z', zx + ph * 60, zy - ph * 110);
    }
    octx.globalAlpha = 1;
  }

  // всплывающие надписи
  const tcx = innerWidth / 2 + (innerWidth > 720 ? Math.min(170, innerWidth * 0.12) / 2 : 0);
  const baseFs = Math.max(16, Math.min(38, innerWidth / 24));
  let stackY = innerHeight * 0.3;
  octx.textAlign = 'center'; octx.textBaseline = 'middle';
  for (const ts of toasts) {
    let f = baseFs * ts.size;
    octx.font = `900 ${f}px Rubik, sans-serif`;
    const w = octx.measureText(ts.text).width;
    if (w > innerWidth - 24) { f *= (innerWidth - 24) / w; octx.font = `900 ${f}px Rubik, sans-serif`; }
    let x = tcx, y;
    if (ts.world) { [x, y] = toScreen(ts.world.x, ts.world.y, ts.world.z); y -= ts.t * 50; }
    else { y = stackY; stackY += f * 1.35; }
    octx.globalAlpha = Math.max(0, Math.min(1, ts.t / 0.15, (ts.dur - ts.t) / 0.4));
    octx.lineWidth = f / 5;
    octx.strokeStyle = '#fffdf7';
    octx.fillStyle = ts.color;
    octx.strokeText(ts.text, x, y);
    octx.fillText(ts.text, x, y);
  }
  octx.globalAlpha = 1;
}

// ---------- наведение и взаимодействие ----------
const ray = new THREE.Raycaster();
const ptr = new THREE.Vector2();
const tip = $('tip');
let pointer = null;
let drag = null; // { kind: 'base', off, target } | { kind: 'heart', lastX, dx }
const zPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const tmpP = new THREE.Vector3();

function rayAt(x, y) {
  ptr.set(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1);
  ray.setFromCamera(ptr, camera);
  return ray;
}
function planeX(x, y) { return rayAt(x, y).ray.intersectPlane(zPlane, tmpP) ? tmpP.x : null; }
function hitTest(x, y) {
  const hits = rayAt(x, y).intersectObjects([heartMesh, ...towerBlocks.filter((b) => !b.gone).map((b) => b.mesh), rodHit, ...baseMeshes], false);
  return hits.length ? { ...hits[0], kind: hits[0].object.userData.kind } : null;
}

const cv = renderer.domElement;
cv.style.touchAction = 'none';
cv.addEventListener('pointerdown', (e) => {
  askMotion();
  pointer = { x: e.clientX, y: e.clientY };
  if (titleBox && e.clientX > titleBox.x0 && e.clientX < titleBox.x1 && e.clientY > titleBox.y0 && e.clientY < titleBox.y1) titleTap();
  const h = hitTest(e.clientX, e.clientY);
  if (!h) return;
  if (h.object === heartMesh && h.uv && phys.mode === 'balance') {
    const now = performance.now();
    if (now - lastTap.time < 350 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
      lastTap.time = 0;
      popTile(h);
      return;
    }
    lastTap = { time: now, x: e.clientX, y: e.clientY };
  }
  if (h.kind === 'rod' && phys.mode === 'balance') {
    const local = rodPivot.worldToLocal(h.point.clone());
    phys.angV += (local.x > 0 ? 1 : -1) * 1.7; // толчок в сторону от точки удара
    return;
  }
  if (h.kind === 'base') {
    const px = planeX(e.clientX, e.clientY);
    if (px !== null) drag = { kind: 'base', off: px - phys.baseX, target: phys.baseX };
  } else if (h.kind === 'heart' && phys.mode === 'balance') {
    drag = { kind: 'heart', lastX: e.clientX, dx: 0 };
  }
  if (drag) { cv.setPointerCapture(e.pointerId); tip.style.display = 'none'; }
});
addEventListener('pointermove', (e) => {
  pointer = { x: e.clientX, y: e.clientY };
  if (!drag) return;
  if (drag.kind === 'base') {
    const px = planeX(e.clientX, e.clientY);
    if (px !== null) drag.target = px - drag.off;
  } else {
    drag.dx += e.clientX - drag.lastX;
    drag.lastX = e.clientX;
  }
});
const endDrag = () => { drag = null; };
addEventListener('pointerup', endDrag);
addEventListener('pointercancel', endDrag);
addEventListener('pointerleave', () => { pointer = null; tip.style.display = 'none'; });

function pick() {
  if (!pointer) return;
  if (drag) { document.body.style.cursor = 'grabbing'; return; }
  const h = phys.mode === 'balance' ? hitTest(pointer.x, pointer.y) : null;
  let q = null;
  if (h && h.kind === 'heart') {
    if (h.object === heartMesh && h.uv) {
      const px = h.uv.x * TEX_W, py = (1 - h.uv.y) * TEX_H;
      const t = tiles.find((t) => px >= t.x && px < t.x + t.w && py >= t.y && py < t.y + t.h);
      q = t && t.q;
    } else if (h.object.userData.block) {
      const b = h.object.userData.block;
      q = state.bySym[b.sym] || state.bySym[b.parentSym];
    }
  }
  document.body.style.cursor = !h ? '' : h.kind === 'rod' ? 'pointer' : 'grab';
  if (!q) { tip.style.display = 'none'; return; }
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

// ---------- физика: баланс, падение, восстановление ----------
const TOPPLE = 0.75; // крен (рад), после которого мир падает
const phys = {
  baseX: 0, baseV: 0, ang: 0, angV: 0, spin: 0, mode: 'balance', t: 0,
  hv: new THREE.Vector3(), hav: 0, pct: 0, target: 0, from: null,
};
// точки сердца для столкновений с полом и постаментом
const hullPts = [];
{
  const pos = heartMesh.geometry.attributes.position;
  for (let i = 0; i < pos.count; i += 37) hullPts.push(new THREE.Vector3().fromBufferAttribute(pos, i));
}
function floorAt(x) {
  const d = Math.abs(x - phys.baseX);
  return d < 1.3 ? -ROD_H : d < 2.1 ? -ROD_H - 0.32 : -ROD_H - 0.62;
}
function collideHeart() {
  pivot.updateMatrixWorld(true);
  let pen = 0;
  for (const p of hullPts) {
    tmpP.copy(p).applyMatrix4(heartMesh.matrixWorld);
    pen = Math.max(pen, floorAt(tmpP.x) - tmpP.y);
  }
  if (pen <= 0) return false;
  pivot.position.y += pen;
  if (phys.hv.y < 0) phys.hv.y *= -0.3;
  phys.hv.x *= 0.6;
  phys.hav *= 0.5;
  return true;
}
function topple() {
  phys.mode = 'fall';
  phys.t = 0;
  scene.attach(pivot); // мир слетает со стержня
  const a = phys.ang;
  phys.hv.set(-ROD_H * Math.cos(a) * phys.angV + phys.baseV * 0.5, 2 - ROD_H * Math.sin(a) * phys.angV * 0.3, 0);
  phys.hav = Math.sign(a) * 2.2;
  phys.pct = 0;
  phys.target = -(25 + Math.random() * 60);
  reportCrash();
}
function startReset() {
  phys.mode = 'reset';
  phys.t = 0;
  phys.from = { pos: pivot.position.clone(), rz: pivot.rotation.z, ang: phys.ang };
}

function step(dt) {
  phys.t += dt;
  const market = Math.min(6, 1.4 + state.avgAbs * 0.7) * (state.marketOpen ? 1 : 0.45);

  // постамент едет за мышью, рывки раскачивают стержень
  const prevV = phys.baseV;
  if (drag && drag.kind === 'base') {
    const target = THREE.MathUtils.clamp(drag.target, -4.5, 4.5);
    const nx = phys.baseX + (target - phys.baseX) * Math.min(1, dt * 18);
    phys.baseV = (nx - phys.baseX) / dt;
    phys.baseX = nx;
  } else {
    phys.baseV = 0;
  }
  stand.position.x = phys.baseX;
  const dv = THREE.MathUtils.clamp(phys.baseV - prevV, -40, 40);

  if (phys.mode === 'balance') {
    // перевёрнутый маятник с «балансировщиком»: пружина сильнее гравитации
    phys.angV += dv * 0.1;
    phys.angV += (-16 * phys.ang - 2.2 * phys.angV + 5 * Math.sin(phys.ang)) * dt;
    phys.ang += phys.angV * dt;
    if (Math.abs(phys.ang) > TOPPLE) topple();
  } else if (phys.mode === 'fall') {
    const lim = Math.PI / 2 - 0.05; // стержень ложится на постамент
    phys.angV += 9 * Math.sin(phys.ang) * dt;
    phys.ang += phys.angV * dt;
    if (Math.abs(phys.ang) > lim) { phys.ang = Math.sign(phys.ang) * lim; phys.angV *= -0.3; }
  }
  rodPivot.rotation.z = phys.ang;

  // вращение мира: рынок, рука зрителя или затухание после краха
  if (drag && drag.kind === 'heart') {
    const turn = drag.dx * 0.012;
    spinner.rotation.y += turn;
    phys.spin = phys.spin * 0.6 + (turn / dt) * 0.4;
    drag.dx = 0;
  } else {
    if (phys.mode === 'balance') phys.spin += (market - phys.spin) * Math.min(1, dt * 0.8);
    else phys.spin *= 1 - Math.min(1, dt * 1.5);
    spinner.rotation.y += phys.spin * dt;
  }

  // покачивание; при крене мир отклоняется в другую сторону — держит баланс
  const wob = phys.mode === 'balance' ? Math.min(0.32, 0.05 + Math.max(0, -state.avg) * 0.05) : 0;
  const lean = phys.mode === 'balance' ? -1.2 * phys.ang : 0;
  const k = Math.min(1, dt * 6);
  tilt.rotation.x += (wob * Math.sin(t * 1.7) - tilt.rotation.x) * k;
  tilt.rotation.z += (wob * Math.cos(t * 1.7) + lean - tilt.rotation.z) * k;
  tilt.position.set(0, chaos.jump < 0.7 ? Math.sin(chaos.jump / 0.7 * Math.PI) * 0.6 : 0, 0);
  if (state.avg < -4 && phys.mode === 'balance') { // рынок рушится — трясёт
    tilt.position.x += (Math.random() - 0.5) * 0.06;
    tilt.position.y += (Math.random() - 0.5) * 0.06;
  }

  if (phys.mode === 'fall') {
    phys.hv.y -= 14 * dt;
    pivot.position.addScaledVector(phys.hv, dt);
    if (Math.abs(pivot.rotation.z) < 1.45) pivot.rotation.z += phys.hav * dt;
    if (collideHeart()) phys.hv.x *= 1 - Math.min(1, dt * 3);
    phys.pct += (phys.target - phys.pct) * Math.min(1, dt * 2.5);
    if (phys.t > 5.5) startReset();
  } else if (phys.mode === 'reset') {
    const u = Math.min(1, phys.t / 1.4), e = u * u * (3 - 2 * u);
    phys.ang = phys.from.ang * (1 - e);
    phys.angV = 0;
    rodPivot.rotation.z = phys.ang;
    rodPivot.updateMatrixWorld(true);
    tmpW.set(0, ROD_H, 0);
    rodPivot.localToWorld(tmpW);
    pivot.position.lerpVectors(phys.from.pos, tmpW, e);
    pivot.rotation.z = phys.from.rz * (1 - e) + phys.ang * e;
    phys.pct *= 1 - Math.min(1, dt * 4);
    if (u >= 1) {
      rodPivot.attach(pivot);
      pivot.position.set(0, ROD_H, 0);
      pivot.rotation.set(0, 0, 0);
      phys.mode = 'balance';
      restoreAll(true);
    }
  }

  stepEggs(dt);
  for (const sw of swirls) sw.g.visible = phys.mode === 'balance';
  for (const sw of swirls) sw.g.rotation.y -= sw.speed * Math.max(0.3, Math.abs(phys.spin)) * 0.6 * dt;
}

// ---------- пасхалки: центробежка, башни, перегрев, пузыри, NVDA, рынок, ночь, тряска ----------
const FLY_SPIN = 10, TOWER_SPIN = 18; // рад/с: плитки слетают, башенки срываются
const chaos = {
  removed: new Set(), lost: 0, calm: 0, flyAcc: 0, towerAcc: 0,
  heat: 0, heatToastAt: -99, green: false, greenUntil: 0,
  texDirty: false, texAt: 0, jump: 9, night: 0, bend: 0,
};
const debris = []; // { obj, v, av, r, life, ttl, block }
const toasts = []; // { text, t, dur, world, color, size }
const pops = [];
const steam = [];
let titleBox = null, titleTaps = [], lastTap = { time: 0, x: 0, y: 0 };

function toast(text, opts = {}) {
  toasts.push({ text, t: 0, dur: 2.8, color: '#d62a2a', size: 1, ...opts });
  if (toasts.length > 6) toasts.shift();
}

// --- обломки: общая физика для плиток, башенок, осколков и видеокарт ---
function floorAt3(x, z) {
  const d = Math.abs(x - phys.baseX), az = Math.abs(z);
  if (d < 1.3 && az < 0.7) return -ROD_H;
  if (d < 2.1 && az < 1.1) return -ROD_H - 0.32;
  return -ROD_H - 0.62;
}
const rndSpin = () => new THREE.Vector3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12);
function addDebris(obj, v, { r = 0.15, ttl = 7, block = null } = {}) {
  debris.push({ obj, v, av: rndSpin(), r, life: 0, ttl, block, s0: obj.scale.clone() });
}
function dropDebris(i) {
  const d = debris[i];
  d.obj.parent?.remove(d.obj);
  d.obj.userData.dispose?.();
  debris.splice(i, 1);
}
function stepDebris(dt) {
  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i];
    d.life += dt;
    d.v.y -= 14 * dt;
    d.obj.position.addScaledVector(d.v, dt);
    d.obj.rotation.x += d.av.x * dt;
    d.obj.rotation.y += d.av.y * dt;
    d.obj.rotation.z += d.av.z * dt;
    const f = floorAt3(d.obj.position.x, d.obj.position.z) + d.r;
    if (d.obj.position.y < f) {
      d.obj.position.y = f;
      if (d.v.y < 0) d.v.y *= -0.35;
      d.v.x *= 0.75; d.v.z *= 0.75;
      d.av.multiplyScalar(0.7);
    }
    if (d.ttl && d.life > d.ttl) {
      const k = 1 - (d.life - d.ttl) / 0.6;
      if (k <= 0) { dropDebris(i); continue; }
      d.obj.scale.copy(d.s0).multiplyScalar(k);
    }
  }
}

// --- центробежка: плитки слетают с мира ---
const chipGeo = new THREE.BoxGeometry(1, 0.72, 0.08);
function makeChip(q) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 92;
  drawTile(c.getContext('2d'), { x: -3, y: -3, w: 134, h: 98 }, q);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const side = new THREE.MeshBasicMaterial({ color: tileColor(q) });
  const face = new THREE.MeshBasicMaterial({ map: tex });
  const m = new THREE.Mesh(chipGeo, [side, side, side, side, face, face]);
  m.scale.setScalar(0.3 + Math.sqrt(q.cap) / 110);
  m.userData.dispose = () => { tex.dispose(); side.dispose(); face.dispose(); };
  return m;
}
const anchors = new Map(); // тикер → точка на поверхности сердца (локально)
function tileAnchor(t) {
  if (anchors.has(t.q.symbol)) return anchors.get(t.q.symbol);
  const uv = heartMesh.geometry.attributes.uv, pos = heartMesh.geometry.attributes.position;
  const u = (t.x + t.w / 2) / TEX_W, v = 1 - (t.y + t.h / 2) / TEX_H;
  let best = 0, bd = Infinity;
  for (let i = 0; i < uv.count; i++) {
    let du = Math.abs(uv.getX(i) - u);
    du = Math.min(du, 1 - du);
    const dv = uv.getY(i) - v, d = du * du * 4 + dv * dv;
    if (d < bd) { bd = d; best = i; }
  }
  const p = new THREE.Vector3().fromBufferAttribute(pos, best);
  anchors.set(t.q.symbol, p);
  return p;
}
function flingVelocity(p) { // касательная скорость вращения + немного наружу и вверх
  const pw = pivot.getWorldPosition(new THREE.Vector3());
  const rx = p.x - pw.x, rz = p.z - pw.z, w = phys.spin * 0.35;
  const out = new THREE.Vector3(rx, 0, rz).normalize();
  return new THREE.Vector3(w * rz, 2 + Math.random() * 2.5, -w * rx).addScaledVector(out, 2);
}
function flyTile() {
  const t = tiles.filter((t) => !chaos.removed.has(t.q.symbol)).sort((a, b) => a.q.cap - b.q.cap)[0];
  if (!t) return;
  chaos.removed.add(t.q.symbol);
  chaos.lost += t.q.cap;
  chaos.texDirty = true;
  const p = heartMesh.localToWorld(tileAnchor(t).clone());
  const m = makeChip(t.q);
  m.position.copy(p);
  m.rotation.y = Math.random() * Math.PI;
  scene.add(m);
  addDebris(m, flingVelocity(p), { r: 0.12, ttl: 6 + Math.random() * 2 });
  updateLostRow();
}
function flyTower() {
  const b = [...towerBlocks].reverse().find((b) => !b.gone);
  if (!b) return;
  b.home ||= { pos: b.mesh.position.clone(), quat: b.mesh.quaternion.clone(), scale: b.mesh.scale.clone() };
  b.gone = true;
  scene.attach(b.mesh);
  const g = b.mesh.geometry.parameters;
  addDebris(b.mesh, flingVelocity(b.mesh.position), { r: Math.max(g.radiusTop, g.height / 2) * S, ttl: 0, block: b });
  if (b.sym) toast(T().leftChat(b.sym));
}
function restoreAll(silent) {
  const had = chaos.removed.size > 0 || towerBlocks.some((b) => b.gone);
  chaos.removed.clear();
  chaos.lost = 0;
  chaos.calm = 0;
  chaos.texDirty = true;
  for (const b of towerBlocks) {
    if (!b.gone) continue;
    const i = debris.findIndex((d) => d.block === b);
    if (i >= 0) debris.splice(i, 1);
    heartGroup.add(b.mesh);
    b.mesh.position.copy(b.home.pos);
    b.mesh.quaternion.copy(b.home.quat);
    b.mesh.scale.copy(b.home.scale);
    b.gone = false;
  }
  updateLostRow();
  if (had && !silent) toast(T().rebalanced, { color: '#1f9d48' });
}

// --- перегрев: мир краснеет, идёт пар ---
const steamTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,0.95)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
function stepHeat(dt) {
  const sp = Math.abs(phys.spin);
  chaos.heat = THREE.MathUtils.clamp(chaos.heat + (sp > 8 ? (sp - 8) * 0.03 : -0.12) * dt, 0, 1);
  heartMesh.material.emissive.setRGB(chaos.heat * 0.8, chaos.heat * 0.15, 0);
  if (chaos.heat > 0.85 && t - chaos.heatToastAt > 6) { chaos.heatToastAt = t; toast(T().overheat, { size: 0.75 }); }
  if (chaos.heat > 0.4 && phys.mode === 'balance' && Math.random() < chaos.heat * dt * 14) {
    const puff = new THREE.Sprite(new THREE.SpriteMaterial({ map: steamTex, transparent: true, depthWrite: false, opacity: 0.8 }));
    tmpW.set((Math.random() - 0.5) * 2.2 * S, 2.3 * S, (Math.random() - 0.5) * S);
    tilt.localToWorld(tmpW);
    puff.position.copy(tmpW);
    scene.add(puff);
    steam.push({ puff, life: 0, seed: Math.random() * 6 });
  }
  for (let i = steam.length - 1; i >= 0; i--) {
    const st = steam[i];
    st.life += dt;
    st.puff.position.y += dt * 1.4;
    st.puff.position.x += Math.sin(st.life * 3 + st.seed) * dt * 0.3;
    st.puff.scale.setScalar(0.5 + st.life * 1.2);
    st.puff.material.opacity = Math.max(0, 0.8 * (1 - st.life / 2));
    if (st.life > 2) { scene.remove(st.puff); st.puff.material.dispose(); steam.splice(i, 1); }
  }
}

// --- двойной тап по компании: она раздувается и лопается ---
const shardGeo = new THREE.BoxGeometry(0.12, 0.12, 0.03);
function popTile(h) {
  const px = h.uv.x * TEX_W, py = (1 - h.uv.y) * TEX_H;
  const tl = tiles.find((t) => px >= t.x && px < t.x + t.w && py >= t.y && py < t.y + t.h);
  if (!tl || chaos.removed.has(tl.q.symbol)) return;
  const n = h.face.normal.clone().transformDirection(heartMesh.matrixWorld);
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), toon({ color: tileColor(tl.q), transparent: true, opacity: 0.8 }));
  m.position.copy(h.point);
  m.scale.setScalar(0.05);
  scene.add(m);
  pops.push({ m, n, q: tl.q, t: 0, p: h.point.clone() });
  chaos.removed.add(tl.q.symbol);
  chaos.lost += tl.q.cap;
  chaos.texDirty = true;
  updateLostRow();
}
function stepPops(dt) {
  for (let i = pops.length - 1; i >= 0; i--) {
    const p = pops[i];
    p.t += dt;
    const r = 0.05 + Math.min(1, p.t / 0.6) * 0.55 + Math.sin(p.t * 40) * 0.02;
    p.m.scale.setScalar(r);
    p.m.position.copy(p.p).addScaledVector(p.n, r);
    if (p.t < 0.65) continue;
    scene.remove(p.m);
    p.m.geometry.dispose();
    p.m.material.dispose();
    pops.splice(i, 1);
    const mat = new THREE.MeshBasicMaterial({ color: tileColor(p.q) });
    let left = 14;
    for (let k = 0; k < 14; k++) {
      const sh = new THREE.Mesh(shardGeo, mat);
      sh.position.copy(p.m.position);
      sh.userData.dispose = () => { if (--left === 0) mat.dispose(); };
      scene.add(sh);
      const dir = new THREE.Vector3().randomDirection().addScaledVector(p.n, 0.8).normalize();
      addDebris(sh, dir.multiplyScalar(4 + Math.random() * 3), { r: 0.04, ttl: 1 + Math.random() });
    }
    toast(`${T().pop} ${p.q.symbol} ${fmtPct(p.q.changePct)}`, { world: p.m.position.clone(), dur: 1.8, size: 0.8, color: tileColor(p.q) });
  }
}

// --- набрать NVDA / Konami-код / 5 тапов по заголовку: Хуанг доволен ---
const gpuParts = {
  body: new THREE.BoxGeometry(1, 0.18, 0.45), stripe: new THREE.BoxGeometry(1.01, 0.04, 0.46),
  fan: new THREE.CylinderGeometry(0.16, 0.16, 0.03, 20),
  bodyMat: toon({ color: 0x2d2f36 }), stripeMat: new THREE.MeshBasicMaterial({ color: 0x3ddc84 }), fanMat: toon({ color: 0x7a7f8c }),
};
function spawnGPU() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(gpuParts.body, gpuParts.bodyMat);
  g.add(body);
  outlineByScale(body, 0.02);
  const stripe = new THREE.Mesh(gpuParts.stripe, gpuParts.stripeMat);
  stripe.position.y = 0.08;
  g.add(stripe);
  for (const x of [-0.24, 0.24]) {
    const fan = new THREE.Mesh(gpuParts.fan, gpuParts.fanMat);
    fan.position.set(x, -0.1, 0);
    g.add(fan);
  }
  g.position.set(phys.baseX + (Math.random() - 0.5) * 9, 7 + Math.random() * 3, (Math.random() - 0.5) * 2);
  g.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
  g.scale.setScalar(0.8 + Math.random() * 0.4);
  scene.add(g);
  addDebris(g, new THREE.Vector3(0, -2, 0), { r: 0.14, ttl: 8 + Math.random() * 2 });
}
function jensenParty() {
  if (chaos.green) return;
  chaos.green = true;
  chaos.greenUntil = t + 10;
  chaos.texDirty = true;
  drawTowers();
  toast(T().happy, { color: '#1f9d48', dur: 4, size: 1.2 });
  for (let i = 0; i < 40; i++) setTimeout(spawnGPU, i * 90);
}
const SECRET = [
  ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'KeyB', 'KeyA'],
  ['KeyN', 'KeyV', 'KeyD', 'KeyA'], // по коду клавиши — работает и в русской раскладке
];
let keyLog = [];
addEventListener('keydown', (e) => {
  keyLog = [...keyLog, e.code].slice(-10);
  if (SECRET.some((seq) => seq.every((c, i) => keyLog[keyLog.length - seq.length + i] === c))) jensenParty();
});
function titleTap() {
  const now = performance.now();
  titleTaps = [...titleTaps.filter((x) => now - x < 2000), now];
  if (titleTaps.length >= 5) { titleTaps = []; jensenParty(); }
}

// --- реакция на настоящий рынок: NVDA −5% гнёт стержень ---
const rodMesh = rodPivot.getObjectByName('rod'), rodShine = rodPivot.getObjectByName('shine');
const rodBase = rodMesh.geometry.attributes.position.array.slice();
let rodBent = 0;
function bendRod(b) {
  if (Math.abs(b - rodBent) > 1e-4) {
    rodBent = b;
    const p = rodMesh.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const s = (rodBase[i * 3 + 1] + ROD_H / 2) / ROD_H;
      p.setX(i, rodBase[i * 3] - b * s * s);
    }
    p.needsUpdate = true;
    rodShine.visible = b < 0.01;
  }
  if (phys.mode === 'balance') { // кончик и мир следуют за изгибом
    pivot.position.x = -b;
    pivot.rotation.z = Math.atan(2 * b / ROD_H);
  }
}

// --- ночь: биржа закрыта, светит одна лампа ---
const lamp = new THREE.SpotLight(0xffd59a, 0, 16, 0.6, 0.7, 1);
lamp.position.set(0, 4.5, 3);
lamp.target.position.set(0, -ROD_H, 0);
stand.add(lamp, lamp.target);
function stepNight(dt) {
  const want = state.loaded && !state.marketOpen && !state.demo ? 1 : 0;
  chaos.night += (want - chaos.night) * Math.min(1, dt * 1.5);
  const n = chaos.night;
  hemi.intensity = 1.6 - 1.15 * n;
  sun.intensity = 2.2 - 1.9 * n;
  lamp.intensity = 45 * n;
  document.body.classList.toggle('night', n > 0.5);
}

// --- тряска телефона = рывок постамента ---
let lastAcc = null, shakeAt = 0, motionAsked = false;
function askMotion() {
  if (motionAsked) return;
  motionAsked = true;
  const D = window.DeviceMotionEvent;
  if (D && typeof D.requestPermission === 'function') D.requestPermission().catch(() => {});
}
addEventListener('devicemotion', (e) => {
  const a = e.accelerationIncludingGravity;
  if (!a || a.x == null) return;
  if (lastAcc && phys.mode === 'balance') {
    const dx = a.x - lastAcc.x, d = Math.hypot(dx, a.y - lastAcc.y, a.z - lastAcc.z);
    if (d > 22 && performance.now() - shakeAt > 250) {
      shakeAt = performance.now();
      phys.angV += (dx > 0 ? 1 : -1) * 2.4;
    }
  }
  lastAcc = { x: a.x, y: a.y, z: a.z };
});

function stepEggs(dt) {
  if (phys.mode === 'balance') {
    const sp = Math.abs(phys.spin);
    if (sp > FLY_SPIN) { chaos.flyAcc += (sp - FLY_SPIN) * 0.6 * dt; chaos.calm = 0; }
    if (sp > TOWER_SPIN) chaos.towerAcc += (sp - TOWER_SPIN) * 0.4 * dt;
    while (chaos.flyAcc >= 1) { chaos.flyAcc -= 1; flyTile(); }
    while (chaos.towerAcc >= 1) { chaos.towerAcc -= 1; flyTower(); }
    if (sp <= FLY_SPIN && !pops.length && (chaos.removed.size || towerBlocks.some((b) => b.gone))) {
      chaos.calm += dt;
      if (chaos.calm > 4) restoreAll();
    }
  }
  if (chaos.green && t > chaos.greenUntil) { chaos.green = false; chaos.texDirty = true; drawTowers(); }
  if (chaos.texDirty && t - chaos.texAt > 0.15) { chaos.texDirty = false; chaos.texAt = t; drawTexture(); }

  const nv = state.bySym.NVDA;
  const bendTo = nv?.live && nv.changePct < -5 && phys.mode === 'balance' ? 0.22 + Math.sin(t * 38) * 0.035 : 0;
  chaos.bend += (bendTo - chaos.bend) * Math.min(1, dt * 8);
  bendRod(chaos.bend);
  chaos.jump += dt;

  stepDebris(dt);
  stepHeat(dt);
  stepPops(dt);
  stepNight(dt);
  for (let i = toasts.length - 1; i >= 0; i--) {
    toasts[i].t += dt;
    if (toasts[i].t > toasts[i].dur) toasts.splice(i, 1);
  }
}

// ---------- анимация ----------
const clock = new THREE.Clock();
let t = 0;
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  t += dt;
  step(dt);
  renderer.render(scene, camera);
  drawOverlay();
  pick();
  requestAnimationFrame(frame);
}

applyLang();
document.fonts.load('900 40px Rubik').finally(() => { drawTexture(); load(); });
setInterval(load, 30000);
frame();
