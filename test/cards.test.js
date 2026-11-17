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
  assert.match(e, /S001: 카드 Q5·Q6가 같이 씀/);
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
