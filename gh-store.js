/*
 * gh-store.js — GitHub 저장소의 data/*.json 파일을 팀 공용 저장소로 쓰는 작은 데이터 계층.
 *
 * - 읽기: 토큰이 없으면 사이트와 함께 배포된 data/*.json 을 읽고(보기 전용),
 *         토큰이 있으면 GitHub API로 최신 파일을 읽는다.
 * - 쓰기: 편집 로그인(GitHub 토큰)을 한 사람만 가능. 수정 사항을 모아 1.2초 뒤
 *         해당 JSON 파일에 커밋한다. 저장 직전에 최신 파일을 다시 받아
 *         내가 바꾼 항목만 덮어쓰므로, 서로 다른 항목을 동시에 고쳐도 사라지지 않는다.
 * - 페이지 코드는 window.claude.use('db' | 'user' | 'downloads') 형태로 이 계층을 쓴다.
 */
(function () {
  const cfg = Object.assign({ owner: '', repo: '', branch: 'main', dataDir: 'data' }, window.GH_CONFIG || {});
  // <계정>.github.io/<저장소>/ 에서는 주소로 자동 인식
  if (!cfg.owner && /\.github\.io$/.test(location.hostname)) cfg.owner = location.hostname.split('.')[0];
  if (!cfg.repo && /\.github\.io$/.test(location.hostname)) cfg.repo = location.pathname.split('/').filter(Boolean)[0] || (cfg.owner + '.github.io');

  const TOKEN_KEY = 'checkie_gh_token';
  let token = '';
  try { token = localStorage.getItem(TOKEN_KEY) || ''; } catch (e) {}

  const api = path => `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${path}`;
  const headers = () => Object.assign({ Accept: 'application/vnd.github+json' }, token ? { Authorization: 'Bearer ' + token } : {});
  const b64decode = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, '')), c => c.charCodeAt(0)));
  const b64encode = s => { const bytes = new TextEncoder().encode(s); let bin = ''; bytes.forEach(b => (bin += String.fromCharCode(b))); return btoa(bin); };
  const clone = o => JSON.parse(JSON.stringify(o));
  function err(code, message) { const e = new Error(message); e.code = code; return e; }

  const stores = {};
  function store(col) {
    if (!stores[col]) stores[col] = { data: {}, sha: null, dirty: new Set(), deleted: new Set(), timer: null, saving: null, listeners: [], loaded: false };
    return stores[col];
  }
  function snapshot(col) {
    const s = store(col);
    const docs = Object.entries(s.data).map(([id, d]) => ({ id, exists: true, data: () => d }));
    return { docs, size: docs.length, empty: !docs.length };
  }
  function notify(col) { const snap = snapshot(col); store(col).listeners.forEach(fn => { try { fn(snap); } catch (e) { console.error(e); } }); }

  async function fetchRemote(col) {
    const path = `${cfg.dataDir}/${col}.json`;
    if (token && cfg.owner && cfg.repo) {
      const r = await fetch(api(path) + `?ref=${encodeURIComponent(cfg.branch)}&t=${Date.now()}`, { headers: headers(), cache: 'no-store' });
      if (r.status === 404) return { data: {}, sha: null };
      if (r.status === 401) throw err('unauthorized', '토큰이 올바르지 않아요.');
      if (!r.ok) throw err('unavailable', 'GitHub에서 파일을 읽지 못했어요.');
      const j = await r.json();
      return { data: JSON.parse(b64decode(j.content) || '{}'), sha: j.sha };
    }
    const r = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return { data: {}, sha: null };
    return { data: await r.json(), sha: null };
  }

  async function load(col) {
    const s = store(col);
    try {
      const remote = await fetchRemote(col);
      if (!s.dirty.size && !s.deleted.size) { s.data = remote.data; }
      s.sha = remote.sha; s.loaded = true;
      notify(col);
    } catch (e) {
      if (e.code === 'unauthorized') { setToken(''); window.dispatchEvent(new CustomEvent('gh-auth', { detail: 'invalid' })); }
      s.loaded = true; notify(col);
    }
  }

  function scheduleSave(col) {
    const s = store(col);
    clearTimeout(s.timer);
    s.timer = setTimeout(() => save(col).catch(e => window.dispatchEvent(new CustomEvent('gh-save-error', { detail: e }))), 1200);
  }

  async function save(col, retry = true) {
    const s = store(col);
    if (!s.dirty.size && !s.deleted.size) return;
    if (!token) throw err('invalid_argument', '편집 로그인이 필요해요.');
    if (s.saving) { await s.saving.catch(() => {}); return save(col, retry); }
    const dirty = new Set(s.dirty), deleted = new Set(s.deleted);
    s.saving = (async () => {
      const remote = await fetchRemote(col);
      const merged = remote.data || {};
      dirty.forEach(id => { if (s.data[id]) merged[id] = clone(s.data[id]); });
      deleted.forEach(id => { delete merged[id]; });
      const body = {
        message: `${col} 수정 (${[...dirty, ...deleted].slice(0, 5).join(', ')}${dirty.size + deleted.size > 5 ? ' 외' : ''})`,
        content: b64encode(JSON.stringify(merged, null, 2) + '\n'),
        branch: cfg.branch,
      };
      if (remote.sha) body.sha = remote.sha;
      const r = await fetch(api(`${cfg.dataDir}/${col}.json`), { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/json' }, headers()), body: JSON.stringify(body) });
      if (r.status === 409 || r.status === 422) { if (retry) { s.saving = null; return save(col, false); } throw err('unavailable', '다른 사람과 동시에 저장되어 충돌했어요. 다시 시도해 주세요.'); }
      if (r.status === 401 || r.status === 403 || r.status === 404) throw err('invalid_argument', '이 저장소에 쓸 권한이 없어요. 토큰 권한(Contents: Read and write)을 확인해 주세요.');
      if (!r.ok) throw err('unavailable', 'GitHub에 저장하지 못했어요.');
      const j = await r.json();
      s.sha = j.content && j.content.sha;
      dirty.forEach(id => s.dirty.delete(id));
      deleted.forEach(id => s.deleted.delete(id));
      // 다른 사람이 그사이 바꾼 항목은 받아 오고, 아직 저장 안 된 내 변경은 유지
      Object.keys(merged).forEach(id => { if (!s.dirty.has(id) && !s.deleted.has(id)) s.data[id] = merged[id]; });
      Object.keys(s.data).forEach(id => { if (!(id in merged) && !s.dirty.has(id)) delete s.data[id]; });
      notify(col);
    })();
    try { await s.saving; } finally { s.saving = null; }
    if (s.dirty.size || s.deleted.size) scheduleSave(col);
  }

  function deepMerge(a, b) {
    Object.keys(b).forEach(k => {
      const v = b[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k])) deepMerge(a[k], v);
      else a[k] = clone(v);
    });
    return a;
  }

  const db = {
    collection(col) {
      return {
        onSnapshot(fn) {
          const s = store(col); s.listeners.push(fn);
          if (s.loaded) setTimeout(() => fn(snapshot(col)), 0); else load(col);
          return () => { s.listeners = s.listeners.filter(f => f !== fn); };
        },
      };
    },
    doc(path) {
      const [col, id] = path.split('/');
      const s = store(col);
      const guard = () => { if (!token) throw err('invalid_argument', '편집 로그인이 필요해요.'); };
      return {
        async set(d) { guard(); s.data[id] = clone(d); s.dirty.add(id); s.deleted.delete(id); notify(col); scheduleSave(col); },
        async update(d) { guard(); if (!s.data[id]) throw err('invalid_argument', '없는 항목이에요.'); deepMerge(s.data[id], d); s.dirty.add(id); notify(col); scheduleSave(col); },
        async delete() { guard(); delete s.data[id]; s.dirty.delete(id); s.deleted.add(id); notify(col); scheduleSave(col); },
      };
    },
  };

  const user = { async can() { return !!token; } };

  const downloads = {
    async save({ filename, data }) {
      const url = URL.createObjectURL(new Blob([data], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      return { status: 'saved' };
    },
  };

  function setToken(t) {
    token = t || '';
    try { if (token) localStorage.setItem(TOKEN_KEY, token); else localStorage.removeItem(TOKEN_KEY); } catch (e) {}
  }

  // 1분마다 최신 내용 받아오기 (저장 대기 중인 변경이 없을 때만)
  setInterval(() => {
    if (document.hidden) return;
    Object.keys(stores).forEach(col => { const s = stores[col]; if (!s.dirty.size && !s.deleted.size && !s.saving) load(col); });
  }, 60000);
  window.addEventListener('beforeunload', e => {
    if (Object.values(stores).some(s => s.dirty.size || s.deleted.size || s.saving)) { e.preventDefault(); e.returnValue = ''; }
  });

  window.GHStore = {
    config: cfg,
    hasToken: () => !!token,
    async login(t) {
      const r = await fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}`, { headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + t } });
      if (!r.ok) throw err('unauthorized', '토큰으로 저장소에 접근하지 못했어요.');
      const j = await r.json();
      if (j.permissions && !j.permissions.push) throw err('unauthorized', '이 저장소에 쓰기 권한이 없어요. 저장소 관리자에게 초대를 요청해 주세요.');
      setToken(t);
    },
    logout() { setToken(''); },
    pending: () => Object.values(stores).some(s => s.dirty.size || s.deleted.size || s.saving),
  };
  window.claude = { use: async name => ({ db, user, downloads })[name] || null };
})();
