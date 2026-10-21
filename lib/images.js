'use strict';
// Gemini 이미지 생성 + 공개 저장소(Supabase Storage) 업로드. 패들렛은 이미지 주소(URL)만 받으므로 공개 주소가 필요하다.
const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_IMAGE_MODEL = 'gemini-nano-banana-2.1';
const BUCKET = 'ml-poster';

// 응답 어디에 있든 base64 이미지 조각을 찾는다 (응답 모양이 모델·API마다 조금씩 달라서).
function findImage(node, depth) {
  depth = depth || 0;
  if (!node || typeof node !== 'object' || depth > 12) return null;
  if (Array.isArray(node)) { for (const x of node) { const r = findImage(x, depth + 1); if (r) return r; } return null; }
  const mime = node.mimeType || node.mime_type || '';
  const data = node.data;
  if (typeof data === 'string' && data.length > 200 && /^image\//.test(mime)) return { mime, b64: data };
  for (const k of Object.keys(node)) { const r = findImage(node[k], depth + 1); if (r) return r; }
  return null;
}

async function post(url, key, body, fetchFn) {
  const r = await (fetchFn || fetch)(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body) });
  let j = null; const t = await r.text(); try { j = JSON.parse(t); } catch (e) { /* 본문이 JSON이 아님 */ }
  return { status: r.status, ok: r.ok, json: j, text: t };
}

function explain(res) {
  const m = (res.json && res.json.error && res.json.error.message) || res.text || '';
  const s = String(m).slice(0, 200);
  if (res.status === 429 || /quota|RESOURCE_EXHAUSTED/i.test(s)) return '이미지 생성 한도에 걸렸어요. 선생님께 알려 주세요.';
  if (res.status === 400 && /billing|free tier|not available/i.test(s)) return '이미지 생성에는 결제가 연결된 Gemini API 키가 필요해요. 선생님께 알려 주세요.';
  if (res.status === 401 || res.status === 403) return 'Gemini API 키가 올바르지 않거나 권한이 없어요. 선생님께 알려 주세요.';
  return '이미지를 만들지 못했어요. (' + res.status + ') ' + s;
}

// 반환: { ok:true, mime, buf } | { ok:false, message }
async function generate({ key, model, prompt, fetchFn, base }) {
  if (!key) return { ok: false, message: 'Gemini API 키가 아직 없어요. 선생님께 알려 주세요.' };
  const B = base || BASE;
  const m = model || DEFAULT_IMAGE_MODEL;
  const tries = [
    () => post(`${B}/models/${encodeURIComponent(m)}:generateContent`, key, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '3:4' } },
    }, fetchFn),
    () => post(`${B}/interactions`, key, {
      model: m, input: [{ type: 'text', text: prompt }],
      response_format: { type: 'image', mime_type: 'image/png', aspect_ratio: '3:4', image_size: '1K' },
    }, fetchFn),
  ];
  let last = null;
  for (const t of tries) {
    let res;
    try { res = await t(); } catch (e) { last = { status: 0, text: String(e && e.message || e) }; continue; }
    const img = res.ok ? findImage(res.json) : null;
    if (img) return { ok: true, mime: img.mime, buf: Buffer.from(img.b64, 'base64') };
    last = res;
    if (res.status === 401 || res.status === 403 || res.status === 429) break;   // 다른 방식으로 다시 불러도 소용없는 오류
  }
  if (last && last.ok) return { ok: false, message: '이미지가 만들어지지 않았어요. 안전 기준에 걸렸을 수 있어요. 표현을 바꿔 다시 해 보세요.' };
  return { ok: false, message: explain(last || { status: 0, text: '' }) };
}

// 공개 버킷에 올리고 공개 주소를 돌려준다. 저장소를 못 쓰면 null.
async function save({ buf, mime, name, env, fetchFn }) {
  const url = env.SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const f = fetchFn || fetch;
  const ext = /jpeg|jpg/.test(mime) ? 'jpg' : /webp/.test(mime) ? 'webp' : 'png';
  const file = `${name}.${ext}`;
  const r = await f(`${url}/storage/v1/object/${BUCKET}/${file}`, { method: 'POST', headers: { authorization: 'Bearer ' + key, apikey: key, 'content-type': mime || 'image/png', 'x-upsert': 'true' }, body: buf });
  if (!r.ok) return null;
  return `${url}/storage/v1/object/public/${BUCKET}/${file}`;
}

module.exports = { generate, save, findImage, DEFAULT_IMAGE_MODEL, BUCKET };
