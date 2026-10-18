'use strict';
// 패들렛 연결: 학생의 광고문구를 그 학생의 섹션(소회의실)에 글로 올린다. 외부 패키지 없이 fetch만 쓴다.
// Padlet 공개 API(https://docs.padlet.dev) — 인증은 X-API-KEY 헤더, 글 올리기는 POST /v1/boards/{boardId}/posts.

const BASE = (process.env.PADLET_API_BASE || 'https://api.padlet.dev').replace(/\/+$/, '');
const BOARD_RE = /^[A-Za-z0-9_-]{8,40}$/;
const SECTION_RE = /^sec_[A-Za-z0-9_-]{6,40}$/;
const LINK_RE = /^https:\/\/padlet\.com\/[^\s]{5,300}$/;

// 교사가 붙여 넣은 목록 한 줄: "번호  섹션ID(sec_…)  소회의실 링크(https://padlet.com/…)" (섹션ID, 링크는 둘 중 하나만 있어도 된다)
function parseRooms(text) {
  const rooms = {}, skipped = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const tok = line.split(/[\t,;]+|\s+/).map((t) => t.trim()).filter(Boolean);
    const no = tok.find((t) => /^\d{1,3}$/.test(t));
    const section = tok.find((t) => SECTION_RE.test(t)) || '';
    const link = tok.find((t) => LINK_RE.test(t)) || '';
    if (!no || (!section && !link)) { if (!/번호|section|링크/i.test(line)) skipped.push(line.slice(0, 60)); continue; }
    rooms[String(parseInt(no, 10))] = { section, link };
  }
  return { rooms, skipped };
}

async function call(method, urlPath, key, body, ctype) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetch(BASE + urlPath, {
      method, signal: ctl.signal,
      // Padlet API는 JSON:API 규격이라 Accept 가 반드시 application/vnd.api+json 이어야 한다(아니면 406).
      headers: Object.assign({ 'X-API-KEY': key, accept: 'application/vnd.api+json' }, body ? { 'content-type': ctype || 'application/vnd.api+json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
    });
    let json = null; let text = '';
    try { text = await res.text(); json = JSON.parse(text); } catch (e) { /* 본문이 JSON이 아님 */ }
    return { status: res.status, ok: res.ok, json, text: text.slice(0, 400) };
  } catch (e) {
    return { status: 0, ok: false, json: null, text: e.name === 'AbortError' ? '시간 초과' : String(e.message || e).slice(0, 200) };
  } finally { clearTimeout(timer); }
}

function explain(r) {
  if (r.status === 0) return '패들렛 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.';
  if (r.status === 401 || r.status === 403) return '패들렛 API 키 또는 권한에 문제가 있어요. 선생님께 알려 주세요.';
  if (r.status === 404) return '패들렛 보드나 섹션을 찾지 못했어요. 선생님께 알려 주세요.';
  if (r.status === 429) return '잠시 뒤에 다시 올려 주세요. (요청이 너무 많아요)';
  return `패들렛에 올리지 못했어요. (오류 ${r.status}) 선생님께 알려 주세요.`;
}

// 보드를 읽어 키·보드 번호가 맞는지만 확인한다(글은 올리지 않는다).
async function test(key, boardId) {
  if (!key) return { ok: false, message: '패들렛 API 키를 먼저 저장해 주세요.' };
  if (!BOARD_RE.test(boardId || '')) return { ok: false, message: '보드 ID 형식이 올바르지 않아요. (예: board_ 로 시작하는 글자)' };
  const r = await call('GET', '/v1/boards/' + encodeURIComponent(boardId), key);
  if (r.ok) return { ok: true, message: '연결됐어요.' };
  return { ok: false, status: r.status, message: explain(r).replace(' 선생님께 알려 주세요.', ''), detail: r.text };
}

async function createPost({ key, boardId, section, subject, body, imageUrl }) {
  const content = {};
  if (subject) content.subject = String(subject).slice(0, 200);
  if (body) content.body = String(body).slice(0, 5000);
  if (imageUrl) content.attachment = { url: imageUrl };
  const payload = { data: { type: 'post', attributes: { content }, relationships: { section: { data: { id: section } } } } };
  let r = await call('POST', '/v1/boards/' + encodeURIComponent(boardId) + '/posts', key, payload);
  if (r.status === 415) r = await call('POST', '/v1/boards/' + encodeURIComponent(boardId) + '/posts', key, payload, 'application/json');   // Content-Type 을 받아들이지 않으면 한 번 더
  if (r.ok) return { ok: true, id: (r.json && r.json.data && r.json.data.id) || '' };
  return { ok: false, status: r.status, message: explain(r), detail: r.text };
}

module.exports = { parseRooms, test, createPost, BOARD_RE, SECTION_RE, LINK_RE };
