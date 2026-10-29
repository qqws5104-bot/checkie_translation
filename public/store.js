/*
 * store.js — 사이트 화면과 서버(/api)를 잇는 데이터 계층.
 * 수정 사항을 모아 1.2초 뒤 서버로 보내고, 서버가 GitHub에 커밋한다.
 * 페이지 코드는 window.claude.use('db' | 'user' | 'downloads') 형태로 이 계층을 쓴다.
 */
(function () {
  const clone = o => JSON.parse(JSON.stringify(o));
  function err(code, message) { const e = new Error(message); e.code = code; return e; }
  let me = { loggedIn: false, canEdit: false, canView: false, isAdmin: false, name: '', username: '', pending: 0 };
  const meReady = fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' })
    .then(r => r.json()).then(j => { if (!j.error) me = j; else me.setupError = j.message; return me; })
    .catch(() => { me.offline = true; return me; });

  const stores = {};
  function store(col) {
    if (!stores[col]) stores[col] = { data: {}, dirty: new Set(), deleted: new Set(), timer: null, saving: null, listeners: [], loaded: false };
    return stores[col];
  }
  function snapshot(col) {
    const docs = Object.entries(store(col).data).map(([id, d]) => ({ id, exists: true, data: () => d }));
    return { docs, size: docs.length, empty: !docs.length };
  }
  function notify(col) { const snap = snapshot(col); store(col).listeners.forEach(fn => { try { fn(snap); } catch (e) { console.error(e); } }); }

  async function load(col) {
    const s = store(col);
    try {
      const r = await fetch('/api/data/' + col, { credentials: 'same-origin', cache: 'no-store' });
      if (r.ok) { const j = await r.json(); if (!s.dirty.size && !s.deleted.size && !s.saving) s.data = j.data || {}; }
      else if (r.status === 401) window.dispatchEvent(new CustomEvent('store-need-view'));
    } catch (e) { /* 네트워크 오류: 다음 새로고침에서 다시 시도 */ }
    s.loaded = true; notify(col);
  }

  function scheduleSave(col) {
    const s = store(col); clearTimeout(s.timer);
    s.timer = setTimeout(() => save(col).catch(e => window.dispatchEvent(new CustomEvent('store-save-error', { detail: e }))), 1200);
  }
  async function save(col) {
    const s = store(col);
    if (s.saving) { await s.saving.catch(() => {}); }
    if (!s.dirty.size && !s.deleted.size) return;
    const dirty = [...s.dirty], deleted = [...s.deleted];
    const body = { set: Object.fromEntries(dirty.filter(id => s.data[id]).map(id => [id, s.data[id]])), del: deleted };
    s.saving = (async () => {
      const r = await fetch('/api/data/' + col, { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (r.status === 403 || r.status === 401) throw err('invalid_argument', j.message || '수정하려면 로그인해 주세요.');
      if (!r.ok) throw err('unavailable', j.message || '저장하지 못했어요.');
      dirty.forEach(id => s.dirty.delete(id)); deleted.forEach(id => s.deleted.delete(id));
      const merged = j.data || {};
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
          if (s.loaded) setTimeout(() => fn(snapshot(col)), 0); else meReady.then(() => load(col));
          return () => { s.listeners = s.listeners.filter(f => f !== fn); };
        },
      };
    },
    doc(p) {
      const [col, id] = p.split('/'); const s = store(col);
      const guard = () => { if (!me.canEdit) throw err('invalid_argument', me.loggedIn ? '보기 전용 계정이에요. 수정 권한은 관리자에게 요청해 주세요.' : '수정하려면 로그인해 주세요.'); };
      return {
        async set(d) { guard(); s.data[id] = clone(d); s.dirty.add(id); s.deleted.delete(id); notify(col); scheduleSave(col); },
        async update(d) { guard(); if (!s.data[id]) throw err('invalid_argument', '없는 항목이에요.'); deepMerge(s.data[id], d); s.dirty.add(id); notify(col); scheduleSave(col); },
        async delete() { guard(); delete s.data[id]; s.dirty.delete(id); s.deleted.add(id); notify(col); scheduleSave(col); },
      };
    },
  };
  const user = { async can() { await meReady; return !!me.canEdit; } };
  const downloads = {
    async save({ filename, data }) {
      const url = URL.createObjectURL(new Blob([data], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      return { status: 'saved' };
    },
  };

  setInterval(() => {
    if (document.hidden) return;
    Object.keys(stores).forEach(col => { const s = stores[col]; if (!s.dirty.size && !s.deleted.size && !s.saving) load(col); });
  }, 30000);
  window.addEventListener('beforeunload', e => {
    if (Object.values(stores).some(s => s.dirty.size || s.deleted.size || s.saving)) { e.preventDefault(); e.returnValue = ''; }
  });

  async function post(url, body) {
    const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw err('failed', j.message || '요청을 처리하지 못했어요.');
    return j;
  }
  window.Store = {
    me: () => meReady,
    login: (username, password) => post('/api/login', { username, password }),
    signup: (username, name, password) => post('/api/signup', { username, name, password }),
    async refreshMe() {
      const r = await fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' });
      return r.json();
    },
    logout: () => post('/api/logout'),
    changePassword: (current, next) => post('/api/password', { current, next }),
    async adminUsers() {
      const r = await fetch('/api/admin/users', { credentials: 'same-origin', cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw err('failed', j.message || '회원 목록을 불러오지 못했어요.');
      return j.users || [];
    },
    adminAction: (id, action, extra) => post('/api/admin/users/' + encodeURIComponent(id), Object.assign({ action }, extra || {})),
    pending: () => Object.values(stores).some(s => s.dirty.size || s.deleted.size || s.saving),
  };
  window.claude = { use: async name => ({ db, user, downloads })[name] || null };
})();
