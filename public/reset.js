/* 게임 번역 기록 전체 리셋 (관리자). 화면 미리보기와 서버 실행이 같은 규칙을 쓴다.
   지움: 고른 언어의 번역·검수·승인·수정 이력·사람 번역 비교·퍼즐 확인·진행 단계·올린 번역 엑셀
   남김: 원문 분석·게임 이해·게임 정보·용어집·금지 짝·리셋 기록(누가 언제 무엇을) */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Reset = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const LANGS = ['en', 'ja', 'zh'];
  const SHORT = { en: 'EN', ja: 'JA', zh: 'ZH' };

  /* 고른 언어가 올바른지: 1개 이상, 중복 없음, en·ja·zh만 */
  function cleanLangs(langs) {
    if (!Array.isArray(langs)) return null;
    const out = [...new Set(langs.map(String))];
    if (!out.length || out.some(lk => !LANGS.includes(lk))) return null;
    return LANGS.filter(lk => out.includes(lk));
  }
  /* 지울 파일: 그 언어로 올린 번역 엑셀(EN_… JA_… ZH_…xlsx)만. 원본(SRC_)·이미지·PDF는 남김 */
  function filesFor(names, langs) {
    return (names || []).filter(n => /\.xlsx$/i.test(n) && langs.some(lk => String(n).startsWith(SHORT[lk] + '_')));
  }
  /* 화면에 보여 줄 언어별 현황 */
  function summary(t, lk) {
    const w = ((t && t.work) || {})[lk] || {}, items = w.items || {};
    const ids = Object.keys(items).filter(id => !id.startsWith('@'));
    const sh = w.sheet || {};
    return {
      rows: Array.isArray(sh.ids) ? sh.ids.length : Array.isArray(sh.rows) ? sh.rows.length : 0,
      approved: ids.filter(id => items[id] && items[id].hv && items[id].hv.v === '승인').length,
      reviewed: ids.filter(id => items[id] && items[id].rv).length,
      edited: ids.filter(id => items[id] && Array.isArray(items[id].hist) && items[id].hist.length).length,
      human: ids.filter(id => items[id] && items[id].human).length,
      stage: Number(((t && t.progress) || {})[lk] || 0),
      empty: !Object.keys(w).filter(k => k !== 'resets').length && !Number(((t && t.progress) || {})[lk] || 0),
    };
  }
  /* 리셋한 게임 문서를 새로 만든다 (원본은 건드리지 않음) */
  function apply(t, langs, by, at, removedFiles) {
    const next = JSON.parse(JSON.stringify(t || {}));
    next.work = next.work || {};
    langs.forEach(lk => {
      const w = next.work[lk] || {};
      next.work[lk] = { resets: [...(w.resets || []), { by, at, full: true, files: filesFor(removedFiles, [lk]) }] };
      next.progress = Object.assign({}, next.progress, { [lk]: 0 });
      next.progressBy = Object.assign({}, next.progressBy, { [lk]: {} });
    });
    next.updatedAt = at;
    return next;
  }
  /* 되돌리기: 백업의 그 언어만 되돌림 (다른 언어·원문 분석·게임 정보는 지금 그대로) */
  function restoreLangs(cur, bak, langs) {
    const next = JSON.parse(JSON.stringify(cur || {})), b = bak || {};
    next.work = next.work || {};
    langs.forEach(lk => {
      const bw = (b.work || {})[lk], nowResets = ((next.work[lk] || {}).resets) || [];
      next.work[lk] = bw ? JSON.parse(JSON.stringify(bw)) : {};
      /* 리셋 기록은 지우지 않고 ‘되돌림’을 덧붙임 */
      const seen = new Set((next.work[lk].resets || []).map(r => r.at + '|' + r.by));
      next.work[lk].resets = [...(next.work[lk].resets || []), ...nowResets.filter(r => !seen.has(r.at + '|' + r.by))];
      next.progress = Object.assign({}, next.progress, { [lk]: ((b.progress || {})[lk]) || 0 });
      next.progressBy = Object.assign({}, next.progressBy, { [lk]: JSON.parse(JSON.stringify(((b.progressBy || {})[lk]) || {})) });
    });
    return next;
  }
  /* 되돌리면 사라지는 지금 작업 (언어별 건수) */
  function lossOf(cur, langs) {
    const out = {};
    langs.forEach(lk => { const m = summary(cur, lk), w = ((cur && cur.work) || {})[lk] || {}; const items = Object.keys(w.items || {}).filter(id => !id.startsWith('@')).length; out[lk] = { rows: m.rows, items, reviewed: m.reviewed, approved: m.approved, edited: m.edited, stage: m.stage, n: m.empty ? 0 : Math.max(m.rows, items) }; });
    return out;
  }

  /* ---- 언어 프로필: 사람 번역 비교 교훈 (게임과 상관없이 그 언어 프롬프트에 들어감) ---- */
  const LESSON_MAX = 400;
  const cut = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
  function cleanLesson(o) {
    if (!o || typeof o !== 'object') return null;
    const L = { k: cut(o.k, 200), g: cut(o.g, 80), id: cut(o.id, 20), ko: cut(o.ko, 200), ai: cut(o.ai, 300), hu: cut(o.hu, 300), why: cut(o.why, 80), note: cut(o.note, 300), err: cut(o.err, 80), at: cut(o.at, 30), movedAt: cut(o.movedAt, 30), movedBy: cut(o.movedBy, 40) };
    return L.k && L.why && L.hu ? L : null;
  }
  /* 교훈 합치기: 같은 키는 한 번만, 최근 것부터 최대 LESSON_MAX개 */
  function addLessons(prof, lk, list) {
    const P = JSON.parse(JSON.stringify(prof || {})), cur = (P[lk] && Array.isArray(P[lk].lessons)) ? P[lk].lessons : [];
    const keys = new Set(cur.map(x => x.k)), add = (list || []).map(cleanLesson).filter(x => x && !keys.has(x.k) && keys.add(x.k));
    P[lk] = Object.assign({}, P[lk], { lessons: [...cur, ...add].slice(-LESSON_MAX) });
    return { prof: P, added: add.length };
  }

  /* 게임 이름 확인: 앞뒤 공백·연속 공백만 무시하고 정확히 같아야 함 */
  const nameOk = (t, typed) => { const n = s => String(s || '').replace(/\s+/g, ' ').trim(); return !!n(t && t.name) && n(t && t.name) === n(typed); };

  return { LANGS, SHORT, cleanLangs, filesFor, summary, apply, nameOk, restoreLangs, lossOf, cleanLesson, addLessons, LESSON_MAX };
});
