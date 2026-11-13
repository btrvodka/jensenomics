// Тесты движка «Удержи экономику»: node --test balance-test/engine.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const E = require(path.join(__dirname, '..', 'web', 'balance', 'engine.js'));

const settle = (g, sec) => { for (let i = 0; i < sec * 120 && !g.over; i++) g.tick(1 / 120); };
const small = (symbol, cap) => ({ symbol, cap, group: 't' }); // 1×1 плитка с нужной капой

test('тяжёлая плитка у края кренит мир в её сторону, симметрия держит равновесие', () => {
  const g = E.createGame({ seed: 1, wobble: 0 });
  const pr = (g.piece = Object.assign({}, g.piece, { size: 3, mass: E.massFor(4500), cap: 4500, x: 0, y: g.H - 3 }), g.predict(7));
  assert.ok(pr.theta > 0.05, 'прогноз: вправо');
  g._place('NVDA', 7);
  settle(g, 3);
  assert.ok(g.theta > 0.05 && !g.over, 'мир накренился вправо и устоял');
  assert.ok(Math.abs(g.theta - pr.theta) < 0.03, 'устоялся там, где показал прогноз');
  g._place('AAPL', 0); // почти такая же масса слева
  settle(g, 4);
  assert.ok(Math.abs(g.theta) < 0.03, 'симметрия вернула равновесие');
});

test('полный ряд исчезает, капитализация уходит в копилку, верх опускается', () => {
  const g = E.createGame({ seed: 2, wobble: 0, W: 4 });
  g._place(small('A', 100), 0);
  g._place(small('B', 100), 1);
  g._place(small('C', 100), 3);
  g._place(small('TOP', 100), 3); // ляжет вторым рядом над C
  assert.strictEqual(g.cells[1][3] !== null, true);
  const before = g.banked;
  g._place(small('D', 100), 2); // ряд 0 заполнен
  const lines = g.drainEvents().find((e) => e.type === 'lines');
  assert.ok(lines && lines.count === 1);
  assert.strictEqual(Math.round(lines.gain), 400);
  assert.ok(g.banked > before + 399);
  assert.strictEqual(g.cells[0][3] !== null && g.cells[1][3] === null, true, 'TOP опустился в нижний ряд');
  assert.strictEqual(g.lines, 1);
});

test('перегруз одной стороны — крах с процентом потерянной экономики', () => {
  const g = E.createGame({ seed: 3, wobble: 0 });
  g._place('NVDA', 7);
  settle(g, 1);
  const pr = g.predict(7); // текущая плитка туда же
  g._place('AAPL', 7);
  settle(g, 4);
  assert.ok(g.over, 'мир упал');
  assert.strictEqual(g.crashReason, 'tilt');
  const crash = g.drainEvents().find((e) => e.type === 'crash');
  assert.ok(crash.pct > 50 && crash.pct <= 100);
  assert.ok(pr !== null);
});

test('квадрат ложится на самую высокую колонку под собой', () => {
  const g = E.createGame({ seed: 4, wobble: 0 });
  g._place(small('A', 100), 4);
  g._place(small('B', 100), 4); // колонка 4 высотой 2
  g._place('AVGO', 3); // 2×2 на колонках 3–4
  assert.strictEqual(g.cells[2][3] !== null && g.cells[3][4] !== null, true);
  assert.strictEqual(g.cells[0][3], null, 'под квадратом осталась дыра');
});

test('башня до потолка — крах «упёрлась в потолок»', () => {
  const g = E.createGame({ seed: 5, wobble: 0, W: 4, H: 4, K: 5000 });
  const one = { symbol: 'Z', cap: 100, size: 1, mass: 1, changePct: 0, group: 't' };
  for (let i = 0; i < 4; i++) { g.next = Object.assign({}, one); g._place(small('X' + i, 100), 0); }
  assert.ok(!g.over, 'до потолка ещё стоим');
  // колонка 0 заполнена до верха; следующая плитка в центре спавнится нормально,
  // а «AAPL» 3×3 уже не помещается в поле 4×4 с занятой колонкой
  g.next = { symbol: 'AAPL', cap: 4000, size: 3, mass: E.massFor(4000), changePct: 0, group: 'm' };
  g._place(small('Y', 100), 2);
  settle(g, 1);
  assert.ok(g.over);
  assert.strictEqual(g.crashReason, 'top');
});
