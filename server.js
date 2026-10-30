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
 *   ADMIN_NAME       선택. 관리자 이름 기본값 (기본값 김예은, 사이트의 ‘내 정보’에서도 바꿀 수 있음)
 *   SESSION_SECRET   선택. 로그인 유지용 서명 키 (없으면 GITHUB_TOKEN으로 만듦)
 *   DATA_BRANCH      선택. 기본값 data
 *   BASE_BRANCH      선택. 기본값 main
 *   ANTHROPIC_API_KEY 선택. 넣으면 PNG·JPG·PDF 파일을 AI(Claude)로 읽을 수 있다. 없으면 Word·엑셀·CSV만 읽는다.
 *   ANTHROPIC_MODEL  선택. 파일 읽기에 쓸 모델 ID. 비우면 쓸 수 있는 최신 Sonnet 모델을 자동으로 고른다.
 *   AI_HOURLY_LIMIT  선택. 한 사람이 한 시간에 AI로 읽을 수 있는 파일 수 (기본 60)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const env = process.env;
const REPO = env.GITHUB_REPO || '';
const TOKEN = env.GITHUB_TOKEN || '';
const ADMIN_ID = (env.ADMIN_ID || 'yeun').trim().toLowerCase();
const ADMIN_PW = env.ADMIN_PASSWORD || '05197';
const ADMIN_NAME = (env.ADMIN_NAME || '김예은').trim();
const DATA_BRANCH = env.DATA_BRANCH || 'data';
const BASE_BRANCH = env.BASE_BRANCH || 'main';
const SECRET = env.SESSION_SECRET || crypto.createHash('sha256').update('checkie-session:' + TOKEN + ':' + ADMIN_PW).digest('hex');
const DATA_COLS = ['themes', 'terms'];
const PUBLIC = path.join(__dirname, 'public');
const PORT = env.PORT || 3000;
const configured = !!(REPO && TOKEN);
const ID_RE = /^[a-z0-9._-]{3,20}$/;
const PW_MIN = 4;
/* 회원 색: 흰 글씨가 잘 보이는 진한 색 12가지 */
const PALETTE = ['#e03131', '#1971c2', '#2f9e44', '#f08c00', '#9c36b5', '#0c8599', '#c2255c', '#5c940d', '#3b5bdb', '#862e9c', '#087f5b', '#d9480f'];
const OWNER_KEY = '__owner';
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const members = data => Object.entries(data).filter(([id]) => id !== OWNER_KEY);
function colorFor(id) { let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; }
function freeColor(data) {
  const used = new Set(Object.values(data).map(u => (u.color || '').toLowerCase()));
  return PALETTE.find(c => !used.has(c)) || PALETTE[Math.floor(Math.random() * PALETTE.length)];
}

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
    canAdmin: !!u.canAdmin,
    color: COLOR_RE.test(u.color || '') ? u.color : colorFor(u.username || u.email || ''),
    createdAt: u.createdAt || null,
    permAt: u.permAt || u.approvedAt || null,
  };
}
/* 세션 쿠키 → 현재 사용자. 권한은 매번 회원 목록에서 다시 확인한다. */
async function currentUser(req) {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)checkie_session=([^;]+)/);
  const s = m ? verify(decodeURIComponent(m[1])) : null;
  if (!s) return null;
  const users = (await readCol('users')).data;
  if (s.uid === 'admin') { const ow = users[OWNER_KEY] || {}, oc = ow.color; return { id: 'admin', username: ADMIN_ID, name: ow.name || ADMIN_NAME, color: COLOR_RE.test(oc || '') ? oc : '#5f3dc4', canView: true, canEdit: true, isAdmin: true, isOwner: true }; }
  if (s.uid === OWNER_KEY) return null;
  const u = users[s.uid];
  if (!u || (u.pwv || 1) !== s.pwv) return null;
  const n = norm(u);
  /* 관리자로 지정된 회원은 보기·편집·회원 관리를 모두 할 수 있다 */
  return Object.assign({ id: s.uid }, n, n.canAdmin ? { canView: true, canEdit: true, isAdmin: true } : { isAdmin: false }, { isOwner: false });
}
const attempts = new Map();
function tooMany(key, limit, windowMs) {
  const now = Date.now(), list = (attempts.get(key) || []).filter(t => now - t < windowMs);
  attempts.set(key, list);
  return list.length >= limit;
}
function hit(key) { const l = attempts.get(key) || []; l.push(Date.now()); attempts.set(key, l); }
const publicUser = (id, u) => Object.assign({ id }, norm(u));

