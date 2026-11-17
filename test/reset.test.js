const test = require('node:test'), assert = require('node:assert');
const Reset = require('../public/reset.js');

const theme = () => ({
  name: '픽스 픽스', source: { sheet: { rows: [{ id: 'S001', ko: '가' }] }, sign: { confirm: { by: 'a' } } }, und: { goal: 'x' }, lang: { en: '밝게' }, ai: { en: 'Claude' },
  progress: { en: 4, ja: 3 }, progressBy: { en: { 4: { n: 'a' } }, ja: { 3: { n: 'b' } } },
  work: {
    en: { sheet: { ids: ['S001'] }, items: { S001: { tr: 'A', hv: { v: '승인' }, rv: { total: 9 }, hist: [{ tr: 'old' }], human: { tr: 'H' } }, '@file': { memos: [] } }, pz: { a: 1 }, pzOk: { a: {} }, uploads: [{ name: 'EN_x.xlsx' }], resets: [{ by: 'old', at: '2026-01-01' }] },
    ja: { sheet: { ids: ['S001'] }, items: { S001: { tr: 'あ' } } },
  },
});

test('언어 고르기: 없거나 모르는 언어면 거부, 순서는 en·ja·zh', () => {
  assert.equal(Reset.cleanLangs([]), null);
  assert.equal(Reset.cleanLangs(['en', 'kr']), null);
  assert.equal(Reset.cleanLangs('en'), null);
  assert.deepEqual(Reset.cleanLangs(['zh', 'en', 'en']), ['en', 'zh']);
});

test('지울 파일: 고른 언어의 번역 엑셀만 (원본·이미지·다른 언어는 남김)', () => {
  const names = ['SRC_a.xlsx', 'EN_a.xlsx', 'EN_b.xlsx', 'JA_a.xlsx', 'EN_shot.png', 'ZH_a.xlsx'];
  assert.deepEqual(Reset.filesFor(names, ['en']), ['EN_a.xlsx', 'EN_b.xlsx']);
  assert.deepEqual(Reset.filesFor(names, ['ja', 'zh']), ['JA_a.xlsx', 'ZH_a.xlsx']);
});

test('리셋: 고른 언어 기록만 지우고 원문 분석·게임 정보·다른 언어는 그대로, 리셋 기록은 쌓임', () => {
  const t = theme(), before = JSON.stringify(t);
  const n = Reset.apply(t, ['en'], '예은', '2026-11-17T00:00:00Z', ['EN_x.xlsx', 'JA_y.xlsx']);
  assert.equal(JSON.stringify(t), before, '원본 문서는 바뀌지 않음');
  assert.deepEqual(Object.keys(n.work.en), ['resets']);
  assert.equal(n.work.en.resets.length, 2);
  assert.deepEqual(n.work.en.resets[1], { by: '예은', at: '2026-11-17T00:00:00Z', full: true, files: ['EN_x.xlsx'] });
  assert.equal(n.progress.en, 0); assert.deepEqual(n.progressBy.en, {});
  assert.deepEqual(n.work.ja, t.work.ja); assert.equal(n.progress.ja, 3); assert.deepEqual(n.progressBy.ja, t.progressBy.ja);
  ['name', 'source', 'und', 'lang', 'ai'].forEach(k => assert.deepEqual(n[k], t[k], k + ' 남음'));
});

test('현황: 승인·검수·수정 이력·사람 번역 수, 빈 언어 표시', () => {
  const t = theme();
  assert.deepEqual(Reset.summary(t, 'en'), { rows: 1, approved: 1, reviewed: 1, edited: 1, human: 1, stage: 4, empty: false });
  assert.equal(Reset.summary(t, 'zh').empty, true);
  assert.equal(Reset.summary(Reset.apply(t, ['en'], 'a', 'b', []), 'en').empty, true, '리셋 기록만 있으면 빈 언어');
});

test('게임 이름 확인: 공백 차이만 허용', () => {
  assert.ok(Reset.nameOk({ name: '픽스 픽스' }, '  픽스   픽스 '));
  assert.ok(!Reset.nameOk({ name: '픽스 픽스' }, '픽스픽스'));
  assert.ok(!Reset.nameOk({ name: '' }, ''));
});
