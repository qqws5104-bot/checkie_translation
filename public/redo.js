/* 재설계 묶음 (v31): 재설계안의 ‘함께 바꿀 것’에 적힌 줄을 한 묶음으로 보고
   ① 묶음 안 한 줄만 재설계안에서 바뀌고 나머지는 그대로면 불일치
   ② 함께 바꿀 줄에 재설계 기록이 없으면 누락
   ③ 기획이 지금 번역 기준으로 묶음을 승인해야 그 줄들을 사람 승인할 수 있음 (화면·서버 공용)
   entries: [{ id, tr, redo: { also, trh, ... } | null, ok: { k, why } | null }], hash: 문자열 → 지문 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Redo = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const ID_RE = /\b[A-Z]{1,3}\d{2,}(?:-\d+)?\b/g;
  function alsoIds(v, known) { return [...new Set((String((v && v.also) || '').toUpperCase().match(ID_RE) || []).filter(id => known.has(id)))]; }
  function groups(entries, hash) {
    const by = new Map(entries.map(e => [e.id, e])), known = new Set(by.keys()), parent = new Map();
    const find = x => { while (parent.get(x) !== x) x = parent.get(x); return x; }, union = (a, b) => { parent.set(find(a), find(b)); };
    entries.filter(e => e.redo).forEach(e => { if (!parent.has(e.id)) parent.set(e.id, e.id); alsoIds(e.redo, known).forEach(o => { if (!parent.has(o)) parent.set(o, o); union(e.id, o); }); });
    const G = new Map(); [...parent.keys()].forEach(id => { const r = find(id); (G.get(r) || G.set(r, []).get(r)).push(id); });
    return [...G.values()].map(ids => {
      ids.sort();
      const mem = ids.map(id => by.get(id));
      const missing = mem.filter(e => !e.redo).map(e => e.id);
      const moved = mem.filter(e => e.redo && e.redo.trh && hash(e.tr || '') !== e.redo.trh).map(e => e.id);
      const kept = mem.filter(e => e.redo && e.redo.trh && hash(e.tr || '') === e.redo.trh).map(e => e.id);
      const k = hash(ids.map(id => id + '\u0002' + (by.get(id).tr || '')).join('\u0001'));
      const problem = missing.length ? `함께 바꿀 ${missing.join('·')}에 재설계 기록이 없음` : moved.length && kept.length ? `${moved.join('·')}만 재설계안에서 바뀜, ${kept.join('·')}: 재설계안 그대로 — 묶음을 같이 고치거나 원래 재설계안으로` : '';
      const okBy = mem.every(e => e.ok && e.ok.k === k && e.ok.why) ? mem[0].ok : null;
      return { ids, k, missing, moved, kept, problem, ok: !problem && !!okBy, okBy, single: ids.length === 1 };
    });
  }
  return { alsoIds, groups };
});