/* ---------- 파일 읽기: Word(docx)는 서버에서 바로, PNG·JPG·PDF는 Claude API로 ---------- */
const AI = require('./ai');
const AI_KEY = AI.anyVision();
const AI_LIMIT = Number(env.AI_HOURLY_LIMIT) || 200;
const MAX_FILE = 12 * 1024 * 1024;

/* zip 안의 파일 하나 꺼내기 (docx는 zip) */
function unzipEntry(buf, name) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Word 파일을 열지 못했어요. 파일이 손상됐거나 예전 형식(.doc)일 수 있어요. .docx로 다시 저장해 주세요.');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < count && p + 46 <= buf.length; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), lho = buf.readUInt32LE(p + 42);
    if (buf.toString('utf8', p + 46, p + 46 + nlen) === name) {
      const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
      const data = buf.subarray(start, start + csize);
      return method === 0 ? data : zlib.inflateRawSync(data);
    }
    p += 46 + nlen + xlen + clen;
  }
  return null;
}
const unxml = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&');
function wText(xml) {
  let out = '';
  xml.replace(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\b[^>]*\/>/g, (m, t) => { out += t !== undefined ? unxml(t) : m.startsWith('<w:tab') ? ' ' : ' ↵ '; return m; });
  return out.replace(/\s+/g, ' ').trim();
}
const paras = xml => (xml.replace(/<w:p\b[^>]*\/>/g, '').match(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g) || []).map(wText);
/* docx → 순서대로 [{type:'p', text}] / [{type:'table', rows}] */
function readDocx(buf) {
  const doc = unzipEntry(buf, 'word/document.xml');
  if (!doc) throw new Error('Word 문서 내용을 찾지 못했어요.');
  const xml = doc.toString('utf8');
  const body = (xml.match(/<w:body>([\s\S]*)<\/w:body>/) || [, xml])[1];
  /* 바깥 표만 따로 떼어 낸다 (표 안의 표는 칸 글자로 합쳐짐) */
  const tables = []; let rest = '', depth = 0, start = 0, last = 0;
  const re = /<w:tbl>|<\/w:tbl>/g; let m;
  while ((m = re.exec(body))) {
    if (m[0] === '<w:tbl>') { if (depth++ === 0) { rest += body.slice(last, m.index); start = m.index; } }
    else if (depth > 0 && --depth === 0) { tables.push(body.slice(start, re.lastIndex)); rest += `\u0000T${tables.length - 1}\u0000`; last = re.lastIndex; }
  }
  rest += body.slice(last);
  const blocks = [];
  rest.split(/\u0000T(\d+)\u0000/).forEach((part, i) => {
    if (i % 2) {
      const rows = (tables[+part].match(/<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g) || []).map(tr => (tr.match(/<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g) || []).map(tc => paras(tc).filter(Boolean).join(' / ')));
      if (rows.some(r => r.some(c => c))) blocks.push({ type: 'table', rows });
    } else paras(part).forEach(text => { if (text) blocks.push({ type: 'p', text }); });
  });
  return blocks;
}

