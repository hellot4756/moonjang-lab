'use strict';
// 문장 연습실 서버. 외부 패키지 없이 Node.js(18 이상)만으로 동작한다.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const ROOT = __dirname;

// ---------- .env 읽기 (없으면 처음 한 번 만든다) ----------
function loadEnv() {
  const file = path.join(ROOT, '.env');
  let created = null;
  if (!fs.existsSync(file) && !process.env.TEACHER_PASSWORD) {
    const pw = crypto.randomBytes(4).toString('hex');
    const text = [
      '# 문장 연습실 설정 파일',
      '# 교사 화면 비밀번호 (원하는 값으로 바꾸세요)',
      'TEACHER_PASSWORD=' + pw,
      '# AI 판정에 쓸 API 키 (교사 화면의 설정에서 입력해도 됩니다)',
      'ANTHROPIC_API_KEY=',
      '# 접속 포트',
      'PORT=3000',
      '',
    ].join('\n');
    try { fs.writeFileSync(file, text); created = pw; } catch (e) { /* 읽기 전용이면 무시 */ }
  }
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
      if (!m || line.trim().startsWith('#')) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (process.env[m[1]] === undefined || process.env[m[1]] === '') process.env[m[1]] = v;
    }
  } catch (e) { /* .env 없음 */ }
  return created;
}
const createdPassword = loadEnv();

const PADLET = require('./lib/padlet');
const PosterLib = require('./public/poster.js');
const { Store, normName, normSid, classFromSid, numberFromSid, finalVerdict, SEAT_COLS } = require('./lib/store');
const { Grader } = require('./lib/grader');
const C = require('./lib/conditions');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const TEACHER_PASSWORD = process.env.TEACHER_PASSWORD || '';
const DEFAULT_MODEL = 'claude-sonnet-5-5';

const store = new Store(DATA_DIR);
C.init(path.join(DATA_DIR, 'conditions.json'));
const grader = new Grader(() => ({
  apiKey: store.settings.apiKey || process.env.ANTHROPIC_API_KEY || '',
  model: store.settings.model || process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
  baseUrl: process.env.ANTHROPIC_BASE_URL || '',
}));

// ---------- 토큰 ----------
const b64u = (buf) => Buffer.from(buf).toString('base64url');
function sign(payload) {
  const body = b64u(JSON.stringify(payload));
  const sig = b64u(crypto.createHmac('sha256', store.secret).update(body).digest());
  return body + '.' + sig;
}
function verify(token) {
  if (typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const want = crypto.createHmac('sha256', store.secret).update(body).digest();
  let got;
  try { got = Buffer.from(sig, 'base64url'); } catch (e) { return null; }
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  let p;
  try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch (e) { return null; }
  if (!p.exp || p.exp < Date.now()) return null;
  return p;
}
const HOUR = 3600 * 1000;

// ---------- 요청 처리 도구 ----------
const hits = new Map();
function rateLimited(key, max, windowMs) {
  const now = Date.now();
  let h = hits.get(key);
  if (!h || h.reset < now) { h = { n: 0, reset: now + windowMs }; hits.set(key, h); }
  h.n++;
  if (hits.size > 5000) { for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }
  return h.n > max;
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, '보낸 내용이 너무 커요.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(new HttpError(400, '요청 형식이 올바르지 않아요.')); }
    });
    req.on('error', reject);
  });
}

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

function sendFile(res, status, name, text, type) {
  res.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
    'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
  });
  res.end(text);
}

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
}

let padletLastError = '';   // 마지막 패들렛 오류(교사 화면에서 확인용, 저장하지 않음)
const presence = new Map(); // sid -> 마지막 접속 시각
const activity = new Map(); // sid -> { typingAt, draftLen, challengeAt }  (교실 현황판용, 저장하지 않음)

function studentAuth(req) {
  const p = verify(bearer(req));
  if (!p || p.r !== 's') throw new HttpError(401, '다시 입장해 주세요.');
  const st = store.studentBySid(p.sid);
  if (!st) throw new HttpError(401, '명단에서 찾을 수 없어요. 다시 입장해 주세요.');
  presence.set(st.sid, Date.now());
  return st;
}

function teacherAuth(req) {
  const p = verify(bearer(req));
  if (!p || p.r !== 't') throw new HttpError(401, '교사 비밀번호로 다시 로그인해 주세요.');
}

const rnd = () => crypto.randomInt(0, 1e9) / 1e9;
const clip = (s, n) => (typeof s === 'string' ? s.trim().slice(0, n) : '');

