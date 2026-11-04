/*
 * merge.js — 여러 사람이 같은 게임을 동시에 고쳐도 서로 지우지 않게 하는 병합 규칙.
 * 브라우저(store.js)와 서버(server.js)가 같은 코드를 쓴다.
 *
 * diff(전, 후)  → 바뀐 부분만 담은 delta
 * apply(최신본, delta) → 최신본 위에 내 변경만 얹은 결과
 *
 * 규칙
 *  - 객체: 키 단위로 합침 (내가 안 건드린 키는 남이 바꾼 값 유지)
 *  - 배열 원소가 전부 id 있는 객체(메모 등): id 단위로 추가·수정·삭제
 *  - 뒤에 덧붙이기만 한 배열(기록·확인자 목록 등): 덧붙인 것만 추가
 *  - 그 밖의 배열·값: 통째로 교체
 *  - 같은 칸을 두 사람이 고치면(내가 보던 값과 서버 값이 다르면) 먼저 저장된 값을 지키고 충돌로 알린다
 */
(function (root) {
  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  function eq(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => eq(x, b[i]));
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every(k => Object.prototype.hasOwnProperty.call(b, k) && eq(a[k], b[k]));
  }
  /* 값 지문: 키 순서와 무관하게 같은 값이면 같은 문자열 */
  function stable(v) {
    if (v === undefined) return 'u';
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  }
  function hash(v) {
    const s = stable(v); let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619) >>> 0; h2 = Math.imul(h2 + c, 2246822519) >>> 0; }
    return h1.toString(36) + h2.toString(36) + s.length.toString(36);
  }
  const idArr = arr => arr.every(x => isObj(x) && typeof x.id === 'string' && x.id);

  function diff(a, b) {
    if (eq(a, b)) return undefined;
    if (isObj(a) && isObj(b)) {
      const o = {};
      Object.keys(b).forEach(k => { const d = diff(a[k], b[k]); if (d !== undefined) o[k] = d; });
      Object.keys(a).forEach(k => { if (!(k in b)) o[k] = { $unset: 1, $h: hash(a[k]) }; });
      return { $o: o };
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      if ((a.length || b.length) && idArr(a) && idArr(b)) {
        const ids = {}, am = new Map(a.map(x => [x.id, x])), bm = new Map(b.map(x => [x.id, x]));
        b.forEach(x => { if (!am.has(x.id)) ids[x.id] = { $new: clone(x) }; else { const d = diff(am.get(x.id), x); if (d) ids[x.id] = d; } });
        a.forEach(x => { if (!bm.has(x.id)) ids[x.id] = { $del: 1, $h: hash(x) }; });
        return { $ids: ids };
      }
      if (b.length > a.length && a.every((x, i) => eq(x, b[i]))) return { $push: clone(b.slice(a.length)) };
    }
    return { $set: clone(b), $h: hash(a) };
  }

  /* conflicts가 배열이면 충돌을 검사한다(서버). 충돌한 칸은 서버 값을 그대로 둔다. */
  const IGNORE = /(^|\.)updatedAt$/;
  /* 줄(번역 항목)은 한 덩어리로: 한 칸이라도 충돌하면 그 줄의 내 변경 전체를 반영하지 않음
     (번역문은 충돌로 안 바뀌었는데 수정 이력만 붙는 식의 반쪽 반영을 막음) */
  const ATOMIC = /^work\.[a-z]+\.items\.[^.]+$/;
  function clash(cur, op, path, conflicts) {
    if (!conflicts || !op || op.$h === undefined || IGNORE.test(path)) return false;
    if (hash(cur) === op.$h) return false;
    if ('$set' in op && hash(cur) === hash(op.$set)) return false;   // 이미 같은 값
    conflicts.push(path); return true;
  }
  function apply(cur, d, conflicts, path) {
    path = path || '';
    if (!d) return cur;
    if ('$set' in d) return clash(cur, d, path, conflicts) ? cur : clone(d.$set);
    if (d.$o) {
      const out = isObj(cur) ? cur : {};
      Object.keys(d.$o).forEach(k => {
        const op = d.$o[k], p = path ? path + '.' + k : k;
        if (op && op.$unset) { if (!clash(out[k], op, p, conflicts)) delete out[k]; }
        else if (conflicts && ATOMIC.test(p)) { const n0 = conflicts.length, tmp = apply(clone(out[k]), op, conflicts, p); if (conflicts.length === n0) out[k] = tmp; }
        else out[k] = apply(out[k], op, conflicts, p);
      });
      return out;
    }
    if (d.$push) {
      const out = Array.isArray(cur) ? cur : [];
      d.$push.forEach(x => { if (!out.some(y => eq(x, y))) out.push(clone(x)); });
      return out;
    }
    if (d.$ids) {
      let out = Array.isArray(cur) ? cur : [];
      Object.keys(d.$ids).forEach(id => {
        const op = d.$ids[id], i = out.findIndex(x => isObj(x) && x.id === id);
        const p = path + '[' + id + ']';
        if (op.$del) { if (i >= 0 && !clash(out[i], op, p, conflicts)) out.splice(i, 1); }
        else if (op.$new) { if (i < 0) out.push(clone(op.$new)); else if (!eq(out[i], op.$new) && conflicts) conflicts.push(p); else out[i] = clone(op.$new); }
        else if (i >= 0) out[i] = apply(out[i], op, conflicts, p);
      });
      return out;
    }
    return cur;
  }

  /* 번역문 지문: 승인·검수가 ‘어느 번역문에 대한 것인지’ 묶는 데 씀 (공백 차이는 무시) */
  const trHash = s => hash(String(s == null ? '' : s).normalize('NFKC').replace(/\s+/g, ''));
  const api = { diff, apply, eq, clone, hash, trHash };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.Merge = api;
})(typeof self !== 'undefined' ? self : this);