const AI_PROMPTS = {
  source: `이 파일은 한국 오프라인 게임의 화면 캡처 또는 대본·기획 문서다.
플레이어가 보거나 듣는 한국어 문구를 하나도 빠짐없이 그대로 옮겨 적어라. 번역·요약·맞춤법 수정을 하지 마라.
- 순서: 화면은 위에서 아래, 왼쪽에서 오른쪽 / 문서는 나오는 순서.
- 버튼, 안내문, 대사, 효과 글자, 숫자가 섞인 문구를 모두 넣는다. 한 문구가 줄바꿈되어 있으면 한 행에 쓰고 줄바꿈 자리에 ↵ 를 넣는다.
- 위치: 화면이면 ‘위 왼쪽 버튼’, ‘가운데 말풍선’처럼 짧게. 문서면 ‘2쪽 메리 대사’, ‘3번째 문단’처럼.
- 흐리거나 잘려서 확실히 읽을 수 없으면 비고에 ‘판독 불확실: 이유’를 쓴다. 추측한 글자는 화면 원문에 쓰되 비고에 꼭 표시한다.
- 종류는 버튼 / 안내문 / 대사 / 효과 글자 / 로고 / 기타 중 하나. 한국어가 아닌 글자는 비고에 ‘외국어’.
출력은 탭으로 구분한 표 하나만, 코드 블록 하나 안에 쓴다. 다른 설명은 쓰지 않는다.
첫 행은 정확히 다음과 같다: 순번\t화면 원문\t위치\t종류\t비고
읽을 문구가 없으면 첫 행만 출력한다.`,
  table: `이 파일 안의 표를 그대로 옮겨 적어라. 내용을 고치거나 번역·요약하지 마라.
- 첫 행은 표의 열 이름을 그대로 쓴다.
- 표가 여러 개면 ID 열이 있는 가장 큰 표 하나만 옮긴다. 여러 쪽에 걸쳐 이어지는 표는 하나로 합친다.
- 칸 안의 줄바꿈은 ‘ / ’로 바꾼다. 빈 칸은 비워 둔다.
- 흐려서 확실하지 않은 칸은 칸 끝에 ‘ (판독 불확실)’을 붙인다.
출력은 탭으로 구분한 표 하나만, 코드 블록 하나 안에 쓴다. 다른 설명은 쓰지 않는다.`,
};
async function aiRead(buf, mediaType, mode) {
  const p = AI.anyVision();
  const out = await AI.call(p, { text: AI_PROMPTS[mode], files: [{ media: mediaType, b64: buf.toString('base64') }], maxTokens: 16000 });
  const code = (out.text.match(/```[^\n]*\n([\s\S]*?)```/) || [, out.text])[1];
  const rows = code.split(/\r?\n/).filter(l => l.trim()).map(l => l.split('\t').map(c => c.trim()));
  return { rows, cut: out.cut };
}
const MEDIA = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf' };

