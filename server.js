/*
 * checkie-translation 서버 (Render Web Service용, 외부 패키지 없음 / Node 18 이상)
 *
 * - public/ 폴더의 사이트 화면을 보여 준다.
 * - 회원가입 → 관리자 승인 → 로그인 방식. 승인된 사람만 보고(보기 전용) 고칠 수 있다(편집자).
 * - 데이터와 회원 목록은 GitHub 저장소의 data 브랜치(data/themes.json, data/terms.json, data/users.json)에 저장한다.
 *   비밀번호는 scrypt 해시로만 저장한다. GitHub 토큰은 서버 환경 변수에만 있다.
 *
 * 환경 변수
 *   GITHUB_TOKEN     필수. 이 저장소에 Contents: Read and write 권한이 있는 fine-grained 토큰
 *   GITHUB_REPO      필수. "계정/저장소" 형식 (예: xphobia/checkie-translation)
 *   ADMIN_EMAIL      필수. 관리자 로그인 이메일
 *   ADMIN_PASSWORD   필수. 관리자 비밀번호 (8자 이상)
 *   SESSION_SECRET   선택. 로그인 유지용 서명 키 (없으면 ADMIN_PASSWORD로 만듦)
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
const ADMIN_EMAIL = (env.ADMIN_EMAIL || '').trim().toLowerCase();
const ADMIN_PW = env.ADMIN_PASSWORD || '';
const DATA_BRANCH = env.DATA_BRANCH || 'data';
const BASE_BRANCH = env.BASE_BRANCH || 'main';
const SECRET = env.SESSION_SECRET || crypto.createHash('sha256').update('checkie:' + ADMIN_PW + ':' + REPO).digest('hex');
const DATA_COLS = ['themes', 'terms'];
const PUBLIC = path.join(__dirname, 'public');
const PORT = env.PORT || 3000;
const configured = !!(REPO && TOKEN && ADMIN_EMAIL && ADMIN_PW.length >= 8);

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
    if (b.status !== 404) throw new Error('GitHub 저장소에 접근하지 못했어요 (' + b.status + '). 토큰과 GITHUB_REPO를 확인해 주세요.');
    const base = await gh('/git/ref/heads/' + encodeURIComponent(BASE_BRANCH));
    if (!base.ok) throw new Error(BASE_BRANCH + ' 브랜치를 찾지 못했어요.');
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
/* 세션 쿠키 → 현재 사용자. 승인 상태와 권한은 매번 회원 목록에서 다시 확인한다(차단하면 바로 적용). */
async function currentUser(req) {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)checkie_session=([^;]+)/);
  const s = m ? verify(decodeURIComponent(m[1])) : null;
  if (!s) return null;
  if (s.uid === 'admin') return { id: 'admin', name: '관리자', email: ADMIN_EMAIL, role: 'admin' };
  const users = (await readCol('users')).data;
  const u = users[s.uid];
  if (!u || u.status !== 'approved' || u.pwv !== s.pwv) return null;
  return { id: s.uid, name: u.name, email: u.email, role: u.role };
}
const attempts = new Map();
function tooMany(key, limit = 10) {
  const now = Date.now(), list = (attempts.get(key) || []).filter(t => now - t < 60000);
  list.push(now); attempts.set(key, list);
  return list.length > limit;
}
const publicUser = (id, u) => ({ id, email: u.email, name: u.name, status: u.status, role: u.role, createdAt: u.createdAt, approvedAt: u.approvedAt || null });

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
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  const secure = (req.headers['x-forwarded-proto'] || '').includes('https');
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const cookie = (tok, age) => `checkie_session=${tok}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`;
  try {
    if (!p.startsWith('/api/')) return serveStatic(req, res, p);
    if (!configured) return send(res, 500, { error: 'setup', message: '서버 설정이 끝나지 않았어요. Render의 Environment에 GITHUB_TOKEN, GITHUB_REPO, ADMIN_EMAIL, ADMIN_PASSWORD(8자 이상)를 넣어 주세요.' });
    const me = await currentUser(req);
    const canView = !!me;
    const canEdit = !!me && (me.role === 'editor' || me.role === 'admin');
    const isAdmin = !!me && me.role === 'admin';

    if (p === '/api/me' && req.method === 'GET') {
      let pending = 0;
      if (isAdmin) pending = Object.values((await readCol('users')).data).filter(u => u.status === 'pending').length;
      return send(res, 200, { loggedIn: !!me, name: me ? me.name : '', email: me ? me.email : '', role: me ? me.role : '', canView, canEdit, isAdmin, pending });
    }

    if (p === '/api/signup' && req.method === 'POST') {
      if (tooMany('signup:' + ip, 5)) return send(res, 429, { message: '시도가 너무 많아요. 잠시 뒤 다시 시도해 주세요.' });
      const b = await readBody(req);
      const email = String(b.email || '').trim().toLowerCase(), name = String(b.name || '').trim().slice(0, 30), pw = String(b.password || '');
      if (!name) return send(res, 400, { message: '이름을 입력해 주세요.' });
      if (!EMAIL_RE.test(email)) return send(res, 400, { message: '이메일 형식을 확인해 주세요.' });
      if (pw.length < 8) return send(res, 400, { message: '비밀번호는 8자 이상으로 정해 주세요.' });
      if (email === ADMIN_EMAIL) return send(res, 400, { message: '이미 가입된 이메일이에요.' });
      const { salt, hash } = await hashPw(pw);
      let dup = false;
      await writeCol('users', data => {
        if (Object.values(data).some(u => u.email === email)) { dup = true; return false; }
        data['u-' + crypto.randomBytes(6).toString('hex')] = { email, name, salt, hash, pwv: 1, status: 'pending', role: 'viewer', createdAt: new Date().toISOString() };
      }, `회원가입 신청 · ${name}`);
      if (dup) return send(res, 409, { message: '이미 가입 신청한 이메일이에요. 관리자 승인을 기다리거나 로그인해 주세요.' });
      return send(res, 200, { ok: true, message: '가입 신청을 보냈어요. 관리자가 승인하면 로그인할 수 있어요.' });
    }

    if (p === '/api/login' && req.method === 'POST') {
      if (tooMany('login:' + ip)) return send(res, 429, { message: '시도가 너무 많아요. 1분 뒤 다시 시도해 주세요.' });
      const b = await readBody(req);
      const email = String(b.email || '').trim().toLowerCase(), pw = String(b.password || '');
      const exp = Date.now() + 30 * 864e5;
      if (email === ADMIN_EMAIL && safeEq(pw, ADMIN_PW)) return send(res, 200, { ok: true, role: 'admin' }, { 'Set-Cookie': cookie(encodeURIComponent(sign({ uid: 'admin', exp })), 30 * 86400) });
      const users = (await readCol('users', true)).data;
      const entry = Object.entries(users).find(([, u]) => u.email === email);
      if (!entry || !(await checkPw(pw, entry[1]))) return send(res, 401, { message: '이메일 또는 비밀번호가 맞지 않아요.' });
      const [uid, u] = entry;
      if (u.status === 'pending') return send(res, 403, { message: '아직 관리자 승인 전이에요. 승인되면 로그인할 수 있어요.' });
      if (u.status === 'blocked') return send(res, 403, { message: '사용이 중지된 계정이에요. 관리자에게 문의해 주세요.' });
      return send(res, 200, { ok: true, role: u.role }, { 'Set-Cookie': cookie(encodeURIComponent(sign({ uid, pwv: u.pwv, exp })), 30 * 86400) });
    }
    if (p === '/api/logout' && req.method === 'POST') return send(res, 200, { ok: true }, { 'Set-Cookie': cookie('', 0) });

    if (p === '/api/password' && req.method === 'POST') {
      if (!me || me.id === 'admin') return send(res, 403, { message: me ? '관리자 비밀번호는 Render의 ADMIN_PASSWORD에서 바꿔 주세요.' : '로그인이 필요해요.' });
      const b = await readBody(req);
      if (String(b.next || '').length < 8) return send(res, 400, { message: '새 비밀번호는 8자 이상으로 정해 주세요.' });
      const users = (await readCol('users', true)).data;
      if (!(await checkPw(String(b.current || ''), users[me.id]))) return send(res, 401, { message: '지금 비밀번호가 맞지 않아요.' });
      const { salt, hash } = await hashPw(String(b.next));
      let pwv;
      await writeCol('users', data => { const u = data[me.id]; u.salt = salt; u.hash = hash; u.pwv = (u.pwv || 1) + 1; pwv = u.pwv; }, `비밀번호 변경 · ${me.name}`);
      return send(res, 200, { ok: true }, { 'Set-Cookie': cookie(encodeURIComponent(sign({ uid: me.id, pwv, exp: Date.now() + 30 * 864e5 })), 30 * 86400) });
    }

    /* ----- 관리자: 회원 관리 ----- */
    if (p === '/api/admin/users' && req.method === 'GET') {
      if (!isAdmin) return send(res, 403, { message: '관리자만 볼 수 있어요.' });
      const users = (await readCol('users', true)).data;
      return send(res, 200, { users: Object.entries(users).map(([id, u]) => publicUser(id, u)) });
    }
    const am = p.match(/^\/api\/admin\/users\/([\w-]+)$/);
    if (am && req.method === 'POST') {
      if (!isAdmin) return send(res, 403, { message: '관리자만 할 수 있어요.' });
      const id = am[1];
      const { action, role } = await readBody(req);
      let temp = null, found = true, label = '';
      if (action === 'reset') { temp = crypto.randomBytes(6).toString('base64url'); }
      const reset = temp ? await hashPw(temp) : null;
      await writeCol('users', data => {
        const u = data[id];
        if (!u) { found = false; return false; }
        label = u.name;
        if (action === 'approve') { u.status = 'approved'; u.role = role === 'editor' ? 'editor' : 'viewer'; u.approvedAt = new Date().toISOString(); }
        else if (action === 'role') { u.role = role === 'editor' ? 'editor' : 'viewer'; }
        else if (action === 'block') { u.status = 'blocked'; }
        else if (action === 'delete') { delete data[id]; }
        else if (action === 'reset') { u.salt = reset.salt; u.hash = reset.hash; u.pwv = (u.pwv || 1) + 1; }
        else return false;
      }, `회원 관리 · ${action} · ${id}`);
      if (!found) return send(res, 404, { message: '없는 회원이에요.' });
      return send(res, 200, { ok: true, tempPassword: temp, name: label });
    }

    /* ----- 게임 카드·용어집 ----- */
    const m = p.match(/^\/api\/data\/(\w+)$/);
    if (m && DATA_COLS.includes(m[1])) {
      if (req.method === 'GET') {
        if (!canView) return send(res, 401, { message: '로그인이 필요해요.' });
        return send(res, 200, { data: (await readCol(m[1])).data });
      }
      if (req.method === 'PUT') {
        if (!canEdit) return send(res, 403, { message: me ? '보기 전용 계정이에요. 수정 권한은 관리자에게 요청해 주세요.' : '수정하려면 로그인해 주세요.' });
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
    return send(res, 500, { message: e.message || '서버 오류가 났어요.' });
  }
}).listen(PORT, () => console.log('checkie-translation listening on ' + PORT + (configured ? '' : ' (환경 변수 설정 필요)')));
