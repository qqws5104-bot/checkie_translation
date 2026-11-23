const test = require('node:test'), assert = require('node:assert');
const R = require('../public/redo.js'), h = s => 'h:' + s;
test('재설계 묶음: 한 줄만 바뀌면 불일치, 기록 없는 줄은 누락, 승인은 지금 번역 기준', () => {
  const base = [{ id: 'S064', tr: 'A', redo: { also: 'S065, S066 (선택지)', trh: h('A') } }, { id: 'S065', tr: 'B', redo: { also: 'S064', trh: h('B') } }, { id: 'S066', tr: 'C', redo: { trh: h('C') } }, { id: 'S010', tr: 'x' }];
  let g = R.groups(base, h); assert.equal(g.length, 1); assert.deepEqual(g[0].ids, ['S064', 'S065', 'S066']); assert.equal(g[0].problem, ''); assert.equal(g[0].ok, false);
  const moved = base.map(e => e.id === 'S064' ? Object.assign({}, e, { tr: 'A2' }) : e);
  g = R.groups(moved, h); assert.match(g[0].problem, /S064만 재설계안에서 바뀜, S065·S066: 재설계안 그대로/);
  const miss = [{ id: 'S020', tr: 'q', redo: { also: 'S021', trh: h('q') } }, { id: 'S021', tr: 'o' }];
  assert.match(R.groups(miss, h)[0].problem, /S021에 재설계 기록이 없음/);
  const k = R.groups(base, h)[0].k, ok = base.map(e => e.redo ? Object.assign({}, e, { ok: { k, why: '확정' } }) : e);
  assert.equal(R.groups(ok, h)[0].ok, true);
  assert.equal(R.groups(ok.map(e => e.id === 'S066' ? Object.assign({}, e, { tr: 'C2' }) : e), h)[0].ok, false, '번역이 바뀌면 다시 승인');
});