/* ---------- 게임 자료 파일 저장 (GitHub data 브랜치) ---------- */
const FILE_RE = /^[\p{L}\p{N}_.-]{1,80}\.(png|jpe?g|webp|pdf)$/iu;
const mediaOf = n => MEDIA[(String(n).match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase()] || '';
const fileCache = new Map();   // "게임/이름" → { sha, buf }
const filePath = (game, name) => `files/${encodeURIComponent(game)}/${encodeURIComponent(name)}`;
async function listFiles(game, fresh) {
  await ensureBranch();
  const r = await gh(`/contents/files/${encodeURIComponent(game)}?ref=${encodeURIComponent(DATA_BRANCH)}${fresh ? '&t=' + Date.now() : ''}`);
  if (r.status === 404) return [];
  if (!r.ok) throw new Error('자료 목록을 읽지 못했어요 (' + r.status + ').');
  return ((await r.json()) || []).filter(x => x.type === 'file').map(x => ({ name: x.name, size: x.size, sha: x.sha }));
}
async function readFileBuf(game, name) {
  const key = game + '/' + name, c = fileCache.get(key);
  await ensureBranch();
  const r = await gh(`/contents/${filePath(game, name)}?ref=${encodeURIComponent(DATA_BRANCH)}`, { headers: {} });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('자료 파일을 읽지 못했어요 (' + r.status + ').');
  const j = await r.json();
  if (c && c.sha === j.sha) return c.buf;
  let buf = j.content ? Buffer.from(j.content, 'base64') : null;
  if (!buf || !buf.length) {   // 1MB가 넘는 파일은 내용이 비어서 온다 → blob으로 받기
    const br = await gh('/git/blobs/' + j.sha);
    if (!br.ok) throw new Error('자료 파일을 읽지 못했어요 (' + br.status + ').');
    buf = Buffer.from((await br.json()).content || '', 'base64');
  }
  fileCache.set(key, { sha: j.sha, buf });
  return buf;
}
async function writeFileBuf(game, name, buf, message) {
  await ensureBranch();
  const cur = await gh(`/contents/${filePath(game, name)}?ref=${encodeURIComponent(DATA_BRANCH)}`);
  const body = { message, content: buf.toString('base64'), branch: DATA_BRANCH };
  if (cur.ok) body.sha = (await cur.json()).sha;
  const r = await gh(`/contents/${filePath(game, name)}`, { method: 'PUT', body: JSON.stringify(body) });
  if (!r.ok) throw new Error('자료를 저장하지 못했어요 (' + r.status + ').');
  fileCache.delete(game + '/' + name);
}
async function deleteFile(game, name, message) {
  const cur = await gh(`/contents/${filePath(game, name)}?ref=${encodeURIComponent(DATA_BRANCH)}`);
  if (!cur.ok) return;
  const r = await gh(`/contents/${filePath(game, name)}`, { method: 'DELETE', body: JSON.stringify({ message, sha: (await cur.json()).sha, branch: DATA_BRANCH }) });
  if (!r.ok) throw new Error('자료를 지우지 못했어요 (' + r.status + ').');
  fileCache.delete(game + '/' + name);
}
const jobs = new Map();
setInterval(() => { const now = Date.now(); for (const [k, j] of jobs) if (now - j.at > 3600000) jobs.delete(k); }, 600000).unref();

/* ---------- HTTP ---------- */
function send(res, status, obj, headers = {}) {
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers));
  res.end(JSON.stringify(obj));
}
function readBody(req, limit = 2e6) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
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
      if (me && me.isAdmin) pending = members((await readCol('users')).data).filter(([, u]) => !norm(u).canView).length;
      return send(res, 200, me ? { loggedIn: true, name: me.name, username: me.username, canView: me.canView, canEdit: me.canEdit, isAdmin: me.isAdmin, isOwner: me.isOwner, id: me.id, color: me.color, palette: PALETTE, pending, ai: !!AI_KEY, providers: AI.available() } : { loggedIn: false });
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
        if (members(data).some(([, u]) => norm(u).username === username)) { dup = true; return false; }
        data[uid] = { username, name, color: freeColor(data), salt, hash, pwv: 1, canView: false, canEdit: false, createdAt: new Date().toISOString() };
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
      const entry = members(users).find(([, u]) => norm(u).username === username);
      if (!entry || !(await checkPw(pw, entry[1]))) { hit('ip:' + ip); hit('id:' + username); return send(res, 401, { message: '아이디 또는 비밀번호가 맞지 않아요.' }); }
      attempts.delete('id:' + username);
      return send(res, 200, { ok: true }, session({ uid: entry[0], pwv: entry[1].pwv || 1 }));
    }
    if (p === '/api/logout' && req.method === 'POST') return send(res, 200, { ok: true }, { 'Set-Cookie': cookie('', 0) });

    if (p === '/api/password' && req.method === 'POST') {
      if (!me || me.isOwner) return send(res, 403, { message: me ? '대표 관리자 비밀번호는 Render의 ADMIN_PASSWORD에서 바꿔 주세요.' : '로그인이 필요해요.' });
      const b = await readBody(req);
      if (String(b.next || '').length < PW_MIN) return send(res, 400, { message: `새 비밀번호는 ${PW_MIN}자 이상으로 정해 주세요.` });
      const users = (await readCol('users', true)).data;
      if (!(await checkPw(String(b.current || ''), users[me.id]))) return send(res, 401, { message: '지금 비밀번호가 맞지 않아요.' });
      const { salt, hash } = await hashPw(String(b.next));
      let pwv;
      await writeCol('users', data => { const u = data[me.id]; u.salt = salt; u.hash = hash; u.pwv = (u.pwv || 1) + 1; pwv = u.pwv; }, `비밀번호 변경 · ${me.name}`);
      return send(res, 200, { ok: true }, session({ uid: me.id, pwv }));
    }

    /* ----- 내 색 바꾸기 ----- */
    if ((p === '/api/color' || p === '/api/profile') && req.method === 'POST') {
      if (!me) return send(res, 401, { message: '로그인이 필요해요.' });
      const b = await readBody(req), patch = {};
      if (b.color !== undefined) { if (!COLOR_RE.test(b.color || '')) return send(res, 400, { message: '색 값이 올바르지 않아요.' }); patch.color = b.color; }
      if (b.name !== undefined) { const n = String(b.name).trim().slice(0, 30); if (!n) return send(res, 400, { message: '이름을 입력해 주세요.' }); patch.name = n; }
      await writeCol('users', data => { const key = me.isOwner ? OWNER_KEY : me.id; data[key] = Object.assign(data[key] || {}, patch); }, `내 정보 변경 · ${patch.name || me.name}`);
      return send(res, 200, Object.assign({ ok: true }, patch));
    }

    /* ----- 관리자: 회원 권한 ----- */
    if (p === '/api/admin/users' && req.method === 'GET') {
      if (!me || !me.isAdmin) return send(res, 403, { message: '관리자만 볼 수 있어요.' });
      const users = (await readCol('users', true)).data;
      return send(res, 200, { users: members(users).map(([id, u]) => publicUser(id, u)), palette: PALETTE });
    }
    const am = p.match(/^\/api\/admin\/users\/([\w-]+)$/);
    if (am && req.method === 'POST') {
      if (!me || !me.isAdmin) return send(res, 403, { message: '관리자만 할 수 있어요.' });
      const id = am[1];
      if (id === OWNER_KEY) return send(res, 404, { message: '없는 회원이에요.' });
      const b = await readBody(req);
      let temp = null, found = true, label = '', denied = '';
      if (b.action === 'reset') temp = String(crypto.randomInt(100000, 1000000));
      const reset = temp ? await hashPw(temp) : null;
      await writeCol('users', data => {
        const u = data[id];
        if (!u) { found = false; return false; }
        label = u.name;
        const n = norm(u);
        /* 지정된 관리자는: 본인·다른 관리자는 건드릴 수 없고, 관리자 지정도 못 한다 (대표 관리자만 가능) */
        if (!me.isOwner) {
          if (id === me.id) { denied = '본인 권한은 바꿀 수 없어요.'; return false; }
          if (n.canAdmin) { denied = '다른 관리자의 권한은 대표 관리자만 바꿀 수 있어요.'; return false; }
          if (b.admin !== undefined) { denied = '관리자 지정은 대표 관리자만 할 수 있어요.'; return false; }
        }
        if (b.action === 'perm') {
          let view = b.view !== undefined ? !!b.view : n.canView;
          let edit = b.edit !== undefined ? !!b.edit : n.canEdit;
          let admin = b.admin !== undefined ? !!b.admin : n.canAdmin;
          if (b.view === false) { edit = false; admin = false; }
          if (b.edit === false) admin = false;
          if (admin) { view = true; edit = true; }
          if (edit) view = true;
          u.canView = view; u.canEdit = edit; u.canAdmin = admin;
          u.permAt = new Date().toISOString();
          delete u.status; delete u.role; delete u.approvedAt;
          if (!u.username && u.email) u.username = u.email;
        } else if (b.action === 'color') { if (!COLOR_RE.test(b.color || '')) return false; u.color = b.color; }
        else if (b.action === 'delete') { delete data[id]; }
        else if (b.action === 'reset') { u.salt = reset.salt; u.hash = reset.hash; u.pwv = (u.pwv || 1) + 1; }
        else return false;
      }, `회원 권한 · ${b.action} · ${id} · ${me.name}`);
      if (denied) return send(res, 403, { message: denied });
      if (!found) return send(res, 404, { message: '없는 회원이에요.' });
      return send(res, 200, { ok: true, tempPassword: temp, name: label });
    }

    /* ----- 파일 읽기 (편집 권한 필요) ----- */
    if (p === '/api/extract' && req.method === 'POST') {
      if (!me || !me.canEdit) return send(res, 403, { message: me ? '파일 읽기는 편집 허용을 받은 사람만 할 수 있어요.' : '로그인이 필요해요.' });
      let b;
      try { b = await readBody(req, MAX_FILE * 1.4 + 1e5); } catch { return send(res, 413, { message: '파일이 너무 커요. 12MB 이하로 올려 주세요.' }); }
      const name = String(b.name || ''), ext = (name.match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();
      const buf = Buffer.from(String(b.data || ''), 'base64');
      if (!buf.length) return send(res, 400, { message: '빈 파일이에요.' });
      if (buf.length > MAX_FILE) return send(res, 413, { message: '파일이 너무 커요. 12MB 이하로 올려 주세요.' });
      if (ext === 'docx') return send(res, 200, { kind: 'docx', blocks: readDocx(buf) });
      const media = (/^image\/(png|jpeg|webp|gif)$/.test(b.type || '') ? b.type : null) || MEDIA[ext];
      if (!media) return send(res, 400, { message: '읽을 수 없는 파일 형식이에요. PNG·JPG·PDF·Word(docx)·엑셀·CSV를 올려 주세요.' });
      if (!AI_KEY) return send(res, 501, { message: '이미지·PDF 읽기가 아직 켜져 있지 않아요. 관리자가 Render에 AI API 키(ANTHROPIC_API_KEY 등)를 넣어야 해요.' });
      if (tooMany('ai:' + me.id, AI_LIMIT, 3600000)) return send(res, 429, { message: `AI 파일 읽기는 한 시간에 ${AI_LIMIT}개까지예요. 잠시 뒤 다시 해 주세요.` });
      hit('ai:' + me.id);
      const mode = b.mode === 'table' ? 'table' : 'source';
      const out = await aiRead(buf, media, mode);
      return send(res, 200, Object.assign({ kind: 'ai', mode }, out));
    }

    /* ----- 게임 자료 파일 (화면 캡처·PDF): data 브랜치 files/<게임>/<이름> ----- */
    const fm = p.match(/^\/api\/files\/([\w-]+)(?:\/([^/]+))?$/);
    if (fm) {
      if (!me || !me.canView) return send(res, 401, { message: '로그인이 필요해요.' });
      const game = fm[1], fname = fm[2] ? decodeURIComponent(fm[2]) : '';
      if (fname && !FILE_RE.test(fname)) return send(res, 400, { message: '파일 이름이 올바르지 않아요.' });
      if (req.method === 'GET' && !fname) return send(res, 200, { files: await listFiles(game) });
      if (req.method === 'GET') {
        const buf = await readFileBuf(game, fname);
        if (!buf) return send(res, 404, { message: '없는 파일이에요.' });
        res.writeHead(200, { 'Content-Type': mediaOf(fname), 'Cache-Control': 'private, max-age=3600' }); return res.end(buf);
      }
      if (!me.canEdit) return send(res, 403, { message: '편집 허용을 받은 사람만 할 수 있어요.' });
      if (req.method === 'POST' && !fname) {
        let b; try { b = await readBody(req, 6e6); } catch { return send(res, 413, { message: '파일이 너무 커요. 4MB 이하로 올려 주세요.' }); }
        const name = String(b.name || '').trim();
        if (!FILE_RE.test(name) || !mediaOf(name)) return send(res, 400, { message: '이미지(PNG·JPG·WEBP)나 PDF만 올릴 수 있어요. 파일 이름에는 영문·숫자·한글·- _ . 만 써 주세요.' });
        const buf = Buffer.from(String(b.data || ''), 'base64');
        if (!buf.length || buf.length > 4.2e6) return send(res, 413, { message: '파일이 너무 커요. 4MB 이하로 올려 주세요.' });
        await writeFileBuf(game, name, buf, `자료 올림 · ${game}/${name} · ${me.name}`);
        return send(res, 200, { ok: true, files: await listFiles(game, true) });
      }
      if (req.method === 'DELETE' && fname) {
        await deleteFile(game, fname, `자료 삭제 · ${game}/${fname} · ${me.name}`);
        return send(res, 200, { ok: true, files: await listFiles(game, true) });
      }
    }

    /* ----- AI 자동 실행: 작업을 맡기고(job) 결과를 나중에 받는다 ----- */
    if (p === '/api/ai/run' && req.method === 'POST') {
      if (!me || !me.canEdit) return send(res, 403, { message: '편집 허용을 받은 사람만 할 수 있어요.' });
      const b = await readBody(req, 3e6);
      const prov = String(b.provider || '');
      if (!AI.available()[prov] || prov === 'deepl') return send(res, 400, { message: `${AI.NAMES[prov] || 'AI'} API 키가 없어요.` });
      if (tooMany('ai:' + me.id, AI_LIMIT, 3600000)) return send(res, 429, { message: `AI 호출은 한 사람이 한 시간에 ${AI_LIMIT}번까지예요. 잠시 뒤 다시 해 주세요.` });
      hit('ai:' + me.id);
      const id = crypto.randomBytes(8).toString('hex');
      const job = { status: 'running', at: Date.now(), user: me.id };
      jobs.set(id, job);
      (async () => {
        const files = [];
        for (const f of (Array.isArray(b.files) ? b.files : []).slice(0, 20)) {
          const buf = FILE_RE.test(String(f)) ? await readFileBuf(String(b.game || ''), String(f)) : null;
          if (buf) files.push({ media: mediaOf(f), b64: buf.toString('base64'), name: f });
        }
        return AI.call(prov, { system: String(b.system || ''), text: String(b.prompt || ''), files, maxTokens: Math.min(Number(b.maxTokens) || 32000, 64000) });
      })().then(out => Object.assign(job, { status: 'done', text: out.text, cut: out.cut, model: out.model }), e => Object.assign(job, { status: 'error', message: e.message }));
      return send(res, 200, { job: id });
    }
    const jm = p.match(/^\/api\/ai\/job\/(\w+)$/);
    if (jm && req.method === 'GET') {
      const job = jobs.get(jm[1]);
      if (!me || !job || job.user !== me.id) return send(res, 404, { message: '작업을 찾지 못했어요. 서버가 다시 시작됐을 수 있어요. 다시 실행해 주세요.' });
      return send(res, 200, job);
    }
    if (p === '/api/ai/deepl' && req.method === 'POST') {
      if (!me || !me.canEdit) return send(res, 403, { message: '편집 허용을 받은 사람만 할 수 있어요.' });
      const b = await readBody(req);
      return send(res, 200, { texts: await AI.deepl((b.texts || []).map(String).slice(0, 500), String(b.lang || 'en')) });
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
