/*
 * checkie-translation 서버 (Render Web Service용, 외부 패키지 없음 / Node 18 이상)
 *
 * - 첫 화면은 로그인. 회원가입한 사람은 로그인할 수 있지만, 관리자가 ‘보기 허용’을 줄 때까지 내용을 볼 수 없다.
 *   관리자는 회원마다 ‘보기 허용’과 ‘편집 허용’을 따로 준다. 권한은 요청마다 다시 확인하므로 바로 적용된다.
 * - 데이터와 회원 목록은 GitHub 저장소의 data 브랜치(data/themes.json, data/terms.json, data/users.json)에 저장한다.
 *   비밀번호는 scrypt 해시로만 저장한다. GitHub 토큰은 서버 환경 변수에만 있다.
 *
 * 환경 변수
 *   GITHUB_TOKEN     필수. 이 저장소에 Contents: Read and write 권한이 있는 fine-grained 토큰
 *   GITHUB_REPO      필수. "계정/저장소" 형식 (예: xphobia/checkie-translation)
 *   ADMIN_ID         선택. 관리자 아이디 (기본값 yeun)
 *   ADMIN_PASSWORD   선택. 관리자 비밀번호 (기본값 05197) — Render Environment에서 바꾸는 것을 권장
 *   SESSION_SECRET   선택. 로그인 유지용 서명 키 (없으면 GITHUB_TOKEN으로 만듦)
 *   DATA_BRANCH      선택. 기본값 data
 *   BASE_BRANCH      선택. 기본값 main
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const env = process.env;
const REPO = env.GITHUB_REPO || '';
const TOKEN = env.GITHUB_TOKEN || '';
const ADMIN_ID = (env.ADMIN_ID || 'yeun').trim().toLowerCase();
const ADMIN_PW = env.ADMIN_PASSWORD || '05197';
const DATA_BRANCH = env.DATA_BRANCH || 'data';
const BASE_BRANCH = env.BASE_BRANCH || 'main';
const SECRET = env.SESSION_SECRET || crypto.createHash('sha256').update('checkie-session:' + TOKEN + ':' + ADMIN_PW).digest('hex');
const DATA_COLS = ['themes', 'terms'];
const PUBLIC = path.join(__dirname, 'public');
const PORT = env.PORT || 3000;
const configured = !!(REPO && TOKEN);
const ID_RE = /^[a-z0-9._-]{3,20}$/;
const PW_MIN = 4;

/* ---------- GitHub ---------- */
async function gh(p, opts = {}) {
  return fetch((env.GITHUB_API_URL || 'https://api.github.com') + '/repos/' + REPO + p, Object.assign({}, opts, {
    headers: Object.assign({
      Authorization: 'Bearer ' + TOKEN,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'checkie-translation',
    }, opts.body ? { 'Content-Type': 'application/json' } : {}),
  }));
}
let branchReady = null;
function ensureBranch() {
  if (!branchReady) branchReady = (async () => {
    const b = await gh('/branches/' + encodeURIComponent(DATA_BRANCH));
    if (b.ok) return;
    if (b.status === 401) throw new Error('GitHub 토큰이 올바르지 않거나 만료됐어요 (401). Render의 GITHUB_TOKEN을 다시 넣어 주세요.');
    if (b.status !== 404) throw new Error('GitHub 저장소에 접근하지 못했어요 (' + b.status + '). 토큰 권한(Contents: Read and write)을 확인해 주세요.');
    const base = await gh('/git/ref/heads/' + encodeURIComponent(BASE_BRANCH));
    if (!base.ok) throw new Error(base.status === 404 ? `저장소 ${REPO}의 ${BASE_BRANCH} 브랜치를 찾지 못했어요 (404). GITHUB_REPO 이름(밑줄·하이픈까지)과, 토큰에 이 저장소가 선택돼 있는지 확인해 주세요.` : 'GitHub 저장소에 접근하지 못했어요 (' + base.status + ').');
    const sha = (await base.json()).object.sha;
    const c = await gh('/git/refs', { method: 'POST', body: JSON.stringify({ ref: 'refs/heads/' + DATA_BRANCH, sha }) });
    if (!c.ok && c.status !== 422) throw new Error(DATA_BRANCH + ' 브랜치를 만들지 못했어요 (' + c.status + ').');
  })().catch(e => { branchReady = null; throw e; });
  return branchReady;
}
const cache = {};
async function readCol(col, fresh) {
  const c = cache[col];
  if (!fresh && c && Date.now() - c.at < 5000) return c;
  await ensureBranch();
  const r = await gh(`/contents/data/${col}.json?ref=${encodeURIComponent(DATA_BRANCH)}`);
  let out;
  if (r.status === 404) out = { data: {}, sha: null };
  else if (!r.ok) throw new Error('GitHub에서 데이터를 읽지 못했어요 (' + r.status + ').');
  else { const j = await r.json(); out = { data: JSON.parse(Buffer.from(j.content, 'base64').toString('utf8') || '{}'), sha: j.sha }; }
  out.at = Date.now();
  cache[col] = out;
  return out;
}
const queues = {};
/* mutate(data) 가 바꾼 결과를 커밋. 같은 파일 쓰기는 한 번에 하나씩, 충돌하면 최신본으로 다시 시도. */
function writeCol(col, mutate, message) {
  const run = async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const cur = await readCol(col, true);
      const data = JSON.parse(JSON.stringify(cur.data));
      const changed = mutate(data);
      if (changed === false) return cur;
      const body = { message, content: Buffer.from(JSON.stringify(data, null, 2) + '\n', 'utf8').toString('base64'), branch: DATA_BRANCH };
      if (cur.sha) body.sha = cur.sha;
      const r = await gh(`/contents/data/${col}.json`, { method: 'PUT', body: JSON.stringify(body) });
      if (r.status === 409 || r.status === 422) continue;
      if (!r.ok) throw new Error('GitHub에 저장하지 못했어요 (' + r.status + ').');
      const j = await r.json();
      cache[col] = { data, sha: j.content.sha, at: Date.now() };
      return cache[col];
    }
    throw new Error('동시에 저장되어 충돌했어요. 다시 시도해 주세요.');
  };
  const p = (queues[col] || Promise.resolve()).then(run, run);
  queues[col] = p.catch(() => {});
  return p;
}

