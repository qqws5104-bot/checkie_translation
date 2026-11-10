/* 골든 세트: 사람 번역은 모두 통과, AI 번역은 모두 실패해야 함 (Chris×Mas AD 광고 화면) */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const P = require('../public/puzzle.js');
const G = require('./fixtures/ad_en/puzzles.json');

G.puzzles.forEach(z => {
  test(`${z.pid} (${P.TYPE_LABEL[z.type]}) 사람 번역 PASS`, () => { const r = P.check(z.type, z.human.spec, z.human.tr, 'en'); assert.strictEqual(r.v, 'PASS', r.msgs.join(' / ')); });
  test(`${z.pid} (${P.TYPE_LABEL[z.type]}) AI 번역 FAIL`, () => { const r = P.check(z.type, z.ai.spec, z.ai.tr, 'en'); assert.strictEqual(r.v, 'FAIL'); assert.ok(r.msgs.length); });
});

test('상보 빈칸: 반대로 채운 결과도 확인, 대소문자·문장부호 무시', () => {
  assert.strictEqual(P.checkBlankPair('( ) Birds ( )', 'Big ( ) fly!', 'big birds fly').v, 'PASS');
  const r = P.checkBlankPair('( ) birds ( )', 'Big ( ) swim', 'big birds fly'); assert.strictEqual(r.v, 'FAIL');
  assert.match(P.checkBlankPair('( ) a', 'x y ( )', 's').msgs.join(), /빈칸 1개인데/);
});
test('상보 빈칸: 영어 퍼즐인데 완성 문장이 한국어면 FAIL', () => {
  const r = P.check('blank_pair', '문장=철새는 구름 없는 곳으로 | 1P=A | 2P=B', { A: '( ) x', B: 'y ( )' }, 'en');
  assert.strictEqual(r.v, 'FAIL'); assert.match(r.msgs[0], /한국어/);
});
test('십자말: 칸 수·겹치는 칸·단서에 답 노출', () => {
  assert.strictEqual(P.checkCrossword('가로1=WEST@(4,1)→4 | 세로1=VASE@(1,2)↓4', [{ id: 'a', text: 'sun sets' }, { id: 'b', text: 'flowers' }], 'en').v, 'PASS');
  assert.match(P.checkCrossword('가로1=WEST@(4,1)→4 | 세로1=VASA@(1,2)↓4', [{ id: 'a', text: 'x' }, { id: 'b', text: 'y' }]).msgs.join(), /겹치는 칸/);
  assert.match(P.checkCrossword('가로1=WEST@(4,1)→4', [{ id: 'a', text: 'Go west' }]).msgs.join(), /그대로 보임/);
  assert.match(P.checkCrossword('가로1=서쪽@(1,1)→2', [{ id: 'a', text: 'x' }], 'en').msgs.join(), /한국어/);
});
test('틀린 그림: 이미지 차이를 빼고 셈', () => {
  assert.strictEqual(P.checkSpotDiff([['a', 'b'], ['c', 'c']], 2, 1).v, 'PASS');
  assert.strictEqual(P.checkSpotDiff([['a', 'b'], ['c', 'c']], 2).v, 'FAIL');
});
test('매칭: 월이 여러 개거나 그리드에 두 칸이면 FAIL', () => {
  assert.match(P.checkMapping('카드=A | 키=월 | 정답=JAN→SEED', [{ id: 'A', text: 'JAN and FEB' }]).msgs.join(), /여러 개/);
  assert.match(P.checkMapping('카드=A | 키=월 | 정답=JAN→SEED | 그리드=JAN:SEED, JAN:RAIN', [{ id: 'A', text: '2006-JAN-23' }]).msgs.join(), /2개/);
  assert.strictEqual(P.checkMapping('카드=A | 키=월 | 정답=1月→X | 그리드=1月:X', [{ id: 'A', text: '2006年1月23日' }]).v, 'PASS');
});
test('위치 단서: 조건에 맞는 칸이 하나뿐이고 단서에 물건 이름이 있어야 PASS', () => {
  const spec = '그리드=mushroom,_,tree / house,_,_ / _,_,_ | 조건=옆:mushroom ; 위:_ | 정답=(1,2) | 단서=c1';
  const one = '그리드=mushroom,_,tree / house,flower,_ | 조건=옆:mushroom ; 사이:mushroom,tree | 정답=(1,2) | 단서=c1';
  assert.strictEqual(P.check('grid_clue', one, { c1: 'It is next to the mushroom, between the mushroom and the tree.' }, 'en').v, 'PASS');
  assert.match(P.check('grid_clue', one, { c1: 'It is next to the red cap.' }, 'en').msgs.join(), /‘mushroom’이 없음/);
  assert.strictEqual(P.check('grid_clue', '그리드=a,_,a | 조건=옆:a | 정답=(1,2) | 단서=c1', { c1: 'next to a' }, 'en').v, 'PASS');
  assert.match(P.check('grid_clue', '그리드=a,_,_,a | 조건=옆:a | 정답=(1,2) | 단서=c1', { c1: 'a' }, 'en').msgs.join(), /2개/);
  assert.ok(spec);
});
test('어느 구조를 쓸지: 사람 확정 > AI 초안 > 원문 기준', () => {
  const answers = [{ id: 'P1', pzType: 'blank_pair', pzSpec: '문장=가 | 1P=A | 2P=B' }];
  const extra = [{ name: '퍼즐 구조', rows: [['퍼즐 ID', '유형', '구조'], ['P1', 'blank_pair', '문장=x | 1P=A | 2P=B']] }];
  assert.strictEqual(P.effective(answers, {}, []).P1.src, '원문 기준');
  assert.strictEqual(P.effective(answers, {}, extra).P1.src, 'AI 초안');
  assert.strictEqual(P.effective(answers, { P1: { type: 'blank_pair', spec: '문장=y | 1P=A | 2P=B' } }, extra).P1.spec, '문장=y | 1P=A | 2P=B');
});
test('AI 퍼즐 검수 표의 이름 → 퍼즐, 지문은 번역이 바뀌면 달라짐', () => {
  const list = P.run([{ id: 'AD_06', pzType: 'blank_pair', pzSpec: G.puzzles[0].human.spec }], {}, [], G.puzzles[0].human.tr, 'en');
  assert.strictEqual(P.matchPuzzle('AD_06 상보 빈칸', '', list).pid, 'AD_06');
  assert.strictEqual(P.matchPuzzle('철새 문장', 'R068', list).pid, 'AD_06');
  const l2 = P.run([{ id: 'AD_06', pzType: 'blank_pair', pzSpec: G.puzzles[0].human.spec }], {}, [], Object.assign({}, G.puzzles[0].human.tr, { R065: 'x' }), 'en');
  assert.notStrictEqual(list[0].h, l2[0].h);
});
test('텍스트로 풀어 본 답 비교', () => {
  assert.strictEqual(P.solveMatch('blank_pair', G.puzzles[0].human.spec, 'migratory birds want to fly where there are no clouds'), true);
  assert.strictEqual(P.solveMatch('crossword', G.puzzles[2].human.spec, 'WEST, VASE'), true);
  assert.strictEqual(P.solveMatch('crossword', G.puzzles[2].human.spec, 'WEST'), false);
  assert.strictEqual(P.solveMatch('spot_diff', G.puzzles[4].human.spec, 'Coll/Cell; DANCE/FINISH'), true);
  assert.strictEqual(P.solveMatch('mapping', G.puzzles[6].human.spec, 'SEED, DATE'), true);
});
