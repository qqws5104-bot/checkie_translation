/*
 * puzzle.js — 퍼즐 구조 검사기 (브라우저와 서버가 같이 씀, 순수 함수만)
 *
 * 퍼즐 구조(pzSpec)는 사람이 엑셀 한 칸에 쓰는 간단한 문법: ‘키=값 | 키=값’
 *   blank_pair  문장=Migratory birds want to fly where there are no clouds. | 1P=R065 | 2P=R068
 *   crossword   가로1=WEST@(4,1)→4 | 세로1=VASE@(1,2)↓4 | 단서=R073,R074
 *               (답@(행,열)  방향 →·↓ 뒤의 숫자는 칸 수. 칸 수를 안 쓰면 답 길이를 칸 수로 봄)
 *   spot_diff   차이=2 | 쌍=R041:R048, R043:R050 | 이미지차이=0
 *   mapping     카드=R017,R018 | 키=월 | 정답=JAN→SEED, SEP→DATE | 그리드=JAN:SEED, FEB:RAIN, SEP:DATE
 *   grid_clue   그리드=버섯,나무,_ / 집,_,꽃 | 조건=옆:버섯 ; 아래:나무 | 단서=R005,R006 | 정답=(1,3)
 *               (조건: 옆:X · 위:X(답이 X 위) · 아래:X(답이 X 아래) · 사이:X,Y)
 *
 * check(type, spec, tr, lk) → { v: 'PASS' | 'FAIL', msgs: [], rows: [줄 번호] }
 *   tr: 줄 번호 → 지금 번역문
 */
