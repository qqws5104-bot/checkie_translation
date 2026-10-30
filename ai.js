/*
 * ai.js — AI 회사별 API 호출 (외부 패키지 없음)
 *
 * 환경 변수 (넣은 것만 켜진다)
 *   ANTHROPIC_API_KEY  Claude   · ANTHROPIC_MODEL (비우면 최신 Sonnet 자동)
 *   OPENAI_API_KEY     ChatGPT  · OPENAI_MODEL    (비우면 최신 GPT 자동)
 *   GEMINI_API_KEY     Gemini   · GEMINI_MODEL    (비우면 최신 Pro 자동)
 *   DEEPL_API_KEY      DeepL (무료 키는 끝이 :fx)
 *   *_BASE_URL         테스트용 주소 바꾸기 (ANTHROPIC_BASE_URL, OPENAI_BASE_URL, GEMINI_BASE_URL, DEEPL_BASE_URL)
 */
const env = process.env;
const KEYS = { claude: env.ANTHROPIC_API_KEY || '', openai: env.OPENAI_API_KEY || '', gemini: env.GEMINI_API_KEY || '', deepl: env.DEEPL_API_KEY || '' };
const BASE = {
  claude: (env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, ''),
  openai: (env.OPENAI_BASE_URL || 'https://api.openai.com').replace(/\/$/, ''),
  gemini: (env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com').replace(/\/$/, ''),
  deepl: (env.DEEPL_BASE_URL || (KEYS.deepl.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com')).replace(/\/$/, ''),
};
const NAMES = { claude: 'Claude', openai: 'ChatGPT', gemini: 'Gemini', deepl: 'DeepL' };
const available = () => Object.fromEntries(Object.entries(KEYS).map(([k, v]) => [k, !!v]));

/* ---------- 모델 고르기: 환경 변수 → 목록에서 최신 ---------- */
const picked = {};
const verOf = id => { const m = String(id).match(/(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : 0; };
async function model(p) {
  const fixed = { claude: env.ANTHROPIC_MODEL, openai: env.OPENAI_MODEL, gemini: env.GEMINI_MODEL }[p];
  if (fixed) return fixed;
  if (picked[p]) return picked[p];
  try {
    if (p === 'claude') {
      const r = await fetch(BASE.claude + '/v1/models?limit=100', { headers: { 'x-api-key': KEYS.claude, 'anthropic-version': '2023-06-01' } });
      if (r.ok) { const ids = ((await r.json()).data || []).map(x => x.id); picked[p] = ids.find(i => /sonnet/i.test(i)) || ids[0]; }
    } else if (p === 'openai') {
      const r = await fetch(BASE.openai + '/v1/models', { headers: { Authorization: 'Bearer ' + KEYS.openai } });
      if (r.ok) {
        const ids = ((await r.json()).data || []).map(x => x.id)
          .filter(i => /^gpt-\d/.test(i) && !/mini|nano|audio|realtime|search|transcribe|tts|image|codex|instruct|chat|\d{4}-\d{2}-\d{2}|preview|oss/.test(i));
        ids.sort((a, b) => verOf(b) - verOf(a) || a.length - b.length);
        picked[p] = ids[0];
      }
    } else if (p === 'gemini') {
      const r = await fetch(`${BASE.gemini}/v1beta/models?key=${encodeURIComponent(KEYS.gemini)}&pageSize=200`);
      if (r.ok) {
        const ms = ((await r.json()).models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
          .map(m => m.name.replace(/^models\//, '')).filter(n => /^gemini-[\d.]+-pro$/.test(n));
        ms.sort((a, b) => verOf(b) - verOf(a));
        picked[p] = ms[0];
      }
    }
  } catch { /* 아래 기본값 */ }
  return picked[p] || { claude: 'claude-sonnet-4-5', openai: 'gpt-5', gemini: 'gemini-2.5-pro' }[p];
}

function fail(p, status, msg) {
  if (status === 401 || status === 403) return new Error(`${NAMES[p]} API 키가 올바르지 않음. 관리자에게 알리기.`);
  if (status === 429 || status === 529 || status === 503) return new Error(`${NAMES[p]}가 지금 바쁨(${status}). 1분쯤 뒤에 다시 하기.`);
  if (status === 404) { delete picked[p]; return new Error(`${NAMES[p]} 모델을 찾지 못함. 관리자가 모델 이름을 확인 필요.`); }
  return new Error(`${NAMES[p]} 호출이 실패함 (${status}${msg ? ': ' + String(msg).slice(0, 200) : ''}).`);
}

/* files: [{ media: 'image/png' | 'application/pdf', b64, name }] */
async function call(p, { system, text, files = [], maxTokens = 32000 }) {
  if (!KEYS[p] || p === 'deepl') throw new Error(`${NAMES[p] || p} API 키가 없음.`);
  if (p === 'claude') {
    const content = [...files.map(f => f.media === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: f.media, data: f.b64 } }
      : { type: 'image', source: { type: 'base64', media_type: f.media, data: f.b64 } }), { type: 'text', text }];
    const body = { model: await model(p), max_tokens: maxTokens, messages: [{ role: 'user', content }] };
    if (system) body.system = system;
    const r = await fetch(BASE.claude + '/v1/messages', { method: 'POST', headers: { 'x-api-key': KEYS.claude, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw fail(p, r.status, j.error && j.error.message);
    return { text: (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n'), cut: j.stop_reason === 'max_tokens', model: j.model };
  }
  if (p === 'openai') {
    const content = [{ type: 'text', text }, ...files.map(f => f.media === 'application/pdf'
      ? { type: 'file', file: { filename: f.name || 'file.pdf', file_data: `data:${f.media};base64,${f.b64}` } }
      : { type: 'image_url', image_url: { url: `data:${f.media};base64,${f.b64}` } })];
    const messages = [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content }];
    const r = await fetch(BASE.openai + '/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + KEYS.openai, 'content-type': 'application/json' }, body: JSON.stringify({ model: await model(p), messages, max_completion_tokens: maxTokens }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw fail(p, r.status, j.error && j.error.message);
    const c = (j.choices || [])[0] || {};
    return { text: (c.message && c.message.content) || '', cut: c.finish_reason === 'length', model: j.model };
  }
  if (p === 'gemini') {
    const parts = [{ text }, ...files.map(f => ({ inline_data: { mime_type: f.media, data: f.b64 } }))];
    const body = { contents: [{ role: 'user', parts }], generationConfig: { maxOutputTokens: maxTokens } };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    const m = await model(p);
    const r = await fetch(`${BASE.gemini}/v1beta/models/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(KEYS.gemini)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw fail(p, r.status, j.error && j.error.message);
    const c = (j.candidates || [])[0] || {};
    return { text: ((c.content && c.content.parts) || []).map(x => x.text || '').join(''), cut: c.finishReason === 'MAX_TOKENS', model: m };
  }
  throw new Error('알 수 없는 AI임.');
}

const DEEPL_LANG = { en: 'EN-US', ja: 'JA', zh: 'ZH-HANS' };
async function deepl(texts, lang) {
  if (!KEYS.deepl) throw new Error('DeepL API 키가 없음.');
  const out = [];
  for (let i = 0; i < texts.length; i += 50) {
    const r = await fetch(BASE.deepl + '/v2/translate', { method: 'POST', headers: { Authorization: 'DeepL-Auth-Key ' + KEYS.deepl, 'content-type': 'application/json' }, body: JSON.stringify({ text: texts.slice(i, i + 50), source_lang: 'KO', target_lang: DEEPL_LANG[lang] || 'EN-US' }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw fail('deepl', r.status, j.message);
    (j.translations || []).forEach(x => out.push(x.text));
  }
  return out;
}

/* 아무 AI나 하나 (이미지·PDF 읽기용): Claude → ChatGPT → Gemini */
const anyVision = () => ['claude', 'openai', 'gemini'].find(p => KEYS[p]) || null;

module.exports = { available, call, deepl, anyVision, NAMES };
