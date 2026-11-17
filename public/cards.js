/* 카드 모델 1단계 — 2지선다 퀴즈 카드 (문제 1줄 + 선택지 2줄 + 정답 + 정답 위치 + 유형 태그)
   화면과 서버·테스트가 같이 쓰는 순수 함수. 번역·검수는 2단계부터 카드 단위로 붙임.

   저장: t.cards = { list: Card[], by, at, src }
   Card = { id, q, opts: [줄, 줄], answer: 0|1, pos: 'L'|'R', tag, tagWhy, answerBy: {n, at} }
     - q·opts: 원문표 줄 번호(S###). 카드 줄은 같은 문구 자동 합치기에서 빠짐
     - answer: 사람이 입력한 정답 (AI 결과로는 바꾸지 않음)
     - pos: 한국어 화면에서 정답이 보이는 쪽 (L 왼쪽 / R 오른쪽). 번역에서 정답 쪽이 바뀌면 ‘개발 공유 필요’
     - tag: 상식 · 노래 · 말장난 · 문화. 상식이 아니면 언어마다 대체 카드가 있어야 출시 가능
   대체 카드(2단계부터 등록): { lang, q, opts, answer, tag(그 언어 기준), by, at } — 상식만 허용 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Cards = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const TAGS = ['상식', '노래', '말장난', '문화'];
  const NEED_REPL = ['노래', '말장난', '문화'];
  const clean = v => String(v == null ? '' : v).replace(/\r/g, '').trim();
  const normKo = s => String(s || '').replace(/\s+/g, '').replace(/[.,!?~…·'"‘’“”()\[\]（）]/g, '');
  const isHead = c => /^(id|번호|no\.?)$/i.test(c[0] || '') || (/문제/.test(c[1] || '') && /선택지/.test(c[2] || ''));
  function splitRow(line) { const s = String(line); return (s.includes('\t') ? s.split('\t') : s.split('|')).map(clean); }

  function tagOf(v) {
    const s = clean(v).replace(/\s/g, '');
    if (!s) return '';
    if (/^(상식|일반|universal|보편)/i.test(s)) return '상식';
    if (/^(노래|가사|동요|캐럴|song)/i.test(s)) return '노래';
    if (/^(말장난|언어유희|wordplay|pun)/i.test(s)) return '말장난';
    if (/^(문화|한국문화|ko_?culture|culture)/i.test(s)) return '문화';
    return null;
  }
  function answerOf(v) {
    const a = clean(v).toLowerCase();
    if (/^(1|①|a|left|l|왼쪽|좌)$/.test(a)) return 0;
    if (/^(2|②|b|right|r|오른쪽|우)$/.test(a)) return 1;
    return -1;
  }
  function posOf(v, answer) {
    const a = clean(v).toLowerCase();
    if (!a) return answer === 1 ? 'R' : 'L';   // 비우면 선택지1=왼쪽, 선택지2=오른쪽으로 봄
    if (/^(l|left|왼쪽|좌|1)$/.test(a)) return 'L';
    if (/^(r|right|오른쪽|우|2)$/.test(a)) return 'R';
    return '';
  }

  /* 칸 값 → 원문표 줄 번호. S### 그대로 쓰거나, 원문 글자로 찾음(같은 글자가 여러 줄이면 모호) */
  function resolveRow(v, rows) {
    const s = clean(v); if (!s) return { err: '비어 있음' };
    const id = s.toUpperCase().replace(/\s/g, '');
    if (/^[A-Z]{1,3}\d{2,}(-\d+)?$/.test(id)) return rows.some(r => r.id === id) ? { id } : { err: `원문표에 ${id} 없음` };
    const hit = rows.filter(r => normKo(r.ko) === normKo(s));
    if (!hit.length) return { err: `원문표에서 ‘${s.slice(0, 20)}’ 문구를 찾지 못함` };
    if (hit.length > 1) return { err: `‘${s.slice(0, 20)}’ 문구가 ${hit.map(r => r.id).join('·')}에 있음 → 줄 번호로 쓰기` };
    return { id: hit[0].id };
  }

  /* 카드 표 붙여 넣기: 번호 | 문제 | 선택지1 | 선택지2 | 정답(1·2) | 정답 위치(왼쪽·오른쪽, 비우면 정답 번호대로) | 태그 | 태그 근거
     문제·선택지 칸에는 원문표 줄 번호(S012) 또는 원문 글자 */
  function parse(input, rows) {
    const lines = Array.isArray(input) ? input.map(r => Array.isArray(r) ? r.map(clean) : splitRow(r)) : String(input || '').split('\n').map(splitRow);
    const list = [], errors = [], seen = new Set();
    lines.filter(c => c.some(Boolean)).forEach((c, i) => {
      if (i === 0 && isHead(c)) return;
      const [id0, q, o1, o2, ans, pos, tag, tagWhy] = c, id = clean(id0).toUpperCase().replace(/\s/g, '');
      const where = `${i + 1}째 줄${id ? ` (${id})` : ''}`;
      if (!id) return errors.push(`${where}: 번호 없음`);
      if (seen.has(id)) return errors.push(`${where}: 번호가 겹침`);
      const R = [q, o1, o2].map(v => resolveRow(v, rows || []));
      const bad = R.map((r, k) => r.err ? `${['문제', '선택지1', '선택지2'][k]} ${r.err}` : '').filter(Boolean);
      if (bad.length) return errors.push(`${where}: ${bad.join(' / ')}`);
      if (R[1].id === R[2].id) return errors.push(`${where}: 두 선택지가 같은 줄`);
      const a = answerOf(ans); if (a < 0) return errors.push(`${where}: 정답 ‘${ans || ''}’ → 1·2(또는 왼쪽·오른쪽)로 쓰기 (사람이 정한 정답만 받음)`);
      const p = posOf(pos, a); if (!p) return errors.push(`${where}: 정답 위치 ‘${pos}’ → 왼쪽·오른쪽으로 쓰기`);
      const tg = tagOf(tag); if (tg === null || !tg) return errors.push(`${where}: 태그 ‘${tag || ''}’ → ${TAGS.join('·')} 중 하나`);
      seen.add(id);
      list.push({ id, q: R[0].id, opts: [R[1].id, R[2].id], answer: a, pos: p, tag: tg, tagWhy: clean(tagWhy) });
    });
    /* 한 줄을 여러 카드가 같이 쓰면 안 됨 (번역이 카드마다 달라질 수 있음) */
    const use = {};
    list.forEach(cd => [cd.q, ...cd.opts].forEach(r => (use[r] = use[r] || []).push(cd.id)));
    Object.entries(use).filter(([, L]) => L.length > 1).forEach(([r, L]) => errors.push(`${r}: 카드 ${[...new Set(L)].join('·')}가 같이 씀 → 원문표에서 줄을 나누고(같은 문구 합치기 해제) 다시 올리기`));
    return { list, errors };
  }

  const listOf = t => (t && t.cards && Array.isArray(t.cards.list)) ? t.cards.list : [];
  /* 카드에 쓰인 줄 번호 (자동 합치기·번역 메모리에서 뺌) */
  const rowIds = t => new Set(listOf(t).flatMap(c => [c.q, ...(c.opts || [])]).filter(Boolean));
  /* 원문표에서 사라진 줄을 가리키는 카드 */
  function broken(t) {
    const ids = new Set(((t && t.source && t.source.sheet && t.source.sheet.rows) || []).map(r => r.id));
    return listOf(t).filter(c => ![c.q, ...c.opts].every(r => ids.has(r)));
  }

  /* 대체 카드 등록 검사: 상식만, 그 언어 기준 태그에 노래·말장난·문화가 있으면 차단 */
  function replCheck(r) {
    const errs = [];
    if (!r || typeof r !== 'object') return ['대체 카드 형식이 아님'];
    if (!clean(r.q)) errs.push('문제 없음');
    if (!Array.isArray(r.opts) || r.opts.length !== 2 || r.opts.some(o => !clean(o))) errs.push('선택지가 2개가 아님');
    else if (clean(r.opts[0]) === clean(r.opts[1])) errs.push('두 선택지가 같음');
    if (r.answer !== 0 && r.answer !== 1) errs.push('정답(사람이 정함) 없음');
    const tags = (Array.isArray(r.tags) ? r.tags : [r.tag]).map(tagOf).filter(x => x !== '');
    if (!tags.length) errs.push(`${r.lang || ''} 기준 태그 검사 결과 없음`);
    if (tags.some(x => x === null)) errs.push('알 수 없는 태그');
    const hit = tags.filter(x => NEED_REPL.includes(x));
    if (hit.length) errs.push(`${r.lang || ''} 기준 ${hit.join('·')} 태그 → 대체 카드로 등록 불가 (상식만)`);
    return errs;
  }

  /* 출시 차단: 상식이 아닌 카드는 그 언어 대체 카드가 있어야 함 */
  function releaseBlocks(t, lk) {
    const repl = ((t && t.cards && t.cards.repl) || {})[lk] || {};
    return listOf(t).filter(c => NEED_REPL.includes(c.tag) && !(repl[c.id] && !replCheck(Object.assign({ lang: lk }, repl[c.id])).length)).map(c => ({ id: c.id, tag: c.tag }));
  }
  function stats(t) {
    const L = listOf(t), by = {}; TAGS.forEach(k => { by[k] = 0; }); L.forEach(c => { by[c.tag] = (by[c.tag] || 0) + 1; });
    return { n: L.length, by, needRepl: L.filter(c => NEED_REPL.includes(c.tag)).length, broken: broken(t).length };
  }

  return { TAGS, NEED_REPL, tagOf, answerOf, posOf, resolveRow, parse, listOf, rowIds, broken, replCheck, releaseBlocks, stats, normKo };
});