// ---------- 집계 ----------
function periodStart(period) {
  const now = new Date();
  if (period === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (period === '7d') return Date.now() - 7 * 24 * HOUR;
  return 0;
}

// 문법은 맞았는데 교사가 아직 주제를 판단하지 않은 기록
function topicTodo(r) { return finalVerdict(r) === 'correct' && !r.topicJudge; }

function needsReview(r) {
  return (r.flagged || r.needsReview) && !r.override && !r.reviewed;
}

function statsMap(since) {
  const m = new Map();
  for (const r of store.records) {
    if (r.ts < since) continue;
    let s = m.get(r.sid);
    if (!s) { s = { tries: 0, correct: 0, incorrect: 0, pending: 0, review: 0, topicTodo: 0, topicOk: 0, topicNo: 0, fb: 0, last: 0 }; m.set(r.sid, s); }
    const v = finalVerdict(r);
    s.tries++;
    if (v === 'correct') s.correct++;
    else if (v === 'incorrect') s.incorrect++;
    else s.pending++;
    if (needsReview(r)) s.review++;
    if (topicTodo(r)) s.topicTodo++;
    if (r.topicJudge === 'ok') s.topicOk++; else if (r.topicJudge === 'no') s.topicNo++;
    if (r.tfeedback) s.fb++;
    if (r.ts > s.last) s.last = r.ts;
  }
  return m;
}

// 이 학생의 패들렛 방: 번호로 찾는다(학생이 보낸 값은 쓰지 않는다)
function padletRoom(st) {
  const cfg = (store.settings.padlet || {})[st.cls];
  const room = cfg && cfg.rooms ? cfg.rooms[String(st.no)] : null;
  return { cfg, room };
}
function padletFor(st) {
  const { cfg, room } = padletRoom(st);
  return {
    post: !!(store.settings.padletApiKey && cfg && cfg.boardId && room && room.section),
    link: (room && room.link) || '',
  };
}

function myHistory(sid, limit) {
  const out = [];
  for (let i = store.records.length - 1; i >= 0 && out.length < limit; i--) {
    const r = store.records[i];
    if (r.sid !== sid) continue;
    out.push({
      id: r.id, ts: r.ts, attempt: r.attempt, sentence: r.sentence,
      verdict: finalVerdict(r), flagged: !!r.flagged,
      topicJudge: r.topicJudge || '', tfeedback: r.tfeedback || '', tfeedbackAt: r.tfeedbackAt || 0, padletAt: r.padletAt || 0,
      comp: r.compLabel, struct: r.structLabel, topic: r.topicLabel,
    });
  }
  return out;
}

function recentConditions(sid) {
  const comps = [], structs = [], topics = [];
  const seen = new Set();
  for (let i = store.records.length - 1; i >= 0 && seen.size < 3; i--) {
    const r = store.records[i];
    if (r.sid !== sid || seen.has(r.cid)) continue;
    seen.add(r.cid);
    comps.push(r.comp); structs.push(r.struct); topics.push(r.topic);
  }
  return { comps, structs, topics };
}

function teacherView(r) {
  return Object.assign({}, r, { final: finalVerdict(r), needsReviewNow: !!needsReview(r) });
}

function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCsv(rows) {
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

function lanUrls() {
  const urls = [];
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const a of ifs[name] || []) {
      if (a.family === 'IPv4' && !a.internal) urls.push(`http://${a.address}:${PORT}`);
    }
  }
  return urls;
}

function maskKey(k) {
  if (!k) return '';
  return k.length <= 10 ? '********' : k.slice(0, 7) + '...' + k.slice(-4);
}

function teacherInfo() {
  const cfg = grader.getConfig();
  const own = !!store.settings.apiKey;
  return {
    urls: lanUrls(),
    port: PORT,
    ai: {
      configured: !!cfg.apiKey,
      model: cfg.model,
      keyHint: maskKey(cfg.apiKey),
      keySource: own ? 'settings' : (process.env.ANTHROPIC_API_KEY ? 'env' : ''),
    },
    settings: {
      level: store.settings.level,
      open: store.settings.open,
      revealAfter: store.settings.revealAfter,
      model: store.settings.model,
      aiMode: store.settings.aiMode === 'off' ? 'off' : 'on',
      poster: store.settings.poster !== false,
      topicChoice: store.settings.topicChoice !== false,
      padletTemplate: store.settings.padletTemplate || '',
      padlet: {
        keySet: !!store.settings.padletApiKey, keyHint: maskKey(store.settings.padletApiKey || ''), lastError: padletLastError,
        classes: Object.fromEntries(Object.entries(store.settings.padlet || {}).map(([c, v]) => [c, {
          boardId: v.boardId || '', rooms: Object.keys(v.rooms || {}).length,
          withSection: Object.values(v.rooms || {}).filter((x) => x.section).length, withLink: Object.values(v.rooms || {}).filter((x) => x.link).length,
        }])),
      },
    },
    posters: store.posters.length,
    students: store.students.length,
    records: store.records.length,
    counts: C.counts(),
    conditionsCustomized: C.isCustomized(),
  };
}

// ---------- 명단 가져오기 ----------
function parseRoster(text, defaultCls) {
  const entries = [];
  const skipped = [];
  const seen = new Set();
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const tokens = line.split(/[\t,;]+|\s+/).map((t) => t.trim()).filter(Boolean);
    const sidTok = tokens.find((t) => /^\d{3,10}$/.test(t));
    if (!sidTok) { if (!/학번|이름/.test(line)) skipped.push(line); continue; }
    const name = tokens.filter((t) => t !== sidTok).join('');
    if (!name || name.length > 20) { skipped.push(line); continue; }
    const sid = normSid(sidTok);
    if (seen.has(sid)) { skipped.push(line + ' (중복 학번)'); continue; }
    seen.add(sid);
    const cls = classFromSid(sid) || defaultCls || '미지정';
    entries.push({ sid, name, cls: defaultCls && !classFromSid(sid) ? defaultCls : cls, no: numberFromSid(sid) });
  }
  return { entries, skipped };
}

// ---------- 판정 결과를 기록에 반영 ----------
function resultFields(out) {
  if (out.ok) {
    const r = out.result;
    return {
      verdict: r.verdict, checks: r.checks, analysis: r.analysis, tip: r.tip,
      example: r.example, confidence: r.confidence,
      needsReview: r.confidence === 'low', pendingReason: null, manual: false,
    };
  }
  return {
    verdict: 'pending', checks: null, analysis: '', tip: '', example: '',
    confidence: '', needsReview: true, pendingReason: out.message || 'AI 판정을 하지 못했어요.',
  };
}