(function (root) {
  'use strict';
  const TYPES = ['blank_pair', 'crossword', 'spot_diff', 'mapping', 'grid_clue', 'none'];
  const TYPE_LABEL = { blank_pair: '상보 빈칸', crossword: '십자말', spot_diff: '틀린 그림', mapping: '매칭', grid_clue: '위치 단서', none: '없음' };
  const KEY_OF = { blank_pair: 'pzBlank', crossword: 'pzCross', spot_diff: 'pzDiff', mapping: 'pzMap', grid_clue: 'pzGrid' };
  const HANGUL = /[가-힣ㄱ-ㆎ]/;
  const typeOf = v => { const s = String(v || '').trim().toLowerCase(); if (TYPES.includes(s)) return s; const k = Object.keys(TYPE_LABEL).find(t => TYPE_LABEL[t].replace(/\s/g, '') === s.replace(/\s/g, '')); return k || (/빈칸/.test(s) ? 'blank_pair' : /십자|크로스/.test(s) ? 'crossword' : /틀린|차이/.test(s) ? 'spot_diff' : /매칭|짝/.test(s) ? 'mapping' : /위치|그리드/.test(s) ? 'grid_clue' : ''); };
  const ids = v => String(v || '').split(/[,，、\s]+/).map(x => x.trim()).filter(Boolean);

  /* ‘키=값 | 키=값’ → { 키: 값 } (키는 공백 없이) */
  function kv(raw) {
    const out = {};
    String(raw || '').split(/\s\|\s|\n/).forEach(part => { const i = part.indexOf('='); if (i < 0) return; const k = part.slice(0, i).replace(/\s/g, '').toLowerCase(), v = part.slice(i + 1).trim(); if (k) out[k] = v; });
    return out;
  }
  const pick = (o, ...ks) => { for (const k of ks) if (o[k] != null) return o[k]; return ''; };

  /* ---------- 상보 빈칸 ---------- */
  const BLANK = /\(\s*\)|（\s*）|_{2,}/;
  function tokens(s) {
    const out = [], re = /\(\s*\)|（\s*）|_{2,}|[A-Za-z0-9À-ÿ'’-]+|[^\s()（）A-Za-z0-9.,!?;:。、，！？「」『』"“”…·~-]/g;
    let m; while ((m = re.exec(String(s || '')))) out.push(BLANK.test(m[0]) && m[0].replace(BLANK, '') === '' ? { b: true } : { w: m[0] });
    return out;
  }
  const normSent = s => String(s || '').toLowerCase().replace(/[’]/g, "'").replace(/[^\p{L}\p{N}']+/gu, ' ').trim();
  function fillInto(a, b) {   /* a의 빈칸에 b에 보이는 단어를 순서대로 */
    const ta = tokens(a), words = tokens(b).filter(x => x.w).map(x => x.w), blanks = ta.filter(x => x.b).length;
    if (blanks !== words.length) return { err: `빈칸 ${blanks}개인데 상대편에 보이는 단어는 ${words.length}개` };
    let i = 0; return { text: ta.map(x => x.b ? words[i++] : x.w).join(' ') };
  }
  function checkBlankPair(t1, t2, sentence) {
    const msgs = [];
    if (!String(sentence || '').trim()) return { v: 'FAIL', msgs: ['완성 문장(문장=)이 없음'] };
    if (!BLANK.test(t1) || !BLANK.test(t2)) msgs.push(`빈칸 ( )이 ${!BLANK.test(t1) && !BLANK.test(t2) ? '1P·2P 모두' : !BLANK.test(t1) ? '1P에' : '2P에'} 없음`);
    const want = normSent(sentence);
    [['1P', t1, t2], ['2P', t2, t1]].forEach(([nm, a, b]) => {
      if (!BLANK.test(a)) return;
      const f = fillInto(a, b);
      if (f.err) msgs.push(`${nm}: ${f.err}`);
      else if (normSent(f.text) !== want) msgs.push(`${nm} 빈칸을 채우면 ‘${f.text}’ — 완성 문장과 다름`);
    });
    return { v: msgs.length ? 'FAIL' : 'PASS', msgs };
  }

  /* ---------- 십자말 ---------- */
  function parseCross(o) {
    const entries = [], errs = [];
    Object.entries(o).forEach(([k, v]) => {
      const m = k.match(/^(가로|세로|across|down)(\d+)$/i); if (!m) return;
      const e = String(v).match(/^\s*(.+?)\s*@\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)\s*([→↓]?)\s*(\d+)?\s*$/);
      if (!e) { errs.push(`${k} 형식: 답@(행,열)→칸수`); return; }
      const down = /세로|down/i.test(m[1]) || e[4] === '↓';
      entries.push({ name: `${/세로|down/i.test(m[1]) ? '세로' : '가로'} ${m[2]}`, ans: e[1].replace(/\s/g, ''), r: +e[2], c: +e[3], down, len: e[5] ? +e[5] : null });
    });
    return { entries, errs };
  }
  function checkCrossword(spec, clues, lk) {
    const o = typeof spec === 'string' ? kv(spec) : spec, { entries, errs } = parseCross(o), msgs = errs.slice();
    if (!entries.length) msgs.push('답(가로1=…, 세로1=…)이 없음');
    const cells = new Map();
    entries.forEach(e => {
      const chars = [...e.ans.toUpperCase()];
      if (lk && lk !== 'ko' && HANGUL.test(e.ans)) msgs.push(`${e.name} 답 ‘${e.ans}’이 한국어 — 이 언어의 답이 필요`);
      if (e.len != null && e.len !== chars.length) msgs.push(`${e.name} 답 ‘${e.ans}’은 ${chars.length}글자인데 칸은 ${e.len}칸`);
      chars.forEach((ch, i) => { const key = e.down ? `${e.r + i},${e.c}` : `${e.r},${e.c + i}`, prev = cells.get(key);
        if (prev && prev.ch !== ch) msgs.push(`겹치는 칸 (${key})이 ${prev.name}에서는 ‘${prev.ch}’, ${e.name}에서는 ‘${ch}’`); else if (!prev) cells.set(key, { ch, name: e.name }); });
    });
    const cl = (clues || []);
    if (cl.length < entries.length) msgs.push(`단서 ${cl.length}개 < 답 ${entries.length}개`);
    cl.forEach(c => { if (!String(c.text || '').trim()) msgs.push(`단서 ${c.id} 번역이 비어 있음`);
      entries.forEach(e => { if (e.ans.length > 2 && new RegExp(`(^|[^\\p{L}])${e.ans.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'iu').test(String(c.text || ''))) msgs.push(`단서 ${c.id}에 답 ‘${e.ans}’이 그대로 보임`); }); });
    return { v: msgs.length ? 'FAIL' : 'PASS', msgs };
  }

  /* ---------- 틀린 그림 ---------- */
  function checkSpotDiff(pairs, n, imgDiff) {
    const want = Number(n) - (Number(imgDiff) || 0), diff = pairs.filter(([a, b]) => String(a || '').trim() !== String(b || '').trim());
    if (!Number.isFinite(want)) return { v: 'FAIL', msgs: ['차이 개수(차이=)가 없음'] };
    return diff.length === want ? { v: 'PASS', msgs: [] } : { v: 'FAIL', msgs: [`1P/2P 글자가 다른 쌍이 ${diff.length}개 — 글자 차이는 ${want}개여야 함${diff.length ? ` (다른 쌍: ${diff.map(([a, b]) => `‘${String(a).slice(0, 20)}’/‘${String(b).slice(0, 20)}’`).join(', ')})` : ''}`] };
  }

  /* ---------- 매칭 ---------- */
  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  function keysIn(text, key) {
    const s = String(text || ''), out = new Set();
    if (/월|month/i.test(key)) {
      (s.match(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEPT?|OCT|NOV|DEC)[A-Za-z]*\b/gi) || []).forEach(m => { const k = m.slice(0, 3).toUpperCase(); if (MONTHS.includes(k) && (m.length === 3 || m.toUpperCase().startsWith(k))) out.add(k); });
      (s.match(/(\d{1,2})\s*月/g) || []).forEach(m => out.add(MONTHS[+m.match(/\d+/)[0] - 1] || m));
    } else if (/년|year/i.test(key)) (s.match(/\b(19|20)\d{2}\b/g) || []).forEach(m => out.add(m));
    else if (/일|day/i.test(key)) (s.match(/\b\d{1,2}\b/g) || []).forEach(m => out.add(String(+m)));
    else (s.match(new RegExp(key, 'gi')) || []).forEach(m => out.add(m.toUpperCase()));
    return [...out];
  }
  const normKey = k => { const u = String(k || '').trim().toUpperCase(), mm = u.match(/^(\d{1,2})\s*月$/); if (mm) return MONTHS[+mm[1] - 1] || u; return MONTHS.includes(u.slice(0, 3)) && /^[A-Z]+$/.test(u) ? u.slice(0, 3) : u; };
  function checkMapping(spec, rows) {
    const o = typeof spec === 'string' ? kv(spec) : spec, msgs = [], key = pick(o, '키', 'key') || '월';
    const ans = String(pick(o, '정답', 'answer')).split(/[,，]/).map(x => x.split(/→|->|=>/).map(y => y.trim())).filter(x => x[0]);
    const grid = String(pick(o, '그리드', 'grid')).split(/[,，]/).map(x => x.split(':').map(y => y.trim())).filter(x => x[0] && x[1] != null);
    if (!rows.length) msgs.push('카드(카드=)가 없음');
    if (ans.length && ans.length !== rows.length) msgs.push(`카드 ${rows.length}장인데 정답은 ${ans.length}개`);
    rows.forEach((r, i) => {
      const ks = keysIn(r.text, key);
      if (!ks.length) { msgs.push(`카드 ${r.id}에서 ‘${key}’을 뽑을 수 없음 (‘${String(r.text || '').replace(/\n/g, ' ').slice(0, 30)}’)`); return; }
      if (ks.length > 1) { msgs.push(`카드 ${r.id}에서 ‘${key}’이 여러 개 (${ks.join(', ')})`); return; }
      const a = ans[i]; if (a && normKey(a[0]) !== ks[0]) msgs.push(`카드 ${r.id}의 ${key}은 ${ks[0]}인데 정답 기준은 ${a[0]}`);
      if (grid.length) { const hit = grid.filter(g => normKey(g[0]) === ks[0]);
        if (hit.length !== 1) msgs.push(`그리드에서 ${ks[0]}에 해당하는 칸이 ${hit.length}개 (정확히 1개여야 함)`);
        else if (a && a[1] && hit[0][1].toUpperCase() !== a[1].toUpperCase()) msgs.push(`그리드에서 ${ks[0]}은 ${hit[0][1]}인데 정답은 ${a[1]}`); }
    });
    return { v: msgs.length ? 'FAIL' : 'PASS', msgs };
  }

  /* ---------- 위치 단서 ---------- */
  function parseGrid(s) { return String(s || '').split('/').map(row => row.split(/[,，]/).map(c => c.trim())); }
  function checkGridClue(spec, clueText) {
    const o = typeof spec === 'string' ? kv(spec) : spec, msgs = [], G = parseGrid(pick(o, '그리드', 'grid')), conds = String(pick(o, '조건', 'cond')).split(/;|；/).map(x => x.trim()).filter(Boolean);
    const want = String(pick(o, '정답', 'answer')).match(/\(\s*(\d+)\s*,\s*(\d+)\s*\)/);
    if (!G.length || !G[0].length || !G[0][0] && G.length < 2) msgs.push('그리드가 없음');
    if (!conds.length) msgs.push('조건이 없음');
    const at = name => { const L = []; G.forEach((row, r) => row.forEach((c, k) => { if (c && c.toLowerCase() === name.toLowerCase()) L.push([r, k]); })); return L; };
    const names = new Set(), cand = [];
    G.forEach((row, r) => row.forEach((c, k) => {
      const ok = conds.every(cd => { const [t, v] = cd.split(/[:：]/).map(x => (x || '').trim()); const [x, y] = String(v || '').split(/[,，]/).map(z => z.trim()); [x, y].filter(Boolean).forEach(n => names.add(n));
        const X = at(x || ''), Y = y ? at(y) : [];
        if (/옆|next/.test(t)) return X.some(([a, b]) => a === r && Math.abs(b - k) === 1);
        if (/위|above/.test(t)) return X.some(([a, b]) => b === k && a === r + 1);
        if (/아래|below/.test(t)) return X.some(([a, b]) => b === k && a === r - 1);
        if (/사이|between/.test(t)) return X.some(([a, b]) => Y.some(([p, q]) => (a === r && p === r && Math.abs(b - q) === 2 && (b + q) / 2 === k) || (b === k && q === k && Math.abs(a - p) === 2 && (a + p) / 2 === r)));
        return false; });
      if (ok) cand.push([r + 1, k + 1]);
    }));
    if (conds.length) {
      if (cand.length !== 1) msgs.push(`조건에 맞는 칸이 ${cand.length}개 — 정확히 1개여야 함${cand.length ? ` (${cand.map(c => `(${c})`).join(' ')})` : ''}`);
      else if (want && (cand[0][0] !== +want[1] || cand[0][1] !== +want[2])) msgs.push(`조건에 맞는 칸은 (${cand[0]})인데 정답 기준은 (${want[1]},${want[2]})`);
    }
    const txt = String(clueText || '').toLowerCase();
    names.forEach(n => { if (n && !txt.includes(n.toLowerCase())) msgs.push(`단서 번역에 ‘${n}’이 없음`); });
    return { v: msgs.length ? 'FAIL' : 'PASS', msgs };
  }

  /* ---------- 한 퍼즐 검사 ---------- */
  function rowsOf(type, spec) {
    const o = typeof spec === 'string' ? kv(spec) : spec || {};
    if (type === 'blank_pair') return [...ids(pick(o, '1p')), ...ids(pick(o, '2p'))];
    if (type === 'crossword' || type === 'grid_clue') return ids(pick(o, '단서', 'clues'));
    if (type === 'spot_diff') return String(pick(o, '쌍', 'pairs')).split(/[,，]/).flatMap(p => p.split(':').map(x => x.trim())).filter(Boolean);
    if (type === 'mapping') return ids(pick(o, '카드', 'cards'));
    return [];
  }
  function check(type, spec, tr, lk) {
    const o = typeof spec === 'string' ? kv(spec) : spec || {}, T = id => tr[id] == null ? null : String(tr[id]);
    const rows = rowsOf(type, o), miss = rows.filter(id => T(id) == null);
    if (!TYPES.includes(type) || type === 'none') return { v: 'NONE', msgs: [], rows };
    if (!rows.length) return { v: 'FAIL', msgs: ['퍼즐 구조에 줄 번호가 없음'], rows };
    if (miss.length) return { v: 'FAIL', msgs: [`퍼즐 구조의 줄 번호를 찾지 못함: ${miss.join(', ')}`], rows };
    let r;
    if (type === 'blank_pair') {
      const s = pick(o, '문장', 'sentence'), p1 = ids(pick(o, '1p')).map(T).join(' '), p2 = ids(pick(o, '2p')).map(T).join(' ');
      r = checkBlankPair(p1, p2, s);
      if (lk && lk !== 'ko' && HANGUL.test(s)) r = { v: 'FAIL', msgs: ['완성 문장이 한국어 — 이 언어 기준 퍼즐 구조가 필요', ...r.msgs] };
    } else if (type === 'crossword') r = checkCrossword(o, rows.map(id => ({ id, text: T(id) })), lk);
    else if (type === 'spot_diff') r = checkSpotDiff(String(pick(o, '쌍', 'pairs')).split(/[,，]/).map(p => p.split(':').map(x => T(x.trim()))).filter(p => p.length === 2), pick(o, '차이', 'n'), pick(o, '이미지차이', 'imgdiff'));
    else if (type === 'mapping') r = checkMapping(o, rows.map(id => ({ id, text: T(id) })));
    else if (type === 'grid_clue') r = checkGridClue(o, rows.map(T).join('\n'));
    return Object.assign({ rows }, r);
  }

  /* ---------- 어느 구조를 쓸지: 사람이 확정한 언어별 > 번역 AI 초안(언어별) > 원문 정답 기준 ---------- */
  function draftsOf(extra) {
    const sh = (extra || []).find(e => /퍼즐\s*구조/.test(e.name || '')); if (!sh || !sh.rows || sh.rows.length < 2) return {};
    const h = sh.rows[0].map(x => String(x || '').replace(/\s/g, '')), iId = Math.max(0, h.findIndex(x => /퍼즐id|^퍼즐$|^id$/i.test(x))), iT = h.findIndex(x => /유형/.test(x)), iS = h.findIndex(x => /구조/.test(x));
    const out = {}; sh.rows.slice(1).forEach(r => { const id = String(r[iId] || '').trim(); if (id && iS >= 0 && String(r[iS] || '').trim()) out[id] = { type: typeOf(r[iT]), spec: String(r[iS]).trim(), src: 'AI 초안' }; });
    return out;
  }
  function effective(answers, wpz, extra) {
    const out = {}, dr = draftsOf(extra);
    (answers || []).forEach(a => { const ty = typeOf(a.pzType); if (ty && ty !== 'none' && String(a.pzSpec || '').trim()) out[a.id] = { pid: a.id, type: ty, spec: String(a.pzSpec), src: '원문 기준', name: a.q || '' }; else if (ty && ty !== 'none') out[a.id] = { pid: a.id, type: ty, spec: '', src: '구조 없음', name: a.q || '' }; });
    Object.entries(dr).forEach(([id, d]) => { if (d.type) out[id] = Object.assign({ pid: id, name: (out[id] || {}).name || '' }, d); });
    Object.entries(wpz || {}).forEach(([id, d]) => { if (d && d.spec != null && typeOf(d.type)) out[id] = { pid: id, type: typeOf(d.type), spec: String(d.spec), src: '사람 확정', name: (out[id] || {}).name || d.name || '', by: d.by, at: d.at }; });
    return out;
  }
  /* 지문: 퍼즐에 속한 줄 번역이 바뀌면 확인이 무효가 되게 */
  function hashOf(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h.toString(36); }
  function run(answers, wpz, extra, tr, lk) {
    const E = effective(answers, wpz, extra), list = [];
    Object.values(E).forEach(p => {
      const res = p.spec ? check(p.type, p.spec, tr, lk) : { v: 'NONE', msgs: ['퍼즐 구조가 없음 — 프로그램 검사 없음'], rows: [] };
      list.push(Object.assign({}, p, res, { key: KEY_OF[p.type], h: hashOf(p.spec + '\u0001' + res.rows.map(id => `${id}=${tr[id] || ''}`).join('\u0001')) }));
    });
    return list;
  }
  /* AI 퍼즐 검수 표의 ‘퍼즐’ 이름이 어느 퍼즐인지: 이름에 퍼즐 ID가 있거나, 관련 번호가 겹침 */
  function matchPuzzle(name, related, list) {
    const n = String(name || '').toUpperCase().replace(/\s/g, ''), rel = new Set(ids(related).map(x => x.toUpperCase()));
    const byName = list.find(p => p.pid && n.includes(String(p.pid).toUpperCase().replace(/\s/g, '')));
    if (byName) return byName;
    return list.find(p => (p.rows || []).some(id => rel.has(String(id).toUpperCase()))) || null;
  }

  /* ---------- 텍스트만으로 풀어 본 답과 정답 비교 ---------- */
  function expected(type, spec) {
    const o = typeof spec === 'string' ? kv(spec) : spec || {};
    if (type === 'blank_pair') return [pick(o, '문장', 'sentence')];
    if (type === 'crossword') return parseCross(o).entries.map(e => e.ans);
    if (type === 'mapping') return String(pick(o, '정답', 'answer')).split(/[,，]/).map(x => (x.split(/→|->|=>/)[1] || '').trim()).filter(Boolean);
    if (type === 'grid_clue') { const m = String(pick(o, '정답', 'answer')).match(/\(\s*\d+\s*,\s*\d+\s*\)/); return m ? [m[0]] : []; }
    if (type === 'spot_diff') return [String(Number(pick(o, '차이', 'n')) - (Number(pick(o, '이미지차이', 'imgdiff')) || 0))];
    return [];
  }
  function solveMatch(type, spec, answer) {
    const exp = expected(type, spec), a = normSent(answer).replace(/\s/g, '');
    if (!exp.length || !String(answer || '').trim()) return null;
    if (type === 'spot_diff') { const n = String(answer).split(/[;\n]|\s\/\s/).map(x => x.trim()).filter(Boolean).length, m = String(answer).match(/^\s*(\d+)\s*$/); return (m ? +m[1] : n) === +exp[0]; }
    return exp.every(e => a.includes(normSent(e).replace(/\s/g, '')));
  }

  const api = { TYPES, TYPE_LABEL, KEY_OF, typeOf, kv, tokens, checkBlankPair, checkCrossword, checkSpotDiff, checkMapping, checkGridClue, check, rowsOf, effective, draftsOf, run, matchPuzzle, expected, solveMatch, hashOf, normSent };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.Puzzle = api;
})(typeof self !== 'undefined' ? self : this);