/* ---------- 비밀번호·세션 ---------- */
function hashPw(pw, salt = crypto.randomBytes(16).toString('hex')) {
  return new Promise((resolve, reject) => crypto.scrypt(pw, salt, 64, (e, k) => e ? reject(e) : resolve({ salt, hash: k.toString('hex') })));
}
async function checkPw(pw, u) {
  if (!u || !u.salt || !u.hash) return false;
  const { hash } = await hashPw(pw, u.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(u.hash, 'hex'));
}
const safeEq = (a, b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(), crypto.createHash('sha256').update(String(b)).digest());
function sign(payload) {
  const b = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return b + '.' + crypto.createHmac('sha256', SECRET).update(b).digest('base64url');
}
function verify(tok) {
  if (!tok || !tok.includes('.')) return null;
  const [b, s] = tok.split('.');
  const expect = crypto.createHmac('sha256', SECRET).update(b).digest('base64url');
  if (s.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expect))) return null;
  try { const p = JSON.parse(Buffer.from(b, 'base64url').toString()); return p.exp > Date.now() ? p : null; } catch { return null; }
}
/* 예전 형식(status/role/email)으로 저장된 회원도 읽을 수 있게 맞춘다 */
function norm(u) {
  return {
    username: u.username || u.email || '',
    name: u.name || '',
    canView: u.canView !== undefined ? !!u.canView : u.status === 'approved',
    canEdit: u.canEdit !== undefined ? !!u.canEdit : (u.status === 'approved' && u.role === 'editor'),
    createdAt: u.createdAt || null,
    permAt: u.permAt || u.approvedAt || null,
  };
}
/* 세션 쿠키 → 현재 사용자. 권한은 매번 회원 목록에서 다시 확인한다. */
async function currentUser(req) {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)checkie_session=([^;]+)/);
  const s = m ? verify(decodeURIComponent(m[1])) : null;
  if (!s) return null;
  if (s.uid === 'admin') return { id: 'admin', username: ADMIN_ID, name: '관리자', canView: true, canEdit: true, isAdmin: true };
  const users = (await readCol('users')).data;
  const u = users[s.uid];
  if (!u || (u.pwv || 1) !== s.pwv) return null;
  return Object.assign({ id: s.uid, isAdmin: false }, norm(u));
}
const attempts = new Map();
function tooMany(key, limit, windowMs) {
  const now = Date.now(), list = (attempts.get(key) || []).filter(t => now - t < windowMs);
  attempts.set(key, list);
  return list.length >= limit;
}
function hit(key) { const l = attempts.get(key) || []; l.push(Date.now()); attempts.set(key, l); }
const publicUser = (id, u) => Object.assign({ id }, norm(u));