// ---------- 라우트 ----------
async function handleApi(req, res, pathname, query) {
  const ip = req.socket.remoteAddress || '';
  const method = req.method;

  // ----- 학생 -----
  if (method === 'POST' && pathname === '/api/login') {
    if (rateLimited('login:' + ip, 40, 60 * 1000)) throw new HttpError(429, '잠시 후 다시 시도해 주세요.');
    const b = await readBody(req, 4096);
    if (!store.settings.open) throw new HttpError(403, '지금은 입장할 수 없어요. 선생님이 수업을 열면 들어올 수 있어요.');
    const st = store.findStudent(b.sid, b.name);
    if (!st) throw new HttpError(401, '명단에 없는 학번 또는 이름이에요. 다시 확인해 주세요.');
    presence.set(st.sid, Date.now());
    return send(res, 200, {
      token: sign({ r: 's', sid: st.sid, exp: Date.now() + 12 * HOUR }),
      student: { sid: st.sid, name: st.name, cls: st.cls, no: st.no },
    });
  }

  if (method === 'GET' && pathname === '/api/me') {
    const st = studentAuth(req);
    const sm = statsMap(0).get(st.sid) || { tries: 0, correct: 0 };
    return send(res, 200, {
      student: { sid: st.sid, name: st.name, cls: st.cls, no: st.no },
      stats: { tries: sm.tries, correct: sm.correct },
      history: myHistory(st.sid, 40),
      open: store.settings.open,
      poster: store.settings.poster !== false,
      topicChoice: store.settings.topicChoice !== false,
      padletTemplate: store.settings.padletTemplate || '',
      padlet: padletFor(st),
    });
  }

  if (method === 'POST' && pathname === '/api/challenge') {
    const st = studentAuth(req);
    if (!store.settings.open) throw new HttpError(403, '지금은 수업이 닫혀 있어요.');
    // 학생별 난이도: 하 → 짜임은 쉬운 것만, 성분 개수는 가장 적게 / 상 → 기본 조건만, 성분 개수는 가장 많게
    const own = st.level === 'easy' || st.level === 'basic' ? st.level : '';
    const ids = C.draw(own || store.settings.level, rnd, recentConditions(st.sid), own === 'easy' ? 'min' : own === 'basic' ? 'max' : '');
    const resolved = C.resolve(ids);
    const token = sign({ r: 'c', sid: st.sid, ids, n: store.newId(), exp: Date.now() + 4 * HOUR });
    activity.set(st.sid, { typingAt: 0, draftLen: 0, challengeAt: Date.now() });
    const choice = store.settings.topicChoice !== false;
    return send(res, 200, {
      token, conditions: C.publicView(resolved),
      topicChoice: choice,
      topicList: choice ? C.snapshot().topics.filter((x) => !x.off).map((x) => x.label) : [],
    });
  }

  // 학생이 문장을 쓰고 있는지(현황판의 '입력 중') 알려 주는 신호. 글 내용은 보내지 않고 글자 수만 보낸다.
  if (method === 'POST' && pathname === '/api/typing') {
    const st = studentAuth(req);
    const b = await readBody(req, 512);
    const n = Math.max(0, Math.min(1000, parseInt(b.n, 10) || 0));
    if (rateLimited('typing:' + st.sid, 30, 60 * 1000)) return send(res, 200, { ok: true });
    const a = activity.get(st.sid) || { typingAt: 0, draftLen: 0, challengeAt: 0 };
    a.draftLen = n; a.typingAt = n > 0 ? Date.now() : 0;
    activity.set(st.sid, a);
    return send(res, 200, { ok: true });
  }

  // 학생의 광고문구를 그 학생 번호의 패들렛 섹션(소회의실)에 글로 올린다. 올릴 곳은 서버가 번호로 정하고, 글도 서버의 기록으로 만든다.
  if (method === 'POST' && pathname === '/api/padlet/post') {
    const st = studentAuth(req);
    const b = await readBody(req, 4096);
    const { cfg, room } = padletRoom(st);
    if (!store.settings.padletApiKey || !cfg || !cfg.boardId || !room || !room.section) throw new HttpError(400, '내 패들렛 방이 아직 연결되지 않았어요. 선생님께 알려 주세요.');
    if (rateLimited('padlet:' + st.sid, 6, 60 * 1000)) throw new HttpError(429, '너무 빨리 올리고 있어요. 잠시 뒤에 다시 해 주세요.');
    const rec = store.getRecord(String(b.id || ''));
    if (!rec || rec.sid !== st.sid) throw new HttpError(404, '올릴 문장을 찾지 못했어요.');
    if (finalVerdict(rec) === 'incorrect') throw new HttpError(400, '문법 조건을 맞힌 문장만 올릴 수 있어요.');
    if (rec.padletAt && !b.again) return send(res, 200, { ok: true, already: true, at: rec.padletAt });
    const text = PosterLib.fillTemplate(store.settings.padletTemplate, {
      '이름': st.name, '학번': st.sid, '반': st.cls, '광고문구': rec.sentence, '성분조건': rec.compLabel, '짜임조건': rec.structLabel, '주제': rec.topicLabel,
    });
    const out = await PADLET.createPost({ key: store.settings.padletApiKey, boardId: cfg.boardId, section: room.section, subject: `${st.no ? st.no + '번 ' : ''}${st.name}`, body: text });
    if (!out.ok) {
      padletLastError = `${new Date().toLocaleTimeString('ko-KR')} ${st.cls} ${st.no}번: ${out.status || '연결 실패'} ${out.detail || ''}`.slice(0, 300);
      console.log('[패들렛 오류]', padletLastError);
      throw new HttpError(502, out.message);
    }
    padletLastError = '';
    store.patchRecord(rec.id, { padletAt: Date.now() });
    return send(res, 200, { ok: true, at: Date.now(), link: room.link || '' });
  }

  if (method === 'POST' && pathname === '/api/submit') {
    const st = studentAuth(req);
    if (!store.settings.open) throw new HttpError(403, '지금은 수업이 닫혀 있어요.');
    const b = await readBody(req, 8192);
    const ch = verify(b.token);
    if (!ch || ch.r !== 'c' || ch.sid !== st.sid) throw new HttpError(410, '조건이 만료되었어요. 새 조건을 받아 주세요.');
    const resolved = C.resolve(ch.ids);
    if (!resolved) throw new HttpError(410, '조건을 찾을 수 없어요. 새 조건을 받아 주세요.');

    const sentence = String(b.sentence || '').replace(/\s+/g, ' ').trim();
    if (sentence.length < 2) throw new HttpError(400, '문장을 입력해 주세요.');
    if (sentence.length > 200) throw new HttpError(400, '200자 이내의 한 문장으로 써 주세요.');
    if (!/[가-힣]/.test(sentence)) throw new HttpError(400, '한글로 문장을 써 주세요.');

    if (rateLimited('submit:' + st.sid, 12, 60 * 1000)) throw new HttpError(429, '너무 빨리 제출하고 있어요. 잠시 뒤에 다시 제출해 주세요.');
    const attempt = store.records.filter((r) => r.cid === ch.n && r.sid === st.sid).length + 1;
    if (attempt > 25) throw new HttpError(429, '이 조건으로는 충분히 도전했어요. 새 조건을 받아 주세요.');

    // 학생이 목록에서 고른 주제(선생님이 허용한 경우). 주제는 채점하지 않고 기록과 예시 문장에만 쓴다.
    const wanted = store.settings.topicChoice === false ? '' : String(b.topicText || '').replace(/\s+/g, ' ').trim();
    const topicText = C.snapshot().topics.some((x) => !x.off && x.label === wanted) ? wanted : '';  // 목록에 있는 주제만 인정
    const topicLabel = topicText || resolved.topic.label;
    const topicCustom = !!topicText && topicText !== resolved.topic.label;
    const gradeInput = topicCustom ? Object.assign({}, resolved, { topic: { id: 'custom:' + topicText, label: topicText } }) : resolved;
    const manual = store.settings.aiMode === 'off';
    const out = manual ? { ok: false, code: 'manual', message: '' } : await grader.grade(gradeInput, sentence);
    const fields = resultFields(out);
    if (manual) { fields.pendingReason = ''; fields.manual = true; }
    { const a = activity.get(st.sid); if (a) { a.typingAt = 0; a.draftLen = 0; } }
    const rec = store.addRecord(Object.assign({
      ts: Date.now(), sid: st.sid, name: st.name, cls: st.cls, cid: ch.n, attempt,
      comp: ch.ids.comp, struct: ch.ids.struct, topic: ch.ids.topic,
      compLabel: resolved.comp.label, structLabel: resolved.struct.label, topicLabel, topicCustom,
      sentence, flagged: false,
    }, fields));

    const reveal = fields.verdict === 'correct' || (store.settings.revealAfter > 0 && attempt >= store.settings.revealAfter && fields.verdict === 'incorrect');
    return send(res, 200, {
      id: rec.id,
      attempt,
      topic: topicLabel,
      verdict: fields.verdict,
      checks: fields.checks,
      analysis: fields.analysis,
      tip: fields.tip,
      example: reveal ? fields.example : '',
      manual,
      message: manual ? '제출했어요. 선생님이 확인하면 결과와 피드백이 여기에 나타나요.' : fields.verdict === 'pending'
        ? (out.code === 'nokey' ? 'AI 판정이 아직 준비되지 않았어요. 문장은 선생님께 전달되었어요.' : 'AI 판정을 하지 못했어요. 문장은 선생님께 전달되었어요.')
        : '',
    });
  }

  // 학생이 만든 포스터 프롬프트를 선생님이 볼 수 있게 저장한다.
  if (method === 'POST' && pathname === '/api/poster') {
    const st = studentAuth(req);
    if (store.settings.poster === false) throw new HttpError(403, '지금은 포스터 프롬프트 만들기가 닫혀 있어요.');
    if (rateLimited('poster:' + st.sid, 20, 60 * 1000)) throw new HttpError(429, '너무 빨리 만들고 있어요. 잠시 뒤에 다시 해 주세요.');
    const b = await readBody(req, 32 * 1024);
    const prompt = String(b.prompt || '').trim().slice(0, 4000);
    if (!prompt) throw new HttpError(400, '프롬프트가 비어 있어요.');
    const opts = {};
    if (b.opts && typeof b.opts === 'object') {
      for (const [k, v] of Object.entries(b.opts).slice(0, 30)) if (typeof v === 'string') opts[String(k).slice(0, 20)] = v.slice(0, 300);
    }
    const p = store.addPoster({
      ts: Date.now(), sid: st.sid, name: st.name, cls: st.cls,
      topic: clip(b.topic, 80), sentence: clip(b.sentence, 200),
      prompt, promptEn: String(b.promptEn || '').trim().slice(0, 4000), opts,
    });
    return send(res, 200, { id: p.id });
  }

  if (method === 'POST' && pathname === '/api/flag') {
    const st = studentAuth(req);
    const b = await readBody(req, 2048);
    const rec = store.getRecord(String(b.id || ''));
    if (!rec || rec.sid !== st.sid) throw new HttpError(404, '기록을 찾을 수 없어요.');
    store.patchRecord(rec.id, { flagged: true, flagNote: clip(b.note, 200), reviewed: false });
    return send(res, 200, { ok: true });
  }

  // ----- 교사 -----
  if (method === 'POST' && pathname === '/api/teacher/login') {
    if (rateLimited('tlogin:' + ip, 10, 60 * 1000)) throw new HttpError(429, '잠시 후 다시 시도해 주세요.');
    const b = await readBody(req, 1024);
    const a = crypto.createHash('sha256').update(String(b.password || '')).digest();
    const c = crypto.createHash('sha256').update(TEACHER_PASSWORD).digest();
    if (!TEACHER_PASSWORD || !crypto.timingSafeEqual(a, c)) throw new HttpError(401, '비밀번호가 맞지 않아요.');
    return send(res, 200, { token: sign({ r: 't', exp: Date.now() + 12 * HOUR }) });
  }

  if (pathname.startsWith('/api/teacher/')) {
    teacherAuth(req);

    if (method === 'GET' && pathname === '/api/teacher/info') return send(res, 200, teacherInfo());

    if (method === 'PUT' && pathname === '/api/teacher/settings') {
      const b = await readBody(req, 4096);
      const patch = {};
      if (b.level !== undefined) patch.level = b.level;
      if (b.open !== undefined) patch.open = !!b.open;
      if (b.revealAfter !== undefined) patch.revealAfter = parseInt(b.revealAfter, 10);
      if (b.aiMode !== undefined) patch.aiMode = b.aiMode === 'off' ? 'off' : 'on';
      if (b.poster !== undefined) patch.poster = !!b.poster;
      if (b.topicChoice !== undefined) patch.topicChoice = !!b.topicChoice;
      if (typeof b.padletTemplate === 'string') patch.padletTemplate = b.padletTemplate;
      if (typeof b.apiKey === 'string' && b.apiKey.trim()) patch.apiKey = b.apiKey;
      if (b.clearApiKey) patch.apiKey = '';
      if (typeof b.model === 'string') patch.model = b.model;
      store.updateSettings(patch);
      grader.cache.clear();
      return send(res, 200, teacherInfo());
    }

    // 패들렛 연결 설정: API 키, 반별 보드 ID, 번호별 섹션 ID·소회의실 링크
    if (method === 'PUT' && pathname === '/api/teacher/padlet') {
      const b = await readBody(req, 64 * 1024);
      const patch = {};
      if (typeof b.apiKey === 'string' && b.apiKey.trim()) patch.padletApiKey = b.apiKey;
      if (b.clearApiKey) patch.padletApiKey = '';
      let skipped = [];
      if (b.cls !== undefined) {
        const cls = String(b.cls || '');
        if (!store.students.some((s) => s.cls === cls)) throw new HttpError(400, '반을 선택해 주세요.');
        const boardId = String(b.boardId || '').trim();
        if (boardId && !PADLET.BOARD_RE.test(boardId)) throw new HttpError(400, '보드 ID 형식이 올바르지 않아요.');
        const parsed = PADLET.parseRooms(b.roomsText);
        skipped = parsed.skipped;
        patch.padletClass = { cls, boardId, rooms: parsed.rooms };
      }
      store.updateSettings(patch);
      return send(res, 200, Object.assign(teacherInfo(), { skipped }));
    }

    if (method === 'POST' && pathname === '/api/teacher/padlet/test') {
      const b = await readBody(req, 2048);
      const cfg = (store.settings.padlet || {})[String(b.cls || '')];
      const out = await PADLET.test(store.settings.padletApiKey, cfg && cfg.boardId);
      return send(res, 200, out);
    }

    if (method === 'GET' && pathname === '/api/teacher/padlet/rooms') {
      const cfg = (store.settings.padlet || {})[query.get('cls') || ''] || { boardId: '', rooms: {} };
      const lines = Object.entries(cfg.rooms || {}).sort((a, b) => a[0] - b[0]).map(([no, r]) => [no, r.section, r.link].filter(Boolean).join('\t'));
      return send(res, 200, { boardId: cfg.boardId || '', roomsText: lines.join('\n') });
    }

    if (method === 'POST' && pathname === '/api/teacher/ping') {
      const out = await grader.ping();
      return send(res, 200, out);
    }

    if (method === 'POST' && pathname === '/api/teacher/try') {
      const b = await readBody(req, 4096);
      const resolved = C.resolve({ comp: b.comp, struct: b.struct, topic: b.topic });
      if (!resolved) throw new HttpError(400, '조건을 선택해 주세요.');
      const sentence = String(b.sentence || '').replace(/\s+/g, ' ').trim();
      if (sentence.length < 2 || sentence.length > 200) throw new HttpError(400, '2~200자의 문장을 입력해 주세요.');
      const out = await grader.grade(resolved, sentence);
      return send(res, 200, out.ok ? { ok: true, result: out.result } : { ok: false, message: out.message });
    }

    if (method === 'GET' && pathname === '/api/teacher/conditions') {
      const all = C.snapshot();
      const pub = (o) => ({ id: o.id, level: o.level, label: o.label, off: !!o.off });
      return send(res, 200, { comps: all.comps.map(pub), structs: all.structs.map(pub), topics: all.topics.map(pub), seven: all.seven, parts: C.PARTS.map((x) => ({ id: x.id, name: x.name })) });
    }

    if (method === 'GET' && pathname === '/api/teacher/conditions/full') {
      return send(res, 200, { conditions: C.snapshot(), counts: C.counts(), customized: C.isCustomized(), parts: C.PARTS.map((x) => ({ id: x.id, name: x.name, tag: x.tag })) });
    }

    if (method === 'PUT' && pathname === '/api/teacher/conditions') {
      const b = await readBody(req, 400 * 1024);
      try { C.replace(b); } catch (e) {
        if (e.userMessage) throw new HttpError(400, e.userMessage);
        throw e;
      }
      return send(res, 200, { conditions: C.snapshot(), counts: C.counts(), customized: C.isCustomized(), parts: C.PARTS.map((x) => ({ id: x.id, name: x.name })) });
    }

    if (method === 'POST' && pathname === '/api/teacher/conditions/reset') {
      C.reset();
      return send(res, 200, { conditions: C.snapshot(), counts: C.counts(), customized: C.isCustomized(), parts: C.PARTS.map((x) => ({ id: x.id, name: x.name })) });
    }

    if (method === 'POST' && pathname === '/api/teacher/roster/import') {
      const b = await readBody(req, 300 * 1024);
      const { entries, skipped } = parseRoster(b.text, clip(b.cls, 30));
      if (!entries.length) throw new HttpError(400, '읽을 수 있는 명단이 없어요. "학번 이름" 형식으로 한 줄에 한 명씩 붙여 넣어 주세요.');
      const r = store.importRoster(entries, b.mode === 'replace' ? 'replace' : 'merge');
      return send(res, 200, Object.assign(r, { read: entries.length, skipped }));
    }

    if (method === 'POST' && pathname === '/api/teacher/roster/add') {
      const b = await readBody(req, 2048);
      const sid = normSid(b.sid);
      const name = String(b.name || '').trim();
      if (!/^\d{3,10}$/.test(sid) || !name) throw new HttpError(400, '학번(숫자)과 이름을 입력해 주세요.');
      const cls = clip(b.cls, 30) || classFromSid(sid) || '미지정';
      return send(res, 200, store.importRoster([{ sid, name, cls, no: numberFromSid(sid) }], 'merge'));
    }

    if (method === 'POST' && pathname === '/api/teacher/roster/level') {
      const b = await readBody(req, 16 * 1024);
      const level = b.level === 'easy' || b.level === 'basic' ? b.level : '';
      const sids = (Array.isArray(b.sids) ? b.sids : []).map((x) => normSid(x)).filter(Boolean).slice(0, 500);
      return send(res, 200, { changed: store.setLevels(sids, level) });
    }

    if (method === 'POST' && pathname === '/api/teacher/roster/remove') {
      const b = await readBody(req, 2048);
      return send(res, 200, { removed: store.removeStudent(normSid(b.sid)) });
    }

    // 교실 현황판: 학생마다 지금 상태(미접속/접속/입력 중/확인 대기/정답/반려)를 한 칸으로 보여 주기 위한 자료
    if (method === 'GET' && pathname === '/api/teacher/board') {
      const cls = query.get('cls') || '';
      const now = Date.now();
      const lastBy = new Map();
      const tally = new Map();
      for (let i = store.records.length - 1; i >= 0; i--) {
        const r = store.records[i];
        if (!lastBy.has(r.sid)) lastBy.set(r.sid, r);
        const t = tally.get(r.sid) || { tries: 0, correct: 0 };
        t.tries++; if (finalVerdict(r) === 'correct') t.correct++;
        tally.set(r.sid, t);
      }
      const classes = {};
      const students = [];
      for (const s of store.students) {
        classes[s.cls] = (classes[s.cls] || 0) + 1;
        if (cls && s.cls !== cls) continue;
        const online = (presence.get(s.sid) || 0) > now - 5 * 60 * 1000;
        const a = activity.get(s.sid) || {};
        const last = lastBy.get(s.sid);
        const typing = !!a.typingAt && now - a.typingAt < 15000 && a.draftLen > 0 && (!last || a.typingAt > last.ts);
        const current = !!last && now - last.ts < 8 * 3600 * 1000 && (!a.challengeAt || a.challengeAt <= last.ts);
        let state = 'offline';
        if (typing) state = 'typing';
        else if (current) { const v = finalVerdict(last); state = v === 'correct' ? 'correct' : v === 'incorrect' ? 'incorrect' : 'pending'; }
        else if (online) state = 'waiting';
        const t = tally.get(s.sid) || { tries: 0, correct: 0 };
        students.push({
          sid: s.sid, name: s.name, cls: s.cls, no: s.no, level: s.level || '', online, state,
          attempt: current ? last.attempt : 0, draftLen: typing ? a.draftLen : 0,
          manual: current && !!last.manual, review: current && needsReview(last), topicTodo: current && topicTodo(last),
          sentence: current ? last.sentence : '', ago: current ? Math.max(0, Math.round((now - last.ts) / 1000)) : -1,
          tries: t.tries, correct: t.correct,
        });
      }
      return send(res, 200, {
        students, seats: store.seats, cols: SEAT_COLS,
        classes: Object.keys(classes).sort((a, b) => a.localeCompare(b, 'ko', { numeric: true })).map((c) => ({ cls: c, count: classes[c] })),
      });
    }

    // 현황판 자리 배치 저장(PC와 태블릿이 같은 배치를 본다)
    if (method === 'PUT' && pathname === '/api/teacher/seats') {
      const b = await readBody(req, 16 * 1024);
      const cls = String(b.cls || '');
      if (!store.students.some((s) => s.cls === cls)) throw new HttpError(400, '반을 찾을 수 없어요.');
      return send(res, 200, { slots: store.setSeats(cls, b.slots) });
    }

    if (method === 'GET' && pathname === '/api/teacher/overview') {
      const since = periodStart(query.get('period') || 'all');
      const cls = query.get('cls') || '';
      const sm = statsMap(since);
      const now = Date.now();
      const classes = {};
      const students = [];
      for (const s of store.students) {
        classes[s.cls] = (classes[s.cls] || 0) + 1;
        if (cls && s.cls !== cls) continue;
        const st = sm.get(s.sid) || { tries: 0, correct: 0, incorrect: 0, pending: 0, review: 0, topicTodo: 0, topicOk: 0, topicNo: 0, fb: 0, last: 0 };
        students.push(Object.assign({ sid: s.sid, name: s.name, cls: s.cls, no: s.no, level: s.level || '', online: (presence.get(s.sid) || 0) > now - 5 * 60 * 1000 }, st));
      }
      const open = store.records.filter((r) => needsReview(r)).length;
      return send(res, 200, {
        students,
        classes: Object.keys(classes).sort((a, b) => a.localeCompare(b, 'ko', { numeric: true })).map((c) => ({ cls: c, count: classes[c] })),
        reviewOpen: open,
        topicOpen: store.records.filter((r) => topicTodo(r)).length,
        online: students.filter((s) => s.online).length,
      });
    }

    if (method === 'GET' && pathname === '/api/teacher/records') {
      const since = periodStart(query.get('period') || 'all');
      const cls = query.get('cls') || '';
      const sid = query.get('sid') || '';
      const verdict = query.get('verdict') || '';
      const topicF = query.get('topic') || '';
      const fbF = query.get('fb') || '';
      const before = parseInt(query.get('before'), 10) || Infinity;
      const limit = Math.min(parseInt(query.get('limit'), 10) || 100, 500);
      const out = [];
      for (let i = store.records.length - 1; i >= 0 && out.length < limit; i--) {
        const r = store.records[i];
        if (r.ts >= before || r.ts < since) continue;
        if (cls && r.cls !== cls) continue;
        if (sid && r.sid !== sid) continue;
        const v = finalVerdict(r);
        if (verdict === 'review') { if (!needsReview(r)) continue; }
        else if (verdict && v !== verdict) continue;
        if (topicF === 'todo') { if (!topicTodo(r)) continue; }
        else if (topicF === 'ok' || topicF === 'no') { if (r.topicJudge !== topicF) continue; }
        if (fbF === 'none' && r.tfeedback) continue;
        if (fbF === 'has' && !r.tfeedback) continue;
        out.push(teacherView(r));
      }
      return send(res, 200, { records: out });
    }

    // 교사 피드백·주제 판단. 보낸 항목만 바꾼다. (feedback: 글, topic: 'ok' | 'no' | '')
    if (method === 'POST' && pathname === '/api/teacher/feedback') {
      const b = await readBody(req, 8192);
      const rec = store.getRecord(String(b.id || ''));
      if (!rec) throw new HttpError(404, '기록을 찾을 수 없어요.');
      const f = {};
      if (typeof b.feedback === 'string') {
        f.tfeedback = b.feedback.replace(/\r/g, '').trim().slice(0, 500);
        f.tfeedbackAt = f.tfeedback ? Date.now() : 0;
      }
      if (b.topic !== undefined) {
        if (!['ok', 'no', ''].includes(b.topic)) throw new HttpError(400, '올바른 값이 아니에요.');
        f.topicJudge = b.topic;
      }
      if (!Object.keys(f).length) throw new HttpError(400, '바꿀 내용이 없어요.');
      store.patchRecord(rec.id, f);
      return send(res, 200, { record: teacherView(store.getRecord(rec.id)) });
    }

    if (method === 'POST' && pathname === '/api/teacher/feedback/bulk') {
      const b = await readBody(req, 64 * 1024);
      if (!['ok', 'no', ''].includes(b.topic)) throw new HttpError(400, '올바른 값이 아니에요.');
      const ids = Array.isArray(b.ids) ? b.ids.slice(0, 500) : [];
      let n = 0;
      for (const id of ids) { if (store.getRecord(String(id))) { store.patchRecord(String(id), { topicJudge: b.topic }); n++; } }
      return send(res, 200, { changed: n });
    }

    if (method === 'POST' && pathname === '/api/teacher/override') {
      const b = await readBody(req, 4096);
      const rec = store.getRecord(String(b.id || ''));
      if (!rec) throw new HttpError(404, '기록을 찾을 수 없어요.');
      const note = clip(b.note, 300);
      let fields;
      if (b.verdict === 'correct' || b.verdict === 'incorrect') fields = { override: { verdict: b.verdict, note, ts: Date.now() }, reviewed: true };
      else if (b.verdict === 'keep') fields = { reviewed: true, teacherNote: note || rec.teacherNote || '' };
      else if (b.verdict === 'clear') fields = { override: null, reviewed: true };
      else throw new HttpError(400, '올바른 값이 아니에요.');
      store.patchRecord(rec.id, fields);
      return send(res, 200, { record: teacherView(store.getRecord(rec.id)) });
    }

    if (method === 'POST' && pathname === '/api/teacher/regrade') {
      const b = await readBody(req, 4096);
      if (store.settings.aiMode === 'off') throw new HttpError(400, '지금은 AI 없이 선생님이 직접 판정하는 방식이에요. [설정·시험]에서 AI 판정을 켠 뒤 사용해 주세요.');
      const targets = b.all
        ? store.records.filter((r) => r.verdict === 'pending' && !r.override).slice(0, 200)
        : [store.getRecord(String(b.id || ''))].filter(Boolean);
      let ok = 0, fail = 0;
      let lastMessage = '';
      await Promise.all(targets.map(async (rec) => {
        const resolved = C.resolve({ comp: rec.comp, struct: rec.struct, topic: rec.topic });
        if (!resolved) { fail++; return; }
        const gin = rec.topicCustom && rec.topicLabel ? Object.assign({}, resolved, { topic: { id: 'custom:' + rec.topicLabel, label: rec.topicLabel } }) : resolved;
        const out = await grader.grade(gin, rec.sentence);
        if (out.ok) { store.patchRecord(rec.id, resultFields(out)); ok++; } else { fail++; lastMessage = out.message; }
      }));
      return send(res, 200, { ok, fail, message: lastMessage });
    }

    if (method === 'POST' && pathname === '/api/teacher/record/delete') {
      const b = await readBody(req, 2048);
      return send(res, 200, { deleted: store.deleteRecord(String(b.id || '')) });
    }

    if (method === 'POST' && pathname === '/api/teacher/student/reset') {
      const b = await readBody(req, 2048);
      const sid = normSid(b.sid);
      store.deletePostersOf(sid);
      return send(res, 200, { deleted: store.deleteRecordsOf(sid) });
    }

    if (method === 'GET' && pathname === '/api/teacher/posters') {
      const cls = query.get('cls') || '';
      const sid = query.get('sid') || '';
      const out = [];
      for (let i = store.posters.length - 1; i >= 0 && out.length < 500; i--) {
        const p = store.posters[i];
        if (cls && p.cls !== cls) continue;
        if (sid && p.sid !== sid) continue;
        out.push(p);
      }
      return send(res, 200, { posters: out });
    }

    if (method === 'POST' && pathname === '/api/teacher/poster/delete') {
      const b = await readBody(req, 2048);
      return send(res, 200, { deleted: store.deletePoster(String(b.id || '')) });
    }

    if (method === 'GET' && pathname === '/api/teacher/export/posters.csv') {
      const cls = query.get('cls') || '';
      const rows = [['일시', '반', '학번', '이름', '주제', '문장', '프롬프트(한국어)', '프롬프트(English)']];
      for (const p of store.posters) {
        if (cls && p.cls !== cls) continue;
        rows.push([fmtTime(p.ts), p.cls, p.sid, p.name, p.topic, p.sentence, p.prompt, p.promptEn]);
      }
      return sendFile(res, 200, '포스터프롬프트.csv', toCsv(rows), 'text/csv; charset=utf-8');
    }

    if (method === 'GET' && pathname === '/api/teacher/export/records.csv') {
      const since = periodStart(query.get('period') || 'all');
      const cls = query.get('cls') || '';
      const rows = [['일시', '반', '학번', '이름', '문장 성분 조건', '문장의 짜임 조건', '공익광고 주제', '회차', '제출 문장', '최종 판정', 'AI 판정', '교사 수정', '학생 확인 요청', 'AI 피드백 요약', '주제 판단(교사)', '교사 피드백']];
      const label = { correct: '정답', incorrect: '오답', pending: '판정 대기' };
      for (const r of store.records) {
        if (r.ts < since || (cls && r.cls !== cls)) continue;
        const fb = r.checks ? Object.values(r.checks).filter((c) => !c.ok).map((c) => c.reason).join(' / ') : (r.pendingReason || '');
        rows.push([fmtTime(r.ts), r.cls, r.sid, r.name, r.compLabel, r.structLabel, r.topicLabel, r.attempt, r.sentence,
          label[finalVerdict(r)] || '', (r.manual ? 'AI 미사용' : label[r.verdict]) || '', r.override ? (label[r.override.verdict] + (r.override.note ? ': ' + r.override.note : '')) : '',
          r.flagged ? '예' : '', fb, ({ ok: '적절', no: '부적절' })[r.topicJudge] || '미확인', r.tfeedback || '']);
      }
      return sendFile(res, 200, '제출기록.csv', toCsv(rows), 'text/csv; charset=utf-8');
    }

    if (method === 'GET' && pathname === '/api/teacher/export/summary.csv') {
      const since = periodStart(query.get('period') || 'all');
      const cls = query.get('cls') || '';
      const sm = statsMap(since);
      const rows = [['반', '학번', '이름', '제출 수', '문법 정답 수', '문법 오답 수', '판정 대기', '정답률(%)', '주제 적절', '주제 부적절', '주제 미확인(문법 정답 중)', '교사 피드백 수', '마지막 제출']];
      for (const s of store.students) {
        if (cls && s.cls !== cls) continue;
        const t = sm.get(s.sid) || { tries: 0, correct: 0, incorrect: 0, pending: 0, topicTodo: 0, topicOk: 0, topicNo: 0, fb: 0, last: 0 };
        rows.push([s.cls, s.sid, s.name, t.tries, t.correct, t.incorrect, t.pending, t.tries ? Math.round((t.correct / t.tries) * 100) : '', t.topicOk, t.topicNo, t.topicTodo, t.fb, fmtTime(t.last)]);
      }
      return sendFile(res, 200, '학생별누적.csv', toCsv(rows), 'text/csv; charset=utf-8');
    }
  }

  throw new HttpError(404, '찾을 수 없는 요청이에요.');
}

