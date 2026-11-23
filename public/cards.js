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
    Object.entries(use).filter(([, L]) => L.length > 1).forEach(([r, L]) => errors.push(`${r}: 카드 ${[...new Set(L)].join('·')} 여러 장이 같이 씀 → 번역 화면 위 ‘합친 줄 나누기’에서 화면별로 나눈 뒤 새 줄 번호로 다시 저장`));
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

  /* ================= 2단계: 카드 단위 번역 · 대체 · 풀어 보기 =================
     t.cards.per[lk][카드] = { cands: [{ k, q, opts, aiAns, tags, src, why, by, at, h }], pick: { k, answer, h, by, at, auto }, solve: { [후보 h]: { runs: {a: 답, b: 답}, conf, note, at, by } } }
     - 상식 카드: 경로 ‘번역’. 선택지 순서를 그대로 옮기므로 정답은 한국어 카드의 사람 정답 그대로
     - 노래·말장난·문화 카드: 경로 ‘대체’. 그 언어에서 허용된 태그(기본 상식만)의 새 카드. 정답은 사람이 고를 때 확인
     - 풀어 보기: 번역문만 본 다른 AI가 두 순서(그대로·뒤집음)로 풀어 둘 다 정답이어야 PASS */
  const REPL_ALLOW = { en: ['상식'], ja: ['상식'], zh: ['상식'] };
  const TR_AIS = 2;   // 상식 카드는 서로 다른 번역 AI 2개의 번역을 받고, 풀어 보기 PASS인 것 중 먼저 받은 것을 씀
  const routeOf = c => NEED_REPL.includes(c.tag) ? 'repl' : 'tr';
  const ROUTE_LABEL = { tr: '번역', repl: '대체' };
  const ntext = s => clean(s).replace(/\s+/g, ' ');
  function hashOf(q, opts) { const s = [q, ...(opts || [])].map(ntext).join('\u0001'); let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); }
  const perOf = (t, lk) => ((t && t.cards && t.cards.per) || {})[lk] || {};
  const candOf = (pc, k) => ((pc && pc.cands) || []).find(x => x.k === k) || null;

  /* AI 답 표(시트 ‘카드 번역’): 카드 | 후보 | 문제 | 선택지1 | 선택지2 | 정답 | 태그 | 출처·근거 | 이유 */
  function parseTr(table, cards, lk, by) {
    const errors = [], out = {}, head = (table[0] || []).map(h => clean(h).replace(/\s/g, ''));
    const ix = f => head.findIndex(f), iC = Math.max(0, ix(h => h === '카드' || h === '번호')), iK = ix(h => h === '후보'), iQ = ix(h => h === '문제'), i1 = ix(h => h === '선택지1'), i2 = ix(h => h === '선택지2'), iA = ix(h => h === '정답'), iT = ix(h => h.startsWith('태그')), iS = ix(h => h.startsWith('출처')), iW = ix(h => h === '이유');
    if (iQ < 0 || i1 < 0 || i2 < 0) return { out, errors: ['열 이름(문제·선택지1·선택지2)을 찾지 못함'] };
    const M = new Map(cards.map(c => [c.id, c]));
    table.slice(1).forEach((r, n) => {
      const id = clean(r[iC]).toUpperCase().replace(/\s/g, ''); if (!id) return;
      const c = M.get(id), where = `${n + 2}행 ${id}`; if (!c) return errors.push(`${where}: 없는 카드`);
      const route = routeOf(c), q = clean(r[iQ]).replace(/\s\/\s/g, '\n'), opts = [clean(r[i1]), clean(r[i2])];
      if (!q || opts.some(o => !o)) return errors.push(`${where}: 문제·선택지 빈칸`);
      if (ntext(opts[0]) === ntext(opts[1])) return errors.push(`${where}: 두 선택지가 같음`);
      const a = iA >= 0 ? answerOf(r[iA]) : -1;
      if (route === 'tr' && a >= 0 && a !== c.answer) return errors.push(`${where}: 정답이 한국어 카드(${c.answer + 1}번)와 다름 — 선택지 순서를 바꾸지 말 것`);
      const tags = iT >= 0 ? clean(r[iT]).split(/[,·/\s]+/).map(tagOf).filter(x => x !== '') : [];
      const k = route === 'tr' ? (by || '번역') : (clean(iK >= 0 ? r[iK] : '') || String.fromCharCode(65 + ((out[id] || []).length))).toUpperCase().slice(0, 12);
      (out[id] = out[id] || []).push({ k: route === 'tr' ? k : `${k}·${by || 'AI'}`, q, opts, aiAns: route === 'tr' ? c.answer : a, tags, src: iS >= 0 ? clean(r[iS]) : '', why: iW >= 0 ? clean(r[iW]) : '', by: by || '', h: hashOf(q, opts) });
    });
    return { out, errors };
  }
  /* 후보 등록 가능 여부 (대체 카드는 그 언어 허용 태그만, 정답 위치는 한국어 화면과 같은 쪽) */
  function candCheck(c, cand, lk) {
    const errs = [];
    if (routeOf(c) === 'repl') {
      const tags = (cand.tags || []).filter(x => x);
      if (!tags.length) errs.push(`${lk} 기준 태그 없음`);
      if (tags.some(x => x === null)) errs.push('알 수 없는 태그');
      const bad = tags.filter(x => x && !(REPL_ALLOW[lk] || ['상식']).includes(x));
      if (bad.length) errs.push(`${bad.join('·')} 태그 → 대체 카드 불가 (${(REPL_ALLOW[lk] || ['상식']).join('·')}만)`);
      if (cand.aiAns !== 0 && cand.aiAns !== 1) errs.push('AI 정답 없음');
    }
    return errs;
  }
  /* 풀어 보기 문항 번호: 후보 h에서 정함 (복사한 프롬프트와 붙여 넣은 답을 상태 없이 맞춤) */
  const solveId = (h, flip) => `K${h.slice(0, 7).toUpperCase()}${flip ? 'B' : 'A'}`;
  function solveVerdict(pc, cand, answer) {
    const s = ((pc && pc.solve) || {})[cand.h]; if (!s || s.runs == null) return { v: '', why: '풀어 보기 전' };
    const ra = s.runs.a, rb = s.runs.b;   // rb는 뒤집은 순서에서 고른 번호 → 원래 번호로 바꿔 둠
    if (ra == null || rb == null) return { v: '', why: '풀어 보기 한쪽만 있음' };
    if (answer !== 0 && answer !== 1) return { v: '', why: '정답 확인 전' };
    /* 관광객이 풀려면 한국 지식이나 특정 노래·작품을 알아야 한다고 답하면 FAIL (v30: 최대한 상식) */
    const kn = Object.values(s.know || {}).map(String).find(k => /한국|노래|작품|곡/.test(k));
    if (ra === answer && rb === answer && kn) return { v: 'FAIL', why: `정답은 맞혔지만 배경지식 필요: ${kn}` };
    if (ra === answer && rb === answer) return { v: 'PASS', why: '두 순서 모두 정답' };
    return { v: 'FAIL', why: ra === rb ? `두 순서 모두 ${ra + 1}번을 고름 (정답 ${answer + 1}번)` : '순서에 따라 답이 바뀜 (위치로 찍음)' };
  }
  /* 카드 하나의 상태 (화면·서버 공용). trOf(id) → 그 줄 지금 번역 */
  function cardState(t, lk, c, trOf) {
    const pc = perOf(t, lk)[c.id] || {}, route = routeOf(c), cands = pc.cands || [];
    const answerOfCand = cand => route === 'tr' ? c.answer : (pc.pick && pc.pick.k === cand.k ? pc.pick.answer : cand.aiAns);
    const sv = cands.map(cand => ({ cand, errs: candCheck(c, cand, lk), sol: solveVerdict(pc, cand, answerOfCand(cand)) }));
    const nAi = new Set(cands.map(x => x.by).filter(Boolean)).size, needAi = route === 'tr' && nAi < TR_AIS;
    let pick = pc.pick && candOf(pc, pc.pick.k) && pc.pick.h === candOf(pc, pc.pick.k).h ? candOf(pc, pc.pick.k) : null, auto = false;
    if (!pick && route === 'tr' && !needAi) { const p = sv.find(o => o.sol.v === 'PASS' && !o.errs.length); if (p) { pick = p.cand; auto = true; } }
    const ans = pick ? (route === 'tr' ? c.answer : (pc.pick && pc.pick.k === pick.k ? pc.pick.answer : null)) : null;
    const ps = pick ? sv.find(o => o.cand === pick) : null;
    const side = ans == null ? '' : ans === (c.pos === 'R' ? 1 : 0) ? '' : '정답이 한국어 화면과 다른 쪽 → 개발 공유 필요';
    const why = !cands.length ? `카드 ${ROUTE_LABEL[route]} 받기 전` : needAi && !pick ? `번역 AI ${TR_AIS}개 중 ${nAi}개만 받음` : !pick ? (route === 'repl' ? '대체 카드 고르기 전' : sv.some(o => !o.sol.v) ? '풀어 보기 전' : '두 번역 모두 풀어 보기 FAIL → 한국어 원문 단순화 필요') : ps.errs.length ? ps.errs.join(' · ') : ans == null ? '정답 확인 전' : ps.sol.v !== 'PASS' ? `풀어 보기 ${ps.sol.v || '전'}: ${ps.sol.why}` : side ? side : '';
    let applied = null;
    if (pick && trOf) { const now = [c.q, ...c.opts].map(id => ntext(trOf(id))), want = [pick.q, ...pick.opts].map(ntext); applied = now.every((v, i) => v === want[i]); }
    return { route, cands: sv, pick, auto, answer: ans, ok: !why, why, side, applied };
  }
  /* 출시 차단 (2단계): 모든 카드가 ok여야 함 */
  function blocks(t, lk, trOf) { return listOf(t).map(c => ({ c, s: cardState(t, lk, c, trOf) })).filter(o => !o.s.ok).map(o => ({ id: o.c.id, tag: o.c.tag, why: o.s.why })); }
  /* 카드 줄 번호 → 카드 */
  function cardOfRow(t, id) { return listOf(t).find(c => c.q === id || (c.opts || []).includes(id)) || null; }

  return { TAGS, NEED_REPL, tagOf, answerOf, posOf, resolveRow, parse, listOf, rowIds, broken, replCheck, releaseBlocks, stats, normKo,
    REPL_ALLOW, TR_AIS, routeOf, ROUTE_LABEL, hashOf, perOf, parseTr, candCheck, solveId, solveVerdict, cardState, blocks, cardOfRow };
});
