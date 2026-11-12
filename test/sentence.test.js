/* 문장 오류 고정 자료: 조작 동사 · 판독 의심 · 공유 용어 · 비슷한 원문 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const R = require('../public/rules.js');
const C = require('./fixtures/sentence/cases.json');
/* 화면과 같은 글자 2개씩 비슷도 (index.html의 simKo와 같은 계산) */
const bigr = s => { const t = String(s || '').replace(/\s/g, ''), out = new Set(); for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2)); return out; };
const sim = (a, b) => { const A = bigr(a), B = bigr(b); if (!A.size || !B.size) return null; let n = 0; A.forEach(x => { if (B.has(x)) n++; }); return 2 * n / (A.size + B.size); };
const op = R.parseOp(C.op);

test('조작 동사: Return → opVerb FAIL (고정 동사 없음 + 쓰지 말 것)', () => {
  assert.ok(R.opInKo(op, C.opFail.ko));
  const r = R.opVerbCheck(op, 'en', C.opFail.tr); assert.ok(r && !r.ok); assert.deepStrictEqual(r.miss, ['place']); assert.deepStrictEqual(r.bad, ['return']);
});
test('조작 동사: Please place → 통과, 어형 변화 허용, 일본어 어간', () => {
  assert.ok(R.opVerbCheck(op, 'en', C.opPass.tr).ok);
  assert.ok(R.opVerbCheck(op, 'en', 'Placing pixels is fun').ok);
  assert.ok(!R.opVerbCheck(op, 'en', 'Put the pixels back on the ticket').ok);
  assert.ok(R.opVerbCheck(op, 'ja', 'ピクセルを置いてください').ok);
});
test('판독 의심: 올려↔돌려 쌍, 자모 하나 차이 (ㅇ↔ㄷ)', () => {
  const P = R.nearPairs(C.near); assert.strictEqual(P.length, 1);
  assert.strictEqual(P[0].d, 1); assert.match(P[0].jamo, /ㅇ↔ㄷ|ㄷ↔ㅇ/);
  assert.strictEqual(R.nearPairs([{ id: 'a', ko: '짧은글' }, { id: 'b', ko: '짧은말' }]).length, 0);   // 6자 미만
});
test('공유 용어: mushroom / toadstool → shareTerm', () => {
  const m = R.shareCheck('en', C.share.map(r => ({ id: r.id, tr: r.tr, share: R.parseShare(r.share) })), 'AD_08');
  assert.ok(m.get('R081') && m.get('R088')); assert.match(m.get('R088').join(), /toadstool/);
  const ok = R.shareCheck('en', [{ id: 'a', tr: 'two mushrooms here', share: { 버섯: 'mushroom' } }, { id: 'b', tr: 'A mushroom', share: { 버섯: 'mushroom' } }], 'P');
  assert.strictEqual(ok.size, 0);
});
test('비슷한 원문: 셋 중 하나만 put → 그 줄만 nearIncons', () => {
  const m = R.nearInconsGroup('en', C.nearIncons, sim, 0.75);
  assert.deepStrictEqual([...m.keys()], ['R035']); assert.match(m.get('R035'), /place/);
});
test('역할 이름 읽기·순서, 금지 짝', () => {
  assert.strictEqual(R.roleOf('정답단서'), '정답 단서'); assert.strictEqual(R.roleOf('조작'), '조작 지시');
  assert.ok(R.roleRank('정답 단서') < R.roleRank('분위기'));
  assert.strictEqual(R.banHit('en', [{ ko: '올리다', avoid: 'return' }], '픽셀을 올려주세요', 'Return pixels', [op]).length, 1);
  assert.strictEqual(R.banHit('en', [{ ko: '찾다', avoid: 'search' }], '새를 찾아주세요', 'Search the bird').length, 1);
  assert.strictEqual(R.banHit('en', [{ ko: '올리다', avoid: 'return' }], '픽셀을 올려주세요', 'Place pixels', [op]).length, 0);
});
