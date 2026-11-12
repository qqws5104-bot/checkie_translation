/*
 * rules.js — 줄 단위 게임 규칙 검사 (브라우저와 서버가 같이 씀, 순수 함수만)
 *   조작 동사 고정 · 원문 판독 의심 쌍(음절·자모) · 퍼즐 안 공유 대상 일치 · 비슷한 원문끼리 번역 비교 · 금지 짝
 */
(function (root) {
  'use strict';
  const ROLES = ['정답 단서', '공유 정보', '조작 지시', '분위기'];
  const roleOf = v => { const s = String(v || '').replace(/\s/g, ''); return ROLES.find(r => s.includes(r.replace(/\s/g, ''))) || (/단서|정답/.test(s) ? '정답 단서' : /공유/.test(s) ? '공유 정보' : /조작|지시|행동/.test(s) ? '조작 지시' : /분위기|무관/.test(s) ? '분위기' : ''); };
  const roleRank = r => { const i = ROLES.indexOf(r); return i < 0 ? 4 : i; };
  const nk = s => String(s || '').replace(/\s|↵/g, '');
  function hash(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h.toString(36); }

  /* ---------- 한글 자모 ---------- */
  const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ', JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ', JONG = ' ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ';
  function jamo(ch) { const c = ch.codePointAt(0) - 0xAC00; if (c < 0 || c > 11171) return [ch]; return [CHO[Math.floor(c / 588)], JUNG[Math.floor((c % 588) / 28)], JONG[c % 28]]; }
  function lev(a, b) {
    const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
    return prev[n];
  }
  /* 원문이 거의 같은데 한두 음절만 다른 쌍: 공백 제외 6자 이상, 음절 편집 거리 1~2 */
  function nearPairs(rows, opts) {
    const o = Object.assign({ min: 6, max: 2 }, opts), L = rows.map(r => ({ r, s: [...nk(r.ko)] })).filter(x => x.s.length >= o.min), out = [];
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      const a = L[i], b = L[j]; if (Math.abs(a.s.length - b.s.length) > o.max || a.s.join('') === b.s.join('')) continue;
      const d = lev(a.s, b.s); if (d < 1 || d > o.max) continue;
      let jm = null;
      if (d === 1 && a.s.length === b.s.length) { const k = a.s.findIndex((c, x) => c !== b.s[x]), ja = jamo(a.s[k]), jb = jamo(b.s[k]), dif = ja.map((c, x) => c !== jb[x] ? `${c.trim() || '받침 없음'}↔${(jb[x] || '').trim() || '받침 없음'}` : null).filter(Boolean); if (ja.length === 3 && dif.length === 1) jm = `${a.s[k]}↔${b.s[k]} (${dif[0]})`; else jm = null; }
      out.push({ a: a.r.id, b: b.r.id, d, jamo: jm, key: hash([nk(a.r.ko), nk(b.r.ko)].sort().join('\u0001')) });
    }
    return out;
  }

  /* ---------- 조작 동사 ---------- */
  /* ‘en: place / ja: 置く / zh: 放’ → { en: ['place'], ja: ['置く'], zh: ['放'] } */
  function parseLangList(s) {
    const out = {}; String(s || '').split(/\s*\/\s*|\n/).forEach(part => { const m = part.match(/^\s*(en|ja|zh|영어|일본어|중국어)\s*[:：]\s*(.+)$/i); if (!m) return; const k = { 영어: 'en', 일본어: 'ja', 중국어: 'zh' }[m[1]] || m[1].toLowerCase(); out[k] = [...(out[k] || []), ...m[2].split(/[,，、;]/).map(x => x.trim()).filter(x => x && x !== '-')]; });
    return out;
  }
  function parseOp(row) {   /* { id, ko, forms, fix, avoid } */
    const forms = String(row.forms || '').split(/[·,，、/\s]+/).map(x => x.trim()).filter(Boolean), ko = String(row.ko || '').trim();
    if (ko && !forms.includes(ko.replace(/다$/, ''))) forms.push(ko.replace(/다$/, ''));
    return { id: String(row.id || '').trim(), ko, forms: [...new Set(forms)].filter(f => f.length >= 1), fix: parseLangList(row.fix), avoid: parseLangList(row.avoid) };
  }
  const IRR = { put: ['putting'], take: ['took', 'taken', 'taking'], give: ['gave', 'given'], find: ['found'], set: ['setting'], get: ['got', 'gotten', 'getting'], go: ['went', 'gone', 'goes'], hold: ['held'], leave: ['left'], bring: ['brought'], choose: ['chose', 'chosen'], hit: ['hitting'], drop: ['dropped', 'dropping'], tap: ['tapped', 'tapping'], stop: ['stopped', 'stopping'], run: ['ran', 'running'], swim: ['swam', 'swimming'], throw: ['threw', 'thrown'], draw: ['drew', 'drawn'], write: ['wrote', 'written'], spin: ['spun', 'spinning'] };
  function enForms(w) {
    w = w.toLowerCase(); const f = new Set([w, w + 's', w + 'es', w + 'ed', w + 'd', w + 'ing', ...(IRR[w] || [])]);
    if (/e$/.test(w)) f.add(w.slice(0, -1) + 'ing');
    if (/[^aeiou]y$/.test(w)) { f.add(w.slice(0, -1) + 'ies'); f.add(w.slice(0, -1) + 'ied'); }
    return [...f];
  }
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /* 번역문에 그 동사가 있는가 (영어는 어형 변화 허용, 여러 단어는 사이에 3단어까지) */
  function verbHit(lk, verb, text) {
    const v = String(verb || '').trim(), t = String(text || ''); if (!v) return false;
    if (lk === 'en') {
      const ws = v.toLowerCase().split(/\s+/), first = `(?:${enForms(ws[0]).map(esc).join('|')})`, rest = ws.slice(1).map(x => `(?:\\s+\\S+){0,3}?\\s+${esc(x)}`).join('');
      return new RegExp(`(^|[^A-Za-z])${first}${rest}($|[^A-Za-z])`, 'i').test(t);
    }
    if (lk === 'ja') { const stem = /[ぁ-ゖ]$/.test(v) && v.length > 1 ? v.slice(0, -1) : v; return t.includes(stem); }
    return t.includes(v);
  }
  /* 원문에 이 조작의 활용형이 있는가 */
  const opInKo = (op, ko) => op.forms.some(f => nk(ko).includes(nk(f)));
  function opVerbCheck(op, lk, tr) {
    const fix = (op.fix || {})[lk] || [], avoid = (op.avoid || {})[lk] || [];
    if (!fix.length && !avoid.length) return null;
    const miss = fix.length && !fix.some(v => verbHit(lk, v, tr)), bad = avoid.filter(v => verbHit(lk, v, tr));
    return miss || bad.length ? { miss: miss ? fix : [], bad } : { ok: true };
  }

  /* ---------- 퍼즐 안 공유 대상 ---------- */
  /* ‘사과나무=apple tree, 버섯=mushroom’ → { 사과나무: 'apple tree', 버섯: 'mushroom' } */
  function parseShare(s) { const out = {}; String(s || '').split(/[,，;\n]/).forEach(p => { const i = p.indexOf('='); if (i < 0) return; const k = p.slice(0, i).trim(), v = p.slice(i + 1).trim(); if (k && v && v !== '-') out[k] = v; }); return out; }
  const sing = w => String(w || '').toLowerCase().trim().split(/\s+/).map(x => x.replace(/ies$/, 'y').replace(/(ch|sh|x|ss)es$/, '$1').replace(/s$/, '')).join(' ');
  function hasWord(lk, word, text) {
    if (lk === 'en') { const ws = sing(word).split(' '); return new RegExp(`(^|[^A-Za-z])${ws.map(w => `${esc(w)}(?:s|es)?`).join('\\s+')}($|[^A-Za-z])`, 'i').test(String(text || '').replace(/ies\b/gi, 'y')) || new RegExp(`(^|[^A-Za-z])${esc(word)}($|[^A-Za-z])`, 'i').test(text); }
    return String(text || '').includes(word);
  }
  /* rows: [{ id, tr, share: {한국어 대상: 번역어} }] → Map(id → [메시지]) */
  function shareCheck(lk, rows, pid) {
    const by = {}, out = new Map(), add = (id, m) => out.set(id, [...(out.get(id) || []), m]);
    rows.forEach(r => Object.entries(r.share || {}).forEach(([k, v]) => { (by[k] = by[k] || []).push({ id: r.id, v, tr: r.tr }); }));
    Object.entries(by).forEach(([k, L]) => {
      const vs = [...new Set(L.map(x => lk === 'en' ? sing(x.v) : x.v))];
      if (vs.length > 1) L.forEach(x => add(x.id, `퍼즐 ${pid}의 공유 대상 ‘${k}’가 줄마다 다르게 번역됨 (${[...new Set(L.map(y => `${y.id} ${y.v}`))].join(' / ')}) — 1P·2P가 같은 말로 주고받아야 함`));
      L.forEach(x => { if (x.tr && !hasWord(lk, x.v, x.tr)) add(x.id, `공유 대상 ‘${k}’의 번역어 ‘${x.v}’가 번역문에 없음`); });
    });
    return out;
  }

  /* ---------- 비슷한 원문끼리 번역 비교 ---------- */
  const EN_SKIP = new Set(['please', 'kindly', 'now', 'then', 'just', 'and']);
  function leadVerb(tr) { const ws = String(tr || '').toLowerCase().match(/[a-z]+/g) || []; const w = ws.find(x => !EN_SKIP.has(x)); return w || ''; }
  const IMPER = /(주세요|세요|하라|해라|십시오|하자|해요)\s*[.!~?！]*\s*$/m;
  /* rows: [{ id, ko, tr, wmap: [{src,tgt}], op }] (sim: (a,b)→0~1) → Map(id → 메시지) */
  function nearIncons(lk, rows, sim, th) {
    const out = new Map(), add = (id, m) => { if (!out.has(id)) out.set(id, m); }, T = th || 0.8;
    for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i], b = rows[j]; if (nk(a.ko) === nk(b.ko) || !a.tr || !b.tr || (sim(a.ko, b.ko) || 0) < T) continue;
      const wa = new Map((a.wmap || []).map(e => [nk(e.src), String(e.tgt || '').replace(/[（(][^)）]*[)）]/g, '').trim().toLowerCase()])), diffs = [];
      (b.wmap || []).forEach(e => { const k = nk(e.src), x = wa.get(k), y = String(e.tgt || '').replace(/[（(][^)）]*[)）]/g, '').trim().toLowerCase(); if (x && y && x !== y) diffs.push(`${e.src}: ${a.id} ${x} / ${b.id} ${y}`); });
      if (!diffs.length && lk === 'en' && IMPER.test(a.ko) && IMPER.test(b.ko)) { const x = leadVerb(a.tr), y = leadVerb(b.tr); if (x && y && x !== y) diffs.push(`동사: ${a.id} ${x} / ${b.id} ${y}`); }
      if (diffs.length) { const m = `원문이 비슷한 줄과 핵심 단어가 다르게 번역됨 (${diffs.join(', ')}) — 같은 행동·대상이면 맞추기`; add(a.id, m); add(b.id, m); }
    }
    return out;
  }
  /* 원문 묶음에서 다른 줄과 다르게 번역된 쪽을 찾기 (셋 중 하나만 다르면 그 하나만) */
  function nearInconsGroup(lk, rows, sim, th) {
    const pair = nearIncons(lk, rows, sim, th); if (lk !== 'en') return pair;
    const out = new Map(), T = th || 0.8, done = new Set();
    rows.forEach(r => { if (done.has(r.id) || !IMPER.test(r.ko)) return; const g = rows.filter(o => o.tr && IMPER.test(o.ko) && (o.id === r.id || (sim(r.ko, o.ko) || 0) >= T)); if (g.length < 3) return; g.forEach(o => done.add(o.id));
      const cnt = {}; g.forEach(o => { const v = leadVerb(o.tr); cnt[v] = (cnt[v] || 0) + 1; }); const top = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0];
      if (top && top[1] > g.length / 2) g.filter(o => leadVerb(o.tr) !== top[0]).forEach(o => out.set(o.id, `비슷한 원문 ${g.length}줄 중 ${top[1]}줄은 ‘${top[0]}’인데 이 줄만 ‘${leadVerb(o.tr)}’ — 같은 행동이면 맞추기`)); });
    rows.forEach(r => { if (!done.has(r.id) && pair.has(r.id)) out.set(r.id, pair.get(r.id)); });
    return out;
  }

  /* ---------- 금지 짝 ---------- */
  /* 원문 표현의 활용형: 같은 동사의 조작 목록이 있으면 그 활용형, 아니면 ‘다’를 뗀 어간 */
  function banHit(lk, pairs, ko, tr, ops) {
    return (pairs || []).filter(p => { if (!p || !p.ko || !p.avoid) return false; const op = (ops || []).find(o => nk(o.ko) === nk(p.ko)), forms = op ? op.forms : [nk(p.ko).replace(/다$/, '')];
      return forms.some(f => f && nk(ko).includes(nk(f))) && verbHit(lk, p.avoid, tr); });
  }

  const api = { ROLES, roleOf, roleRank, jamo, lev, nearPairs, parseLangList, parseOp, enForms, verbHit, opInKo, opVerbCheck, parseShare, shareCheck, hasWord, leadVerb, IMPER, nearIncons, nearInconsGroup, banHit, hash };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.Rules = api;
})(typeof self !== 'undefined' ? self : this);