// ---------- 정적 파일 ----------
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8',
};
const PUBLIC = path.join(ROOT, 'public');

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname === '/teacher' ? '/teacher.html' : pathname;
  let file;
  try { file = path.normalize(path.join(PUBLIC, decodeURIComponent(rel))); } catch (e) { file = ''; }
  if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('페이지를 찾을 수 없어요.');
  }
  res.writeHead(200, {
    'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost');
    if (u.pathname.startsWith('/api/')) return await handleApi(req, res, u.pathname, u.searchParams);
    return serveStatic(req, res, u.pathname);
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message });
    console.error('오류:', e);
    return send(res, 500, { error: '서버에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.' });
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`\n포트 ${PORT} 을(를) 이미 사용 중이에요. 이미 실행 중인 창이 있는지 확인하거나 .env 의 PORT 값을 바꿔 주세요.`);
  else console.error(e);
  process.exit(1);
});

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    const line = '='.repeat(56);
    console.log('\n' + line);
    console.log('  문장 연습실이 실행되었어요');
    console.log(line);
    console.log('  학생 접속 주소 (같은 와이파이에서):');
    const urls = lanUrls();
    if (urls.length) urls.forEach((u) => console.log('    ' + u));
    else console.log('    (네트워크 주소를 찾지 못했어요. 와이파이 연결을 확인하세요)');
    console.log(`  이 컴퓨터에서 교사 화면: http://localhost:${PORT}/teacher`);
    if (createdPassword) console.log(`\n  처음 실행이라 교사 비밀번호를 만들었어요: ${createdPassword}\n  (바꾸려면 .env 파일의 TEACHER_PASSWORD 를 수정하세요)`);
    if (!grader.configured()) console.log('\n  AI 판정용 API 키가 아직 없어요. 교사 화면의 [설정]에서 입력하세요.');
    console.log('\n  끝내려면 이 창에서 Ctrl + C 를 누르거나 창을 닫으세요.');
    console.log(line + '\n');
  });
}

module.exports = { server, store, grader };