/* ---------- HTTP ---------- */
function send(res, status, obj, headers = {}) {
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers));
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 2e6) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
function serveStatic(req, res, pathname) {
  let p = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  if (p === '/' || p === '\\') p = '/index.html';
  const file = path.join(PUBLIC, p);
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('없는 페이지예요.'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  const secure = (req.headers['x-forwarded-proto'] || '').includes('https');
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const cookie = (tok, age) => `checkie_session=${tok}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`;
  const session = (payload) => ({ 'Set-Cookie': cookie(encodeURIComponent(sign(Object.assign({ exp: Date.now() + 30 * 864e5 }, payload))), 30 * 86400) });
  try {
    if (!p.startsWith('/api/')) return serveStatic(req, res, p);
    if (!configured) return send(res, 500, { error: 'setup', message: '서버 설정이 끝나지 않았어요. Render의 Environment에 GITHUB_TOKEN과 GITHUB_REPO를 넣어 주세요.' });
    const me = await currentUser(req);

    if (p === '/api/me' && req.method === 'GET') {
      let pending = 0;
      if (me && me.isAdmin) pending = Object.values((await readCol('users')).data).filter(u => !norm(u).canView).length;
      return send(res, 200, me ? { loggedIn: true, name: me.name, username: me.username, canView: me.canView, canEdit: me.canEdit, isAdmin: me.isAdmin, pending } : { loggedIn: false });
    }

    if (p === '/api/signup' && req.method === 'POST') {
      if (tooMany('signup:' + ip, 5, 600000)) return send(res, 429, { message: '가입 신청이 너무 많아요. 잠시 뒤 다시 시도해 주세요.' });
      const b = await readBody(req);
      const username = String(b.username || '').trim().toLowerCase(), name = String(b.name || '').trim().slice(0, 30), pw = String(b.password || '');
      if (!ID_RE.test(username)) return send(res, 400, { message: '아이디는 영문 소문자·숫자·. _ - 로 3~20자로 정해 주세요.' });
      if (!name) return send(res, 400, { message: '이름을 입력해 주세요.' });
      if (pw.length < PW_MIN) return send(res, 400, { message: `비밀번호는 ${PW_MIN}자 이상으로 정해 주세요.` });
      if (username === ADMIN_ID) return send(res, 409, { message: '이미 사용 중인 아이디예요.' });
      const { salt, hash } = await hashPw(pw);
      let dup = false, uid = 'u-' + crypto.randomBytes(6).toString('hex');
      await writeCol('users', data => {
        if (Object.values(data).some(u => norm(u).username === username)) { dup = true; return false; }
        data[uid] = { username, name, salt, hash, pwv: 1, canView: false, canEdit: false, createdAt: new Date().toISOString() };
      }, `회원가입 · ${name} (${username})`);
      if (dup) return send(res, 409, { message: '이미 사용 중인 아이디예요.' });
      hit('signup:' + ip);
      return send(res, 200, { ok: true }, session({ uid, pwv: 1 }));
    }

    if (p === '/api/login' && req.method === 'POST') {
      const b = await readBody(req);
      const username = String(b.username || '').trim().toLowerCase(), pw = String(b.password || '');
      if (tooMany('ip:' + ip, 20, 60000) || tooMany('id:' + username, 10, 900000)) return send(res, 429, { message: '로그인 실패가 너무 많아요. 15분 뒤 다시 시도해 주세요.' });
      if (username === ADMIN_ID) {
        if (safeEq(pw, ADMIN_PW)) { attempts.delete('id:' + username); return send(res, 200, { ok: true }, session({ uid: 'admin' })); }
        hit('ip:' + ip); hit('id:' + username);
        return send(res, 401, { message: '아이디 또는 비밀번호가 맞지 않아요.' });
      }
      const users = (await readCol('users', true)).data;
      const entry = Object.entries(users).find(([, u]) => norm(u).username === username);
      if (!entry || !(await checkPw(pw, entry[1]))) { hit('ip:' + ip); hit('id:' + username); return send(res, 401, { message: '아이디 또는 비밀번호가 맞지 않아요.' }); }
      attempts.delete('id:' + username);
      return send(res, 200, { ok: true }, session({ uid: entry[0], pwv: entry[1].pwv || 1 }));
    }
    if (p === '/api/logout' && req.method === 'POST') return send(res, 200, { ok: true }, { 'Set-Cookie': cookie('', 0) });

    if (p === '/api/password' && req.method === 'POST') {
      if (!me || me.isAdmin) return send(res, 403, { message: me ? '관리자 비밀번호는 Render의 ADMIN_PASSWORD에서 바꿔 주세요.' : '로그인이 필요해요.' });
      const b = await readBody(req);
      if (String(b.next || '').length < PW_MIN) return send(res, 400, { message: `새 비밀번호는 ${PW_MIN}자 이상으로 정해 주세요.` });
      const users = (await readCol('users', true)).data;
      if (!(await checkPw(String(b.current || ''), users[me.id]))) return send(res, 401, { message: '지금 비밀번호가 맞지 않아요.' });
      const { salt, hash } = await hashPw(String(b.next));
      let pwv;
      await writeCol('users', data => { const u = data[me.id]; u.salt = salt; u.hash = hash; u.pwv = (u.pwv || 1) + 1; pwv = u.pwv; }, `비밀번호 변경 · ${me.name}`);
      return send(res, 200, { ok: true }, session({ uid: me.id, pwv }));
    }

    /* ----- 관리자: 회원 권한 ----- */
    if (p === '/api/admin/users' && req.method === 'GET') {
      if (!me || !me.isAdmin) return send(res, 403, { message: '관리자만 볼 수 있어요.' });
      const users = (await readCol('users', true)).data;
      return send(res, 200, { users: Object.entries(users).map(([id, u]) => publicUser(id, u)) });
    }
    const am = p.match(/^\/api\/admin\/users\/([\w-]+)$/);
    if (am && req.method === 'POST') {
      if (!me || !me.isAdmin) return send(res, 403, { message: '관리자만 할 수 있어요.' });
      const id = am[1];
      const b = await readBody(req);
      let temp = null, found = true, label = '';
      if (b.action === 'reset') temp = String(crypto.randomInt(100000, 1000000));
      const reset = temp ? await hashPw(temp) : null;
      await writeCol('users', data => {
        const u = data[id];
        if (!u) { found = false; return false; }
        label = u.name;
        if (b.action === 'perm') {
          const n = norm(u);
          const edit = b.edit !== undefined ? !!b.edit : n.canEdit;
          const view = b.view !== undefined ? !!b.view : n.canView;
          u.canEdit = edit; u.canView = view || edit;
          if (b.view === false) u.canEdit = false;
          u.permAt = new Date().toISOString();
          delete u.status; delete u.role; delete u.approvedAt;
          if (!u.username && u.email) u.username = u.email;
        } else if (b.action === 'delete') { delete data[id]; }
        else if (b.action === 'reset') { u.salt = reset.salt; u.hash = reset.hash; u.pwv = (u.pwv || 1) + 1; }
        else return false;
      }, `회원 권한 · ${b.action} · ${id}`);
      if (!found) return send(res, 404, { message: '없는 회원이에요.' });
      return send(res, 200, { ok: true, tempPassword: temp, name: label });
    }

    /* ----- 게임 카드·용어집 ----- */
    const m = p.match(/^\/api\/data\/(\w+)$/);
    if (m && DATA_COLS.includes(m[1])) {
      if (req.method === 'GET') {
        if (!me || !me.canView) return send(res, 401, { message: me ? '아직 보기 허용을 받지 않았어요.' : '로그인이 필요해요.' });
        return send(res, 200, { data: (await readCol(m[1])).data });
      }
      if (req.method === 'PUT') {
        if (!me || !me.canEdit) return send(res, 403, { message: me ? '편집 허용을 받지 않았어요. 관리자에게 요청해 주세요.' : '수정하려면 로그인해 주세요.' });
        const changes = await readBody(req);
        const ids = [...Object.keys(changes.set || {}), ...(changes.del || [])];
        const c = await writeCol(m[1], data => {
          if (!ids.length) return false;
          Object.entries(changes.set || {}).forEach(([id, doc]) => { data[id] = doc; });
          (changes.del || []).forEach(id => { delete data[id]; });
        }, `${m[1]} 수정 · ${me.name} (${ids.slice(0, 5).join(', ')}${ids.length > 5 ? ' 외' : ''})`);
        return send(res, 200, { data: c.data });
      }
    }
    return send(res, 404, { message: '없는 주소예요.' });
  } catch (e) {
    console.error(e);
    const msg = /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/.test(String(e.message)) ? 'GitHub에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.' : (e.message || '서버 오류가 났어요.');
    return send(res, 500, { error: 'server', message: msg });
  }
}).listen(PORT, () => console.log('checkie-translation listening on ' + PORT + (configured ? '' : ' (환경 변수 설정 필요)')));
