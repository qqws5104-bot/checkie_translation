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
    .then(r => r.json()).then(j => { if (!j.error && 'loggedIn' in j) me = j; else me.setupError = j.message || '서버에서 알 수 없는 오류가 남.'; return me; })
    .catch(() => { me.offline = true; return me; });

  const stores = {};
  function store(col) {
    if (!stores[col]) stores[col] = { data: {}, base: {}, ver: {}, dirty: new Set(), deleted: new Set(), timer: null, saving: null, listeners: [], loaded: false };
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
      if (r.ok) { const j = await r.json(); if (!s.saving) absorb(s, j.data || {}, null); }
      else if (r.status === 401) window.dispatchEvent(new CustomEvent('store-need-view'));
    } catch (e) { /* 네트워크 오류: 다음 새로고침에서 다시 시도 */ }
    s.loaded = true; notify(col);
  }

  /* 저장 상태를 화면에 알린다: queued(보낼 변경 있음) · saving(보내는 중) · lastSaved · error */
  let lastSaved = null, lastError = null;
  function emit() {
    const ss = Object.values(stores);
    window.dispatchEvent(new CustomEvent('store-state', { detail: { queued: ss.some(s => s.dirty.size || s.deleted.size), saving: ss.some(s => s.saving), lastSaved, error: lastError } }));
  }
  /* 서버 최신본을 받아 들인다. 아직 안 보낸 내 변경은 최신본 위에 다시 얹는다(rebase). */
  function absorb(s, server, sent) {
    Object.keys(server).forEach(id => {
      if (s.deleted.has(id)) return;
      if (s.dirty.has(id)) {
        const from = (sent && sent[id]) || s.base[id];
        const mine = from ? Merge.diff(from, s.data[id]) : { $set: s.data[id] };
        s.data[id] = Merge.apply(clone(server[id]), mine);
      } else s.data[id] = clone(server[id]);
      s.base[id] = clone(server[id]);
    });
    Object.keys(s.data).forEach(id => { if (!(id in server) && !s.dirty.has(id)) { delete s.data[id]; delete s.base[id]; } });
  }
  function touch(s, id) { s.ver[id] = (s.ver[id] || 0) + 1; s.dirty.add(id); }
  function scheduleSave(col) {
    const s = store(col); clearTimeout(s.timer);
    s.timer = setTimeout(() => runSave(col), 1200);
    emit();
  }
  function runSave(col) {
    return save(col).then(() => { lastError = null; emit(); }, e => { lastError = e; emit(); window.dispatchEvent(new CustomEvent('store-save-error', { detail: e })); });
  }
  async function save(col) {
    const s = store(col);
    if (s.saving) { await s.saving.catch(() => {}); }
    if (!s.dirty.size && !s.deleted.size) return;
    const dirty = [...s.dirty], deleted = [...s.deleted], sentVer = {}, sent = {};
    const body = { set: {}, patch: {}, del: deleted };
    dirty.filter(id => s.data[id]).forEach(id => {
      sentVer[id] = s.ver[id]; sent[id] = clone(s.data[id]);
      if (s.base[id]) { const d = Merge.diff(s.base[id], s.data[id]); if (d) body.patch[id] = d; }
      else body.set[id] = sent[id];
    });
    s.saving = (async () => {
      emit();
      const r = await fetch('/api/data/' + col, { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (r.status === 403 || r.status === 401) {
        /* 권한 없는 변경은 되돌린다 (그래야 다음 저장이 막히지 않음) */
        dirty.forEach(id => { if (s.base[id]) s.data[id] = clone(s.base[id]); else delete s.data[id]; s.dirty.delete(id); });
        deleted.forEach(id => s.deleted.delete(id)); notify(col);
        throw err('invalid_argument', j.message || '수정하려면 로그인 필요.');
      }
      if (!r.ok) throw err('unavailable', j.message || '저장하지 못함.');
      dirty.forEach(id => { if (s.ver[id] === sentVer[id] || !s.data[id]) s.dirty.delete(id); });
      deleted.forEach(id => { s.deleted.delete(id); delete s.base[id]; });
      absorb(s, j.data || {}, sent);
      if (j.conflicts && Object.keys(j.conflicts).length) window.dispatchEvent(new CustomEvent('store-conflict', { detail: { col, conflicts: j.conflicts } }));
      lastSaved = new Date();
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
      const guard = () => { if (!me.canEdit && !me.canView) throw err('invalid_argument', me.loggedIn ? '보기 전용 계정임. 수정 권한은 관리자에게 요청 필요.' : '수정하려면 로그인 필요.'); };
      return {
        async set(d) { guard(); s.data[id] = clone(d); touch(s, id); s.deleted.delete(id); notify(col); scheduleSave(col); },
        async update(d) { guard(); if (!s.data[id]) throw err('invalid_argument', '없는 항목임.'); deepMerge(s.data[id], d); touch(s, id); notify(col); scheduleSave(col); },
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
    if (!r.ok) throw err('failed', j.message || '요청을 처리하지 못함.');
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
    setColor: color => post('/api/color', { color }),
    setProfile: patch => post('/api/profile', patch),
    async adminUsers() {
      const r = await fetch('/api/admin/users', { credentials: 'same-origin', cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw err('failed', j.message || '회원 목록을 불러오지 못함.');
      return j.users || [];
    },
    adminAction: (id, action, extra) => post('/api/admin/users/' + encodeURIComponent(id), Object.assign({ action }, extra || {})),
    pending: () => Object.values(stores).some(s => s.dirty.size || s.deleted.size || s.saving),
    /* 기다리지 않고 바로 저장 */
    async flush() {
      await Promise.all(Object.keys(stores).map(col => { const s = stores[col]; if (s.dirty.size || s.deleted.size) { clearTimeout(s.timer); return runSave(col); } return s.saving ? s.saving.catch(() => {}) : null; }));
    },
  };
  window.claude = { use: async name => ({ db, user, downloads })[name] || null };
})();
