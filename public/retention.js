/*
 * retention.js — 자료 보관 규칙 (브라우저·서버 공용)
 *  - 번역할 언어(불가능 표시 안 한 언어)가 전부 ‘적용 완료’가 되면 그때부터 30일 보관
 *  - 삭제 7일 전부터 로그인할 때마다 알림
 *  - 기한이 지나면 게임 정보만 남기고 엑셀·이미지·검수 기록을 모두 지움
 *  - 알림 없이 지워지는 일이 없도록 삭제일은 ‘처음 완료를 확인한 날 + 7일’보다 앞당기지 않음
 */
(function (root) {
  const LANG_KEYS = ['en', 'ja', 'zh'];
  const DAY = 864e5, KEEP_DAYS = 30, WARN_DAYS = 7;
  /* 정리 후에도 남기는 칸 = 게임 정보 + 진행 표시 */
  const KEEP = ['name', 'concept', 'situation', 'honorific', 'speakers', 'lang', 'langOff', 'memo', 'progress', 'progressBy', 'createdAt', 'updatedAt'];
  const isOff = (t, lk) => !!((t && t.langOff) || {})[lk];
  const activeLangs = t => LANG_KEYS.filter(k => !isOff(t, k));
  /* 전체 완료 시각 (아니면 null) */
  function doneAt(t) {
    if (!t || t.purgedAt) return null;
    const act = activeLangs(t);
    if (!act.length) return null;
    if (!act.every(k => ((t.progress || {})[k] || 0) >= 5)) return null;
    const times = [
      ...act.map(k => (((t.progressBy || {})[k] || {})[5] || {}).at),
      ...LANG_KEYS.filter(k => isOff(t, k)).map(k => (t.langOff[k] || {}).at),
    ].filter(Boolean).map(x => Date.parse(x)).filter(x => !isNaN(x));
    return times.length ? Math.max(...times) : Date.parse(t.updatedAt) || Date.now();
  }
  /* 서버가 정할 삭제 예정일 */
  function planPurge(t, now) {
    const d = doneAt(t);
    if (d === null) return null;
    return Math.max(d + KEEP_DAYS * DAY, now + WARN_DAYS * DAY);
  }
  /* 알림 대상: 삭제 예정일이 7일 안 */
  function warnInfo(t, now) {
    if (!t || t.purgedAt || !t.purgeAt || doneAt(t) === null) return null;
    const at = Date.parse(t.purgeAt), left = at - now;
    if (left > WARN_DAYS * DAY) return null;
    return { at, days: Math.max(0, Math.ceil(left / DAY)) };
  }
  function stripped(t, now) {
    const out = {};
    KEEP.forEach(k => { if (t[k] !== undefined) out[k] = JSON.parse(JSON.stringify(t[k])); });
    out.purgedAt = new Date(now).toISOString();
    return out;
  }
  const api = { LANG_KEYS, KEEP_DAYS, WARN_DAYS, isOff, activeLangs, doneAt, planPurge, warnInfo, stripped };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.Retention = api;
})(typeof self !== 'undefined' ? self : this);
