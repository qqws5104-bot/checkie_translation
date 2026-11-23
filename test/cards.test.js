const test = require('node:test'), assert = require('node:assert');
const C = require('../public/cards.js');
const rows = [{ id: 'S001', ko: '크리스마스는 (  )에 있다' }, { id: 'S002', ko: '여름' }, { id: 'S003', ko: '겨울' }, { id: 'S004', ko: '빨강' }, { id: 'S005', ko: '빨강' }, { id: 'S006', ko: '울면 안 돼 (  )~♬' }, { id: 'S007', ko: '울면' }, { id: 'S008', ko: '웃으면' }];

test('카드 표: 줄 번호·원문 글자로 연결, 정답·위치·태그', () => {
  const P = C.parse('번호|문제|선택지1|선택지2|정답|정답 위치|태그\nq1|S001|여름|겨울|2||상식\nQ2|S006|S008|S007|오른쪽|오른쪽|노래|캐럴 가사', rows);
  assert.deepEqual(P.errors, []);
  assert.deepEqual(P.list[0], { id: 'Q1', q: 'S001', opts: ['S002', 'S003'], answer: 1, pos: 'R', tag: '상식', tagWhy: '' });
  assert.equal(P.list[1].tag, '노래'); assert.equal(P.list[1].answer, 1);
});

test('카드 표 오류: 모호한 글자, 없는 줄, 정답 없음, 태그 없음, 같은 줄을 두 카드가 씀', () => {
  const P = C.parse(['Q1|S001|빨강|겨울|1||상식', 'Q2|S001|S009|겨울|1||상식', 'Q3|S006|S007|S008|||노래', 'Q4|S006|S007|S008|1||', 'Q5|S001|S002|S003|1||상식', 'Q6|S001|S002|S003|1||상식'], rows);
  const e = P.errors.join('\n');
  assert.match(e, /Q1.*S004·S005/); assert.match(e, /Q2.*S009 없음/); assert.match(e, /Q3.*정답/); assert.match(e, /Q4.*태그/);
  assert.match(e, /S001: 카드 Q5·Q6 여러 장이 같이 씀/);
});

test('카드 줄 번호 모음 · 원문에서 사라진 줄', () => {
  const t = { source: { sheet: { rows } }, cards: { list: [{ id: 'Q1', q: 'S001', opts: ['S002', 'S003'] }, { id: 'Q2', q: 'S099', opts: ['S007', 'S008'] }] } };
  assert.deepEqual([...C.rowIds(t)].sort(), ['S001', 'S002', 'S003', 'S007', 'S008', 'S099']);
  assert.deepEqual(C.broken(t).map(c => c.id), ['Q2']);
});

test('대체 카드: 상식만, 그 언어 태그에 노래·말장난·문화가 있으면 등록 차단', () => {
  const ok = { lang: 'ja', q: 'クリスマスは(　)月', opts: ['8', '12'], answer: 1, tags: ['상식'] };
  assert.deepEqual(C.replCheck(ok), []);
  assert.match(C.replCheck(Object.assign({}, ok, { tags: ['상식', '말장난'] })).join(), /말장난 태그 → 대체 카드로 등록 불가/);
  assert.match(C.replCheck(Object.assign({}, ok, { tags: [] })).join(), /태그 검사 결과 없음/);
  assert.match(C.replCheck(Object.assign({}, ok, { answer: null })).join(), /정답/);
});

test('출시 차단: 상식이 아닌 카드에 그 언어 대체 카드가 없거나 검사 실패', () => {
  const t = { cards: { list: [{ id: 'Q1', tag: '상식' }, { id: 'Q2', tag: '노래' }, { id: 'Q3', tag: '문화' }], repl: { ja: { Q2: { q: 'x', opts: ['a', 'b'], answer: 0, tags: ['상식'] }, Q3: { q: 'x', opts: ['a', 'b'], answer: 0, tags: ['문화'] } } } } };
  assert.deepEqual(C.releaseBlocks(t, 'ja').map(x => x.id), ['Q3']);
  assert.deepEqual(C.releaseBlocks(t, 'en').map(x => x.id), ['Q2', 'Q3']);
});

/* ---- 2단계 ---- */
const cards2 = [{ id: 'Q1', q: 'S001', opts: ['S002', 'S003'], answer: 1, pos: 'R', tag: '상식' }, { id: 'Q2', q: 'S006', opts: ['S007', 'S008'], answer: 0, pos: 'L', tag: '노래' }];
const T2 = (per) => ({ source: { sheet: { rows } }, cards: { list: cards2, per: { ja: per } } });

test('카드 번역 표 읽기: 상식은 정답 번호가 사람 정답과 같아야, 대체는 후보 A·B', () => {
  const tb = [['카드', '후보', '문제', '선택지1', '선택지2', '정답', '태그', '출처·근거', '이유'],
    ['Q1', '번역', 'クリスマスは(　)にある', '夏', '冬', '2', '', '', ''], ['Q1', '번역', 'x', 'a', 'b', '1', '', '', ''],
    ['Q2', 'A', 'クリスマスは何月?(　)', '12月', '8月', '1', '상식', '일본 상식', ''], ['Q2', 'B', 'y', 'c', 'c', '1', '상식', '', '']];
  const P = C.parseTr(tb, cards2, 'ja', 'Claude');
  assert.equal(P.out.Q1.length, 1); assert.equal(P.out.Q1[0].k, 'Claude'); assert.equal(P.out.Q1[0].aiAns, 1);
  assert.equal(P.out.Q2.length, 1); assert.equal(P.out.Q2[0].k, 'A·Claude'); assert.deepEqual(P.out.Q2[0].tags, ['상식']);
  assert.match(P.errors.join('\n'), /정답이 한국어 카드\(2번\)와 다름/); assert.match(P.errors.join('\n'), /두 선택지가 같음/);
});

test('카드 상태: 상식은 두 순서 풀어 보기 PASS면 자동 선택, 순서 따라 바뀌면 FAIL', () => {
  const cand = { k: 'Claude', q: 'q', opts: ['夏', '冬'], aiAns: 1, h: C.hashOf('q', ['夏', '冬']) };
  let s = C.cardState(T2({ Q1: { cands: [cand] } }), 'ja', cards2[0]);
  assert.equal(s.ok, false); assert.match(s.why, /번역 AI 2개 중 0개만/);
  s = C.cardState(T2({ Q1: { cands: [cand], solve: { [cand.h]: { runs: { a: 1, b: 0 } } } } }), 'ja', cards2[0]);
  assert.equal(s.cands[0].sol.v, 'FAIL'); assert.match(s.cands[0].sol.why, /순서에 따라/);
  const one = T2({ Q1: { cands: [Object.assign({ by: 'Claude' }, cand)], solve: { [cand.h]: { runs: { a: 1, b: 1 } } } } });
  assert.match(C.cardState(one, 'ja', cards2[0]).why, /번역 AI 2개 중 1개만/);
  const c2 = { k: 'ChatGPT', by: 'ChatGPT', q: 'q', opts: ['なつ', 'ふゆ'], aiAns: 1, h: C.hashOf('q', ['なつ', 'ふゆ']) };
  const t = T2({ Q1: { cands: [Object.assign({ by: 'Claude' }, cand), c2], solve: { [cand.h]: { runs: { a: 1, b: 1 } }, [c2.h]: { runs: { a: 0, b: 0 } } } } });
  s = C.cardState(t, 'ja', cards2[0], id => ({ S001: 'q', S002: '夏', S003: '冬' })[id]);
  assert.equal(s.ok, true); assert.equal(s.auto, true); assert.equal(s.pick.k, 'Claude'); assert.equal(s.answer, 1); assert.equal(s.applied, true);
  const bothFail = T2({ Q1: { cands: [Object.assign({ by: 'Claude' }, cand), c2], solve: { [cand.h]: { runs: { a: 0, b: 0 } }, [c2.h]: { runs: { a: 0, b: 0 } } } } });
  assert.match(C.cardState(bothFail, 'ja', cards2[0]).why, /원문 단순화 필요/);
  assert.equal(C.cardState(t, 'ja', cards2[0], id => ({ S001: 'q', S002: '夏', S003: '冬?' })[id]).applied, false);
});

test('대체 카드: 사람이 정답을 확인해야 완료, 노래 태그 후보는 불가, 정답 쪽이 다르면 개발 공유', () => {
  const a = { k: 'A·Claude', q: 'q2', opts: ['12月', '8月'], aiAns: 0, tags: ['상식'], h: C.hashOf('q2', ['12月', '8月']) };
  const b = { k: 'B·Claude', q: 'q3', opts: ['x', 'y'], aiAns: 0, tags: ['노래'], h: C.hashOf('q3', ['x', 'y']) };
  const solve = { [a.h]: { runs: { a: 0, b: 0 } } };
  let s = C.cardState(T2({ Q2: { cands: [a, b], solve } }), 'ja', cards2[1]);
  assert.equal(s.ok, false); assert.match(s.why, /대체 카드 고르기 전/); assert.match(s.cands[1].errs.join(), /노래 태그 → 대체 카드 불가/);
  s = C.cardState(T2({ Q2: { cands: [a, b], solve, pick: { k: a.k, h: a.h, answer: 0 } } }), 'ja', cards2[1]);
  assert.equal(s.ok, true);
  s = C.cardState(T2({ Q2: { cands: [a, b], solve, pick: { k: a.k, h: a.h, answer: 1 } } }), 'ja', cards2[1]);
  assert.equal(s.ok, false); assert.match(s.why, /풀어 보기 FAIL/);
  const flip = { k: 'C', q: 'q4', opts: ['8月', '12月'], aiAns: 1, tags: ['상식'], h: C.hashOf('q4', ['8月', '12月']) };
  s = C.cardState(T2({ Q2: { cands: [flip], solve: { [flip.h]: { runs: { a: 1, b: 1 } } }, pick: { k: 'C', h: flip.h, answer: 1 } } }), 'ja', cards2[1]);
  assert.equal(s.ok, false); assert.match(s.why, /개발 공유 필요/);
  assert.deepEqual(C.blocks(T2({}), 'ja').map(x => x.id), ['Q1', 'Q2']);
});

test('풀어 보기: 정답을 맞혀도 한국 지식·특정 노래가 필요하면 FAIL (상식 우선)', () => {
  const cand = { h: 'h1' };
  assert.equal(C.solveVerdict({ solve: { h1: { runs: { a: 0, b: 0 }, know: { a: '상식', b: '없음' } } } }, cand, 0).v, 'PASS');
  const v = C.solveVerdict({ solve: { h1: { runs: { a: 0, b: 0 }, know: { a: '특정 노래·작품', b: '상식' } } } }, cand, 0);
  assert.equal(v.v, 'FAIL'); assert.match(v.why, /배경지식 필요: 특정 노래/);
  assert.equal(C.solveVerdict({ solve: { h1: { runs: { a: 0, b: 0 }, know: { b: '한국 지식' } } } }, cand, 0).v, 'FAIL');
});
