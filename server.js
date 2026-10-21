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
const IMAGES = require('./lib/images');
const PosterLib = require('./public/poster.js');
const { Store, normName, normSid, classFromSid, numberFromSid, finalVerdict, SEAT_COLS } = require('./lib/store');
const { Grader } = require('./lib/grader');
const C = require('./lib/conditions');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const TEACHER_PASSWORD = process.env.TEACHER_PASSWORD || '';
const DEFAULT_MODEL = 'claude-sonnet-5-5';
const DEFAULT_GEMINI = 'gemini-3.8-flash';

const imgBusy = new Set();
const store = new Store(DATA_DIR);
C.init(path.join(DATA_DIR, 'conditions.json'));
function aiConfig(which) {
  const gem = (which || store.settings.provider) === 'gemini';
  return gem ? {
    provider: 'gemini',
    apiKey: store.settings.geminiApiKey || process.env.GEMINI_API_KEY || '',
    model: store.settings.geminiModel || process.env.GEMINI_MODEL || DEFAULT_GEMINI,
    baseUrl: process.env.GEMINI_BASE_URL || '',
  } : {
    provider: 'claude',
    apiKey: store.settings.apiKey || process.env.ANTHROPIC_API_KEY || '',
    model: store.settings.model || process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
    baseUrl: process.env.ANTHROPIC_BASE_URL || '',
  };
}
// 주 AI가 안 될 때 쓸 예비 AI: 선택하지 않은 쪽 AI에 키가 있으면 그쪽을 쓴다
function aiFallback() {
  const other = store.settings.provider === 'gemini' ? 'claude' : 'gemini';
  const c = aiConfig(other);
  return c.apiKey ? c : null;
}
const grader = new Grader(() => aiConfig(), aiFallback);

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
const demoTries = new Map(); // 참관 체험 제출 횟수(저장하지 않음)

const DEMO = { sid: '참관체험', name: '참관 체험', cls: '참관', no: 0, level: '', demo: true };
const DEMO_G = Object.assign({}, DEMO, { dg: true });   // 모둠 학습 체험
function studentAuth(req) {
  const p = verify(bearer(req));
  if (p && p.r === 'o') {
    if (!store.settings.observerPassword) throw new HttpError(401, '참관 계정이 닫혔어요.');
    return p.dm === 'group' ? DEMO_G : DEMO;
  }   // 참관자의 학생 화면 체험: 기록·현황판에 남기지 않는다
  if (!p || p.r !== 's') throw new HttpError(401, '다시 입장해 주세요.');
  const st = store.studentBySid(p.sid);
  if (!st) throw new HttpError(401, '명단에서 찾을 수 없어요. 다시 입장해 주세요.');
  presence.set(st.sid, Date.now());
  return st;
}

function observerAuth(req) {
  const p = verify(bearer(req));
  if (!p || p.r !== 'o') throw new HttpError(401, '참관 비밀번호로 다시 들어와 주세요.');
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
function topicTodo(r) { return false; }   // 주제 판단 기능은 없앴다

function needsReview(r) {
  return (r.flagged || r.needsReview) && !r.override && !r.reviewed;
}

// ---------- 활동 회차 ----------
// 회차가 하나도 저장되지 않은 예전 자료는 '1회차(열림)' 하나로 본다.
function roundsList() {
  const r = store.settings.rounds;
  return Array.isArray(r) && r.length ? r : [{ id: 'r1', no: 1, name: '1회차', openedAt: 0, closedAt: 0, legacy: true }];
}
function activeRound() { return roundsList().find((x) => !x.closedAt) || null; }
function recRound(r) { return r.rd || roundsList()[0].id; }
// 차시: 회차를 '2차시로 나누기'로 열면 1차시(문장 만들기~패들렛 올리기)부터 시작하고, 교사가 2차시를 열어야 포스터 단계가 열린다.
function phaseOf(x) { return x && x.split ? (x.phase === 2 ? 2 : 1) : 2; }
function roundPub(x) { return x ? { id: x.id, no: x.no, name: x.name, openedAt: x.openedAt, closedAt: x.closedAt, groupMode: !!x.groupMode, split: !!x.split, phase: phaseOf(x) } : null; }
function requirePhase2(st) {
  const ar = activeRound();
  if (ar && phaseOf(ar) < 2) throw new HttpError(403, '포스터 만들기는 2차시에 열려요. 선생님이 2차시를 열면 이어서 할 수 있어요.');
}
// 교사 화면이 기본으로 보여 줄 회차: 열린 회차, 없으면 가장 최근 회차. 'all' 이면 전체.
function viewRound(q) {
  if (q === 'all') return '';
  if (q && roundsList().some((x) => x.id === q)) return q;
  const a = activeRound(); if (a) return a.id;
  const l = roundsList(); return l[l.length - 1].id;
}
function statsMap(since, rd) {
  const m = new Map();
  for (const r of store.records) {
    if (r.ts < since) continue;
    if (rd && recRound(r) !== rd) continue;
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
// 패들렛 연결 설정은 개인 활동용(solo)과 모둠 활동용(group)을 따로 둔다. 모둠용은 반 설정 안의 group 에 저장한다.
function padCfg(cls, kind) {
  const c = (store.settings.padlet || {})[cls];
  if (!c) return undefined;
  if (kind === 'group') return c.group && (c.group.boardId || Object.keys(c.group.rooms || {}).length || c.group.allUrl) ? c.group : undefined;
  return c.boardId || Object.keys(c.rooms || {}).length || c.allUrl || c.boardUrl ? c : undefined;
}
function padletRoom(st) {
  const grp = groupOn() && !st.demo;
  const cfg = padCfg(st.cls, grp ? 'group' : 'solo');
  const key = grp ? String(store.groupOf(st.sid) || '') : String(st.no);   // 모둠 활동에서는 방 번호 = 모둠 번호
  const room = cfg && cfg.rooms && key ? cfg.rooms[key] : null;
  return { cfg, room };
}

// ---------- 모둠 활동 ----------
function groupOn() { return store.settings.groupMode === true; }
function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function hashStr(str) { let h = 2166136261; for (const ch of String(str)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

// 모둠 하나의 문제 목록. 반·모둠 번호·교사가 정한 '새로 뽑기' 값으로 항상 같은 결과가 나오게 만든다(서버가 여러 개여도 같은 목록).
function groupSlots(cls, no, planIn) {
  const plan = planIn || store.settings.groupPlan || {};
  const structs = C.snapshot().structs;
  const picks = [];
  for (const sx of structs) for (let k = 0; k < (plan[sx.id] || 0); k++) picks.push(sx.id);
  const seed = Number(store.settings.groupSeed) || 1;
  const r = mulberry(hashStr(`${cls}|${no}|${seed}`));
  const recent = { comps: [], structs: [], topics: [] };
  return picks.map((structId, i) => {
    const ids = C.draw(store.settings.level, r, { comps: recent.comps.slice(-3), structs: [], topics: recent.topics.slice(-3) }, '', structId);
    recent.comps.push(ids.comp); recent.topics.push(ids.topic);
    return { i, n: `g${seed}.${hashStr(cls + '|' + no).toString(36)}.${i}`, ids };
  });
}
function groupKey(st) { const no = store.groupOf(st.sid); return no ? `${st.cls}|${no}` : ''; }
function groupMembers(cls, no) { return store.students.filter((x) => x.cls === cls && store.groupOf(x.sid) === no); }

// 모둠장: 교사가 정해 둔 학생(그 모둠원일 때만), 없으면 모둠에서 학번이 가장 앞선 학생
function groupLeader(cls, no) {
  const ms = groupMembers(cls, no);
  if (!ms.length) return null;
  const sid = store.leaders[`${cls}|${no}`];
  return ms.find((x) => x.sid === sid) || ms[0];
}

// 모둠 아이디어 연습장: 한 번 적으면 고치거나 지울 수 없다. 모둠원 누구나 적을 수 있고 모둠원이 함께 본다.
function notesOf(gk, cid) {
  return store.notes.filter((n) => n.gk === gk && n.cid === cid).map((n) => ({ id: n.id, ts: n.ts, sid: n.sid, name: n.name, text: n.text }));
}

// 모둠 하나의 진행(학생 화면·교사 현황판 공통)
function groupData(cls, no, rid) {
  const ar = activeRound();
  if (rid === undefined) rid = ar ? ar.id : '';
  const out = { no, members: groupMembers(cls, no), slots: [], total: 0, done: 0, pending: 0, tries: 0, wrong: 0, last: 0 };
  const recs = store.records.filter((r) => r.gk === `${cls}|${no}` && (!rid || recRound(r) === rid));
  out.tries = recs.length; out.wrong = recs.filter((r) => finalVerdict(r) === 'incorrect').length;
  out.last = recs.reduce((m, r) => Math.max(m, r.ts || 0), 0);
  if (!ar || ar.id !== rid) {   // 닫힌 회차(또는 열린 회차 없음): 그때의 기록으로 문제 목록을 다시 만든다
    const order = [];
    for (const r of recs) if (!order.includes(r.cid)) order.push(r.cid);
    out.slots = order.map((cid, i) => {
      const mine = recs.filter((r) => r.cid === cid);
      const okRec = mine.filter((r) => finalVerdict(r) === 'correct').pop() || null;
      const pend = okRec ? null : mine.filter((r) => finalVerdict(r) === 'pending').pop() || null;
      const rec = okRec || pend || mine[mine.length - 1];
      return { i, conds: null, tries: mine.length, status: okRec ? 'done' : pend ? 'pending' : 'todo', id: rec.id, sentence: rec.sentence, by: rec.name, topic: rec.topicLabel, comp: rec.compLabel, struct: rec.structLabel, padletAt: rec.padletAt || 0, poster: rec.poster || null, imgN: rec.imgN || 0, posterImg: rec.posterImg || null, roomDone: rec.roomDone || 0, notes: notesOf(`${cls}|${no}`, cid) };
    });
    out.total = out.slots.length;
    out.done = out.slots.filter((x) => x.status === 'done').length;
    out.pending = out.slots.filter((x) => x.status === 'pending').length;
    return out;
  }
  out.slots = groupSlots(cls, no).map((sl) => {
    const mine = recs.filter((r) => r.cid === sl.n);
    const okRec = mine.filter((r) => finalVerdict(r) === 'correct').pop() || null;
    const pend = okRec ? null : mine.filter((r) => finalVerdict(r) === 'pending').pop() || null;
    const res = C.resolve(sl.ids);
    const view = res ? C.publicView(res) : null;
    const rec = okRec || pend;
    return {
      i: sl.i, conds: view, tries: mine.length,
      status: okRec ? 'done' : pend ? 'pending' : 'todo',
      id: rec ? rec.id : '', sentence: rec ? rec.sentence : '', by: rec ? rec.name : '', topic: rec ? rec.topicLabel : (view ? view.topic.label : ''),
      comp: res ? res.comp.label : '', struct: res ? res.struct.label : '', padletAt: rec ? rec.padletAt || 0 : 0,
      poster: rec && rec.poster ? rec.poster : null, imgN: rec ? rec.imgN || 0 : 0, posterImg: rec ? rec.posterImg || null : null, roomDone: rec ? rec.roomDone || 0 : 0,
      notes: notesOf(`${cls}|${no}`, sl.n),
    };
  });
  out.total = out.slots.length;
  out.done = out.slots.filter((x) => x.status === 'done').length;
  out.pending = out.slots.filter((x) => x.status === 'pending').length;
  return out;
}

// 참관자의 모둠 학습 체험: 가상의 1모둠. 아무것도 저장하지 않고, 진행 상황은 체험하는 브라우저에서만 이어진다.
function demoSlots() {
  let plan = store.settings.groupPlan || {};
  if (!Object.keys(plan).length) { plan = {}; for (const x of C.snapshot().structs.filter((y) => !y.off).slice(0, 2)) plan[x.id] = 1; }
  return groupSlots('체험', 1, plan).map((sl) => Object.assign({}, sl, { n: 'demo.' + sl.i }));
}
function demoGroupView() {
  const slots = demoSlots().map((sl) => {
    const res = C.resolve(sl.ids), view = res ? C.publicView(res) : null;
    return { i: sl.i, conds: view, tries: 0, status: 'todo', id: '', sentence: '', by: '', topic: view ? view.topic.label : '', comp: res ? res.comp.label : '', struct: res ? res.struct.label : '', padletAt: 0, poster: null, roomDone: 0, notes: [] };
  });
  return { demoId: 'g', count: 1, no: 1, members: [{ name: '나(체험)', me: true, leader: true }, { name: '모둠원 예시 1', me: false, leader: false }, { name: '모둠원 예시 2', me: false, leader: false }],
    slots, total: slots.length, done: 0, leader: { name: '나(체험)', me: true }, isLeader: true };
}
function groupView(st) {
  if (st.demo) return st.dg ? demoGroupView() : null;
  if (!groupOn()) return null;
  const no = store.groupOf(st.sid);
  if (!activeRound()) return { count: store.settings.groupCount || 8, no, members: [], slots: [], total: 0, done: 0, leader: null, isLeader: false, noRound: true };
  const out = { count: store.settings.groupCount || 8, no, members: [], slots: [], total: 0, done: 0, leader: null, isLeader: false };
  if (!no) return out;
  const d = groupData(st.cls, no);
  const ld = groupLeader(st.cls, no);
  out.members = d.members.map((x) => ({ name: x.name, me: x.sid === st.sid, leader: !!ld && x.sid === ld.sid }));
  out.leader = ld ? { name: ld.name, me: ld.sid === st.sid } : null;
  out.isLeader = !!ld && ld.sid === st.sid;
  out.slots = d.slots; out.total = d.total; out.done = d.done + d.pending;
  return out;
}

function requireLeader(st) {
  const ld = groupLeader(st.cls, store.groupOf(st.sid));
  if (!ld || ld.sid !== st.sid) throw new HttpError(403, `문장은 모둠장${ld ? '(' + ld.name + ')' : ''}만 입력하고 제출할 수 있어요. 모둠원은 화면을 함께 보며 의견을 말해 주세요.`);
}

// 교사용 모둠 현황판: 모둠별 진행과 모둠원 상태
async function gboardData(cls, rid) {
  const now = Date.now();
  const count = store.settings.groupCount || 8;
  const groups = [];
  for (let no = 1; no <= count; no++) {
    const d = groupData(cls, no, rid);
    if (!d.members.length) continue;
    const ld = groupLeader(cls, no);
    const members = d.members.map((m) => {
      const online = (presence.get(m.sid) || 0) > now - 5 * 60 * 1000;
      const a = activity.get(m.sid) || {};
      const typing = !!a.typingAt && now - a.typingAt < 15000 && a.draftLen > 0;
      return { sid: m.sid, name: m.name, no: m.no, online, typing, draftLen: typing ? a.draftLen : 0, leader: !!ld && ld.sid === m.sid };
    });
    const state = d.total && d.done === d.total ? 'done' : (d.tries || d.done || d.pending) ? 'doing' : 'idle';
    groups.push({ no, state, total: d.total, done: d.done, pending: d.pending, tries: d.tries, wrong: d.wrong, last: d.last, members, slots: d.slots.map((x) => ({ i: x.i, status: x.status, sentence: x.sentence, by: x.by, comp: x.comp, struct: x.struct, topic: x.topic, tries: x.tries, id: x.id, padletAt: x.padletAt, notes: x.notes || [] })) });
  }
  const unassigned = store.students.filter((x) => x.cls === cls && !store.groupOf(x.sid)).map((x) => ({ name: x.name, no: x.no, online: (presence.get(x.sid) || 0) > now - 5 * 60 * 1000 }));
  return { cls, groups, unassigned, count, planTotal: Object.values(store.settings.groupPlan || {}).reduce((a, b) => a + b, 0) };
}
function padletFor(st) {
  const { cfg, room } = padletRoom(st);
  return {
    post: !!(store.settings.padletApiKey && cfg && cfg.boardId && room && room.section),
    link: (room && room.link) || (cfg && cfg.boardUrl) || '',
    all: (cfg && cfg.allUrl) || '',   // 모든 친구의 결과물을 볼 수 있는 반별 전체 링크(③ 업로드 완료 버튼을 누르면 보인다)
    board: !(room && room.link) && !!(cfg && cfg.boardUrl),   // 개인 방 링크가 없어 보드 전체 주소로 대신하는 경우
  };
}

function myHistory(st, limit) {
  const out = [];
  const gk = groupOn() || store.records.some((r) => r.gk) ? groupKey(st) : '';   // 모둠 활동 기록은 모둠원 모두가 볼 수 있다
  const names = new Map(roundsList().map((x) => [x.id, x.name]));
  for (let i = store.records.length - 1; i >= 0 && out.length < limit; i--) {
    const r = store.records[i];
    if (r.sid !== st.sid && !(gk && r.gk === gk)) continue;
    const rd = recRound(r);
    out.push({
      id: r.id, ts: r.ts, attempt: r.attempt, sentence: r.sentence, rd, rdName: names.get(rd) || '',
      verdict: finalVerdict(r), flagged: !!r.flagged, by: r.gk ? r.name : '', gno: r.gno || 0,
      tfeedback: r.tfeedback || '', tfeedbackAt: r.tfeedbackAt || 0, padletAt: r.padletAt || 0,
      poster: r.poster && r.poster.prompt ? { prompt: r.poster.prompt } : null, imgN: r.imgN || 0, posterImg: r.posterImg || null,
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

function padSummary(v) {
  v = v || {};
  return { boardId: v.boardId || '', rooms: Object.keys(v.rooms || {}).length,
    withSection: Object.values(v.rooms || {}).filter((x) => x.section).length, withLink: Object.values(v.rooms || {}).filter((x) => x.link).length };
}

function teacherInfo() {
  const cfg = grader.getConfig();
  const gem = cfg.provider === 'gemini';
  const own = gem ? !!store.settings.geminiApiKey : !!store.settings.apiKey;
  const cKey = store.settings.apiKey || process.env.ANTHROPIC_API_KEY || '';
  const gKey = store.settings.geminiApiKey || process.env.GEMINI_API_KEY || '';
  return {
    urls: lanUrls(),
    port: PORT,
    ai: {
      provider: cfg.provider,
      fallback: (aiFallback() || {}).provider || '',
      fallbackNote: grader.lastFallback && Date.now() - grader.lastFallback.at < 30 * 60 * 1000 ? `최근 ${Math.round((Date.now() - grader.lastFallback.at) / 60000)}분 전에 예비 AI로 판정했어요. (${String(grader.lastFallback.reason).slice(0, 100)})` : '',
      configured: !!cfg.apiKey,
      model: cfg.model,
      keyHint: maskKey(cfg.apiKey),
      keySource: own ? 'settings' : (gem ? (process.env.GEMINI_API_KEY ? 'env' : '') : (process.env.ANTHROPIC_API_KEY ? 'env' : '')),
      claude: { configured: !!cKey, keyHint: maskKey(cKey), model: store.settings.model || process.env.ANTHROPIC_MODEL || DEFAULT_MODEL },
      gemini: { configured: !!gKey, keyHint: maskKey(gKey), model: store.settings.geminiModel || process.env.GEMINI_MODEL || DEFAULT_GEMINI },
    },
    rounds: roundsList().map((x) => Object.assign(roundPub(x), { level: x.level || '', groupCount: x.groupCount || 0, groupPlan: x.groupPlan || {}, note: x.note || '', split: !!x.split, tries: store.records.filter((r) => recRound(r) === x.id).length })),
    activeRound: roundPub(activeRound()),
    settings: {
      level: store.settings.level,
      open: store.settings.open,
      revealAfter: store.settings.revealAfter,
      model: store.settings.model,
      geminiModel: store.settings.geminiModel || '',
      imageGen: !!store.settings.imageGen, imageModel: store.settings.imageModel || '', imageMax: store.settings.imageMax || 2,
      aiMode: store.settings.aiMode === 'off' ? 'off' : 'on',
      poster: store.settings.poster !== false,
      topicChoice: store.settings.topicChoice !== false,
      groupMode: groupOn(), groupCount: store.settings.groupCount || 8, groupPlan: store.settings.groupPlan || {},
      observerPassword: store.settings.observerPassword || '',
      observerClasses: store.settings.observerClasses || [],
      padletTemplate: store.settings.padletTemplate || '',
      padlet: {
        keySet: !!store.settings.padletApiKey, keyHint: maskKey(store.settings.padletApiKey || ''), lastError: padletLastError,
        classes: Object.fromEntries(Object.keys(store.settings.padlet || {}).map((c) => [c, padSummary(padCfg(c, 'solo'))])),
        groupClasses: Object.fromEntries(Object.keys(store.settings.padlet || {}).map((c) => [c, padSummary(padCfg(c, 'group'))])),
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

// 교실 현황판 자료. mask 가 true 이면(참관자) 이름은 성만 남기고, 학생이 쓴 문장은 빼고 준다.
// 참관 교사에게 보여 줄 반: 교사가 고른 반(지금 명단에 있는 반만). 비어 있으면 null = 모든 반.
function obsAllowed() {
  const sel = store.settings.observerClasses || [];
  if (!sel.length) return null;
  const have = new Set(store.students.map((s) => s.cls));
  const ok = sel.filter((c) => have.has(c));
  return ok.length ? ok : ['\u0000'];   // 고른 반이 모두 명단에서 사라졌다면 아무 반도 보이지 않게
}
async function boardData(cls, mask) {
      const allow = mask ? obsAllowed() : null;
      const now = Date.now();
      const lastBy = new Map();
      const tally = new Map();
      const vr = viewRound('');
      for (let i = store.records.length - 1; i >= 0; i--) {
        const r = store.records[i];
        if (vr && recRound(r) !== vr) continue;
        if (!lastBy.has(r.sid)) lastBy.set(r.sid, r);
        const t = tally.get(r.sid) || { tries: 0, correct: 0 };
        t.tries++; if (finalVerdict(r) === 'correct') t.correct++;
        tally.set(r.sid, t);
      }
      const classes = {};
      const students = [];
      for (const s of store.students) {
        if (allow && !allow.includes(s.cls)) continue;
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
  if (mask) for (const x of students) { x.name = (x.name || '').slice(0, 1) + '○'.repeat(Math.max(0, (x.name || '').length - 1)); x.sentence = ''; x.level = ''; }
  return {
    students, seats: store.seats, cols: SEAT_COLS, groupMode: groupOn(),
    classes: Object.keys(classes).sort((a, b) => a.localeCompare(b, 'ko', { numeric: true })).map((c) => ({ cls: c, count: classes[c] })),
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

  // ----- 참관자(수업 참관용 공용 비밀번호; 여러 명이 동시에 쓸 수 있다) -----
  // 학생 화면 체험용 토큰: 개인 학습('solo') 또는 모둠 학습('group')
  if (method === 'POST' && pathname === '/api/observer/demo-token') {
    observerAuth(req);
    if (!store.settings.observerPassword) throw new HttpError(401, '참관 계정이 닫혔어요.');
    const b = await readBody(req, 256);
    return send(res, 200, { token: sign({ r: 'o', dm: b.mode === 'group' ? 'group' : 'solo', exp: Date.now() + 8 * HOUR }) });
  }
  if (method === 'POST' && pathname === '/api/observer/login') {
    if (rateLimited('ologin:' + ip, 20, 60 * 1000)) throw new HttpError(429, '잠시 후 다시 시도해 주세요.');
    const b = await readBody(req, 1024);
    const pw = store.settings.observerPassword || '';
    if (!pw) throw new HttpError(403, '참관 계정이 아직 열려 있지 않아요. 선생님께 문의해 주세요.');
    const a = crypto.createHash('sha256').update(String(b.password || '')).digest();
    const c = crypto.createHash('sha256').update(pw).digest();
    if (!crypto.timingSafeEqual(a, c)) throw new HttpError(401, '참관 비밀번호가 맞지 않아요.');
    return send(res, 200, { token: sign({ r: 'o', exp: Date.now() + 8 * HOUR }) });
  }
  // 참관자용 모둠 현황판: 이름은 가리고, 학생이 쓴 문장은 보내지 않는다(진행 상태만)
  if (method === 'GET' && pathname === '/api/observer/gboard') {
    observerAuth(req);
    if (!store.settings.observerPassword) throw new HttpError(401, '참관 계정이 닫혔어요.');
    let cls = query.get('cls') || '';
    const allow = obsAllowed();
    if (allow && !allow.includes(cls)) cls = allow[0];
    if (!cls) cls = (store.students[0] || {}).cls || '';
    const d = await gboardData(cls, viewRound(''));
    const mask = (n) => (n || '').slice(0, 1) + '○'.repeat(Math.max(0, (n || '').length - 1));
    for (const g of d.groups) {
      for (const m of g.members) { m.name = mask(m.name); m.sid = ''; }
      for (const x of g.slots) { x.sentence = ''; x.by = ''; x.id = ''; x.noteN = (x.notes || []).length; x.notes = []; }
    }
    d.unassigned = d.unassigned.map((x) => ({ name: mask(x.name), no: x.no, online: x.online }));
    return send(res, 200, d);
  }
  if (method === 'GET' && pathname === '/api/observer/board') {
    observerAuth(req);
    if (!store.settings.observerPassword) throw new HttpError(401, '참관 계정이 닫혔어요.');
    return send(res, 200, await boardData(query.get('cls') || '', true));
  }

  if (method === 'GET' && pathname === '/api/me') {
    const st = studentAuth(req);
    const ar = activeRound();
    const sm = (ar && statsMap(0, ar.id).get(st.sid)) || { tries: 0, correct: 0 };
    if (st.demo && !store.settings.observerPassword) throw new HttpError(401, '참관 계정이 닫혔어요.');
    return send(res, 200, {
      student: { sid: st.sid, name: st.name, cls: st.cls, no: st.no },
      stats: { tries: sm.tries, correct: sm.correct },
      history: myHistory(st, 150),
      round: st.demo ? { id: 'demo', no: 0, name: '체험' } : roundPub(ar),
      open: store.settings.open,
      poster: store.settings.poster !== false,
      imageGen: !!store.settings.imageGen && !!(store.settings.geminiApiKey || process.env.GEMINI_API_KEY), imageMax: store.settings.imageMax || 2,
      topicChoice: store.settings.topicChoice !== false,
      topicList: store.settings.topicChoice !== false ? C.snapshot().topics.filter((x) => !x.off).map((x) => x.label) : [],
      padletTemplate: store.settings.padletTemplate || '',
      padlet: st.demo ? { post: true, link: '', board: false, demo: true } : padletFor(st),
      group: groupView(st),
      demo: !!st.demo,
    });
  }

  // 모둠 화면용: 모둠원이 지금 어디까지 했는지(가볍게 자주 읽는다)
  if (method === 'GET' && pathname === '/api/group') {
    const st = studentAuth(req);
    return send(res, 200, { group: groupView(st) });
  }

  if (method === 'POST' && pathname === '/api/challenge') {
    const st = studentAuth(req);
    if (!st.demo && !store.settings.open) throw new HttpError(403, '지금은 수업이 닫혀 있어요.');
    const ar = st.demo ? null : activeRound();
    if (!st.demo && !ar) throw new HttpError(403, '지금 열려 있는 회차가 없어요. 선생님이 새 회차를 열면 조건을 받을 수 있어요. 지난 회차는 [내 기록 보기]에서 볼 수 있어요.');
    // 학생별 난이도: 하 → 짜임은 쉬운 것만, 성분 개수는 가장 적게 / 상 → 기본 조건만, 성분 개수는 가장 많게
    const own = st.level === 'easy' || st.level === 'basic' ? st.level : '';
    let ids, cid = '', gk = '';
    if (st.dg) {   // 참관자의 모둠 학습 체험
      const b0 = await readBody(req, 512);
      const sl = demoSlots()[parseInt(b0.slot, 10)];
      if (!sl) throw new HttpError(400, '체험 모둠 문제를 찾을 수 없어요.');
      ids = sl.ids; cid = sl.n;
    } else if (groupOn() && !st.demo) {
      // 모둠 활동: 모둠 목록에서 고른 문제의 조건을 그대로 받는다(모둠원이 모두 같은 조건)
      const b0 = await readBody(req, 512);
      gk = groupKey(st);
      if (!gk) throw new HttpError(400, '먼저 모둠을 골라 주세요.');
      requireLeader(st);
      const sl = groupSlots(st.cls, store.groupOf(st.sid))[parseInt(b0.slot, 10)];
      if (!sl) throw new HttpError(400, '모둠 문제를 찾을 수 없어요. 화면을 새로고침해 주세요.');
      ids = sl.ids; cid = sl.n;
    } else ids = C.draw(own || store.settings.level, rnd, recentConditions(st.sid), own === 'easy' ? 'min' : own === 'basic' ? 'max' : '');
    const resolved = C.resolve(ids);
    const token = sign({ r: 'c', sid: st.sid, ids, n: cid || store.newId(), g: gk, rd: ar ? ar.id : '', exp: Date.now() + 4 * HOUR });
    if (!st.demo) activity.set(st.sid, { typingAt: 0, draftLen: 0, challengeAt: Date.now() });
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
    if (st.demo) return send(res, 200, { ok: true });
    const b = await readBody(req, 512);
    const n = Math.max(0, Math.min(1000, parseInt(b.n, 10) || 0));
    if (rateLimited('typing:' + st.sid, 30, 60 * 1000)) return send(res, 200, { ok: true });
    const a = activity.get(st.sid) || { typingAt: 0, draftLen: 0, challengeAt: 0 };
    a.draftLen = n; a.typingAt = n > 0 ? Date.now() : 0;
    activity.set(st.sid, a);
    return send(res, 200, { ok: true });
  }

  // 모둠 고르기: 아직 모둠이 없는 학생이 한 번 고를 수 있다. 잘못 골랐다면 선생님이 옮겨 준다.
  if (method === 'POST' && pathname === '/api/group/join') {
    const st = studentAuth(req);
    if (st.demo || !groupOn()) throw new HttpError(400, '지금은 모둠 활동이 아니에요.');
    if (rateLimited('gjoin:' + st.sid, 10, 60 * 1000)) throw new HttpError(429, '잠시 뒤에 다시 해 주세요.');
    const b = await readBody(req, 256);
    const no = parseInt(b.no, 10);
    if (!(no >= 1 && no <= (store.settings.groupCount || 8))) throw new HttpError(400, '모둠 번호를 다시 골라 주세요.');
    if (store.groupOf(st.sid)) throw new HttpError(400, '이미 모둠이 정해졌어요. 바꾸려면 선생님께 말씀드려 주세요.');
    store.setGroup(st.sid, no);
    return send(res, 200, { group: groupView(st) });
  }

  // 아이디어 연습장에 한 줄 덧붙이기(제출이 아니다). 모둠원 누구나 가능, 지우거나 고칠 수 없다.
  if (method === 'POST' && pathname === '/api/group/note') {
    const st = studentAuth(req);
    if (st.demo || !groupOn()) throw new HttpError(400, '지금은 모둠 활동이 아니에요.');
    const ar = activeRound();
    if (!ar) throw new HttpError(403, '지금 열려 있는 회차가 없어요. 지난 회차의 연습장은 고칠 수 없어요.');
    if (rateLimited('gnote:' + st.sid, 12, 60 * 1000)) throw new HttpError(429, '너무 빨리 적고 있어요. 잠시 뒤에 다시 해 주세요.');
    const b = await readBody(req, 2048);
    const no = store.groupOf(st.sid);
    if (!no) throw new HttpError(400, '먼저 모둠을 골라 주세요.');
    const text = String(b.text || '').replace(/\r/g, '').trim().slice(0, 300);
    if (!text) throw new HttpError(400, '적을 내용을 입력해 주세요.');
    const sl = groupSlots(st.cls, no)[parseInt(b.slot, 10)];
    if (!sl) throw new HttpError(400, '모둠 문제를 찾을 수 없어요. 화면을 새로고침해 주세요.');
    store.addNote({ ts: Date.now(), rd: ar.id, gk: groupKey(st), gno: no, cid: sl.n, slot: sl.i, sid: st.sid, name: st.name, cls: st.cls, text });
    return send(res, 200, { group: groupView(st) });
  }

  // 모둠장이 [포스터를 올렸어요]를 누르면 모둠원 화면도 그 단계까지 끝난 것으로 보인다
  if (method === 'POST' && pathname === '/api/group/roomdone') {
    const st = studentAuth(req);
    if (st.demo || !groupOn()) throw new HttpError(400, '지금은 모둠 활동이 아니에요.');
    requireLeader(st);
    requirePhase2(st);
    const b = await readBody(req, 256);
    const rec = store.getRecord(String(b.id || ''));
    if (!rec || !rec.gk || rec.gk !== groupKey(st)) throw new HttpError(404, '문장을 찾을 수 없어요.');
    if (!activeRound() || recRound(rec) !== activeRound().id) throw new HttpError(403, '끝난 회차의 내용은 고칠 수 없어요.');
    if (finalVerdict(rec) !== 'correct') throw new HttpError(400, '문법 조건을 통과한 문장만 진행할 수 있어요.');
    store.patchRecord(rec.id, { roomDone: b.undo ? 0 : Date.now() });
    return send(res, 200, { ok: true });
  }

  // 학생의 광고문구를 그 학생 번호의 패들렛 섹션(소회의실)에 글로 올린다. 올릴 곳은 서버가 번호로 정하고, 글도 서버의 기록으로 만든다.
  if (method === 'POST' && pathname === '/api/padlet/post') {
    const st = studentAuth(req);
    if (st.demo) return send(res, 200, { ok: true, at: Date.now(), link: '', demo: true });
    const b = await readBody(req, 4096);
    const { cfg, room } = padletRoom(st);
    if (!store.settings.padletApiKey || !cfg || !cfg.boardId || !room || !room.section) throw new HttpError(400, '내 패들렛 방이 아직 연결되지 않았어요. 선생님께 알려 주세요.');
    if (rateLimited('padlet:' + st.sid, 6, 60 * 1000)) throw new HttpError(429, '너무 빨리 올리고 있어요. 잠시 뒤에 다시 해 주세요.');
    const rec = store.getRecord(String(b.id || ''));
    if (!rec || (rec.sid !== st.sid && !(rec.gk && rec.gk === groupKey(st)))) throw new HttpError(404, '올릴 문장을 찾지 못했어요.');
    if (!activeRound() || recRound(rec) !== activeRound().id) throw new HttpError(403, '끝난 회차의 내용은 고칠 수 없어요.');
    if (finalVerdict(rec) !== 'correct') throw new HttpError(400, '문법 조건을 통과한 문장만 올릴 수 있어요.');
    if (rec.gk) requireLeader(st);
    if (rec.padletAt && !b.again) return send(res, 200, { ok: true, already: true, at: rec.padletAt });
    const gno = rec.gk ? store.groupOf(st.sid) : 0;
    const gp = gno ? PosterLib.groupPadlet({ no: gno, names: groupMembers(st.cls, gno).map((x) => x.name), comp: rec.compLabel, struct: rec.structLabel, topic: rec.topicLabel, sentence: rec.sentence }) : null;
    const text = gp ? gp.body : PosterLib.fillTemplate(store.settings.padletTemplate, {
      '이름': st.name, '학번': st.sid, '반': st.cls, '광고문구': rec.sentence, '성분조건': rec.compLabel, '짜임조건': rec.structLabel, '주제': rec.topicLabel,
    });
    const out = await PADLET.createPost({ key: store.settings.padletApiKey, boardId: cfg.boardId, section: room.section, subject: gp ? gp.subject : `${st.no ? st.no + '번 ' : ''}${st.name}`, body: text });
    if (!out.ok) {
      padletLastError = `${new Date().toLocaleTimeString('ko-KR')} ${st.cls} ${st.no}번: ${out.status || '연결 실패'} ${out.detail || ''}`.slice(0, 300);
      console.log('[패들렛 오류]', padletLastError);
      throw new HttpError(502, out.message);
    }
    padletLastError = '';
    store.patchRecord(rec.id, { padletAt: Date.now() });
    return send(res, 200, { ok: true, at: Date.now(), link: room.link || '' });
  }

  // 학생이 만든 포스터 프롬프트로 Gemini 이미지를 만들어, 바로 그 학생(모둠) 패들렛 방에 올린다. 문장(학생·모둠)당 횟수를 제한한다.
  if (method === 'POST' && pathname === '/api/poster/image') {
    const st = studentAuth(req);
    if (st.demo) return send(res, 200, { ok: true, demo: true, left: 1 });
    if (!store.settings.imageGen) throw new HttpError(403, '지금은 이미지 만들기가 닫혀 있어요.');
    if (!activeRound()) throw new HttpError(403, '지금 열려 있는 회차가 없어요.');
    const gcfg = aiConfig('gemini');
    if (!gcfg.apiKey) throw new HttpError(400, 'Gemini API 키가 아직 없어요. 선생님께 알려 주세요.');
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new HttpError(400, '이미지 저장소가 연결되지 않은 서버예요. 선생님께 알려 주세요.');
    if (rateLimited('img:' + st.sid, 4, 60 * 1000)) throw new HttpError(429, '너무 빨리 누르고 있어요. 잠시 뒤에 다시 해 주세요.');
    const b = await readBody(req, 16 * 1024);
    const rec = store.getRecord(String(b.id || ''));
    if (!rec || (rec.sid !== st.sid && !(rec.gk && rec.gk === groupKey(st)))) throw new HttpError(404, '문장을 찾지 못했어요.');
    if (recRound(rec) !== activeRound().id) throw new HttpError(403, '끝난 회차의 내용은 고칠 수 없어요.');
    if (finalVerdict(rec) !== 'correct') throw new HttpError(400, '문법 조건을 통과한 문장만 이미지를 만들 수 있어요.');
    if (rec.gk) requireLeader(st);
    const prompt = String(b.prompt || '').trim().slice(0, 4000);
    if (!prompt) throw new HttpError(400, '프롬프트가 비어 있어요.');
    const max = store.settings.imageMax || 2;
    if ((rec.imgN || 0) >= max) throw new HttpError(429, `이 문장은 이미지를 ${max}번 모두 만들었어요.`);
    if (imgBusy.has(rec.id)) throw new HttpError(429, '이미지를 만드는 중이에요. 잠시만 기다려 주세요.');
    imgBusy.add(rec.id);
    store.patchRecord(rec.id, { imgN: (rec.imgN || 0) + 1 });   // 먼저 한 번 쓴 것으로 치고, 실패하면 돌려준다
    const refund = () => store.patchRecord(rec.id, { imgN: Math.max(0, (store.getRecord(rec.id).imgN || 1) - 1) });
    let saved = false;
    try {
      const g = await IMAGES.generate({ key: gcfg.apiKey, base: gcfg.baseUrl ? gcfg.baseUrl.replace(/\/+$/, '') + '/v1beta' : '', model: store.settings.imageModel || process.env.GEMINI_IMAGE_MODEL || '', prompt });
      if (!g.ok) throw new HttpError(502, g.message);
      const url = await IMAGES.save({ buf: g.buf, mime: g.mime, name: `${rec.id}-${Date.now().toString(36)}`, env: process.env });
      if (!url) throw new HttpError(502, '이미지를 저장하지 못했어요. 선생님께 알려 주세요.');
      const mine = store.getRecord(rec.id);
      store.patchRecord(rec.id, { posterImg: { url, at: Date.now(), by: st.name, prompt, posted: false }, posterImgs: [...(mine.posterImgs || []), url].slice(-10) });
      saved = true;
      return send(res, 200, { ok: true, url, left: Math.max(0, max - (store.getRecord(rec.id).imgN || 0)) });
    } catch (e) {
      if (!saved) refund();   // 그림이 저장되기 전에 실패했으면 횟수를 돌려준다
      if (e instanceof HttpError) throw e;
      console.error('[이미지 오류]', e && e.message);
      throw new HttpError(502, '이미지를 만들지 못했어요. 잠시 뒤에 다시 해 주세요. (횟수는 줄지 않았어요)');
    } finally { imgBusy.delete(rec.id); }
  }

  // 만들어 둔 그림을 패들렛 방에 올린다. 이미 올렸으면 다시 올리지 않는다(실패했을 때 다시 시도하는 용도).
  if (method === 'POST' && pathname === '/api/poster/image/post') {
    const st = studentAuth(req);
    if (st.demo) return send(res, 200, { ok: true, posted: true, demo: true });
    const b = await readBody(req, 2048);
    const rec = store.getRecord(String(b.id || ''));
    if (!rec || (rec.sid !== st.sid && !(rec.gk && rec.gk === groupKey(st)))) throw new HttpError(404, '문장을 찾지 못했어요.');
    if (!activeRound() || recRound(rec) !== activeRound().id) throw new HttpError(403, '끝난 회차의 내용은 고칠 수 없어요.');
    if (rec.gk) requireLeader(st);
    const pi = rec.posterImg;
    if (!pi || !pi.url) throw new HttpError(400, '올릴 그림이 아직 없어요.');
    const { cfg, room } = padletRoom(st);
    if (pi.posted) return send(res, 200, { ok: true, posted: true, already: true, link: room && room.link || '' });
    if (!store.settings.padletApiKey || !cfg || !cfg.boardId || !room || !room.section) throw new HttpError(400, '내 패들렛 방이 아직 연결되지 않았어요. 선생님께 알려 주세요.');
    if (imgBusy.has('p' + rec.id)) throw new HttpError(429, '올리는 중이에요. 잠시만 기다려 주세요.');
    imgBusy.add('p' + rec.id);
    try {
      const gno = rec.gk ? store.groupOf(st.sid) : 0;
      const gp = gno ? PosterLib.groupPadlet({ no: gno, names: groupMembers(st.cls, gno).map((x) => x.name), comp: rec.compLabel, struct: rec.structLabel, topic: rec.topicLabel, sentence: rec.sentence }) : null;
      const t0 = Date.now(); store.patchRecord(rec.id, { imgDiag: { step: 'padlet-start', at: t0 } });
      const out = await PADLET.createPost({ key: store.settings.padletApiKey, boardId: cfg.boardId, section: room.section, subject: gp ? gp.subject : `${st.no ? st.no + '번 ' : ''}${st.name}`, body: gp ? gp.body : rec.sentence, imageUrl: pi.url });
      store.patchRecord(rec.id, { imgDiag: { step: 'padlet-done', ms: Date.now() - t0, ok: !!out.ok, status: out.status || 0, detail: String(out.detail || '').slice(0, 200), at: Date.now() } });
      if (!out.ok) {
        const em = `${new Date().toLocaleTimeString('ko-KR')} ${st.cls} ${st.no}번(이미지): ${out.status || '연결 실패'} ${out.detail || ''}`.slice(0, 300);
        console.log('[패들렛 오류]', em);
        if (typeof store.setPadletErr === 'function') store.setPadletErr(em); else padletLastError = em;
        throw new HttpError(502, out.message || '패들렛에 올리지 못했어요.');
      }
      store.patchRecord(rec.id, { posterImg: Object.assign({}, pi, { posted: true, postedAt: Date.now() }), padletAt: Date.now() });
      try {   // 진단: 저장이 막히거나 실패하면 화면에 이유가 보이게 한다
        await Promise.race([store.flush(), new Promise((_, rej) => setTimeout(() => rej(new Error('저장이 8초 넘게 끝나지 않았어요')), 8000))]);
      } catch (e) { throw new HttpError(502, '패들렛에는 올렸지만 기록을 저장하지 못했어요: ' + String((e && e.message) || e).slice(0, 160)); }
      return send(res, 200, { ok: true, posted: true, link: room.link || '' });
    } finally { imgBusy.delete('p' + rec.id); }
  }

  if (method === 'POST' && pathname === '/api/submit') {
    const st = studentAuth(req);
    if (!st.demo && !store.settings.open) throw new HttpError(403, '지금은 수업이 닫혀 있어요.');
    const b = await readBody(req, 8192);
    const ch = verify(b.token);
    if (!ch || ch.r !== 'c' || ch.sid !== st.sid) throw new HttpError(410, '조건이 만료되었어요. 새 조건을 받아 주세요.');
    const ar = st.demo ? null : activeRound();
    if (!st.demo && (!ar || (ch.rd || roundsList()[0].id) !== ar.id)) throw new HttpError(410, '이 회차는 끝났어요. 지난 회차의 내용은 [내 기록 보기]에서 볼 수 있고, 선생님이 새 회차를 열면 새 조건을 받을 수 있어요.');
    const resolved = C.resolve(ch.ids);
    if (!resolved) throw new HttpError(410, '조건을 찾을 수 없어요. 새 조건을 받아 주세요.');

    const sentence = String(b.sentence || '').replace(/\s+/g, ' ').trim();
    if (sentence.length < 2) throw new HttpError(400, '문장을 입력해 주세요.');
    if (sentence.length > 200) throw new HttpError(400, '200자 이내의 한 문장으로 써 주세요.');
    if (!/[가-힣]/.test(sentence)) throw new HttpError(400, '한글로 문장을 써 주세요.');

    if (rateLimited('submit:' + (st.demo ? 'demo:' + ip : st.sid), st.demo ? 20 : 12, 60 * 1000)) throw new HttpError(429, '너무 빨리 제출하고 있어요. 잠시 뒤에 다시 제출해 주세요.');
    if (ch.g && ch.g !== groupKey(st)) throw new HttpError(410, '모둠이 바뀌었어요. 모둠 화면에서 다시 시작해 주세요.');
    if (ch.g) requireLeader(st);
    const attempt = st.demo ? (demoTries.set(ch.n, (demoTries.get(ch.n) || 0) + 1), demoTries.get(ch.n)) : store.records.filter((r) => r.cid === ch.n && (ch.g || r.sid === st.sid) && (!ar || recRound(r) === ar.id)).length + 1;
    if (attempt > 25) throw new HttpError(429, '이 조건으로는 충분히 도전했어요. 새 조건을 받아 주세요.');

    // 학생이 목록에서 고른 주제(선생님이 허용한 경우). 주제는 채점하지 않고 기록과 예시 문장에만 쓴다.
    const wanted = store.settings.topicChoice === false ? '' : String(b.topicText || '').replace(/\s+/g, ' ').trim();
    const topicText = C.snapshot().topics.some((x) => !x.off && x.label === wanted) ? wanted : '';  // 목록에 있는 주제만 인정
    const topicLabel = topicText || resolved.topic.label;
    const topicCustom = !!topicText && topicText !== resolved.topic.label;
    const gradeInput = topicCustom ? Object.assign({}, resolved, { topic: { id: 'custom:' + topicText, label: topicText } }) : resolved;
    const manual = !st.demo && store.settings.aiMode === 'off';
    const out = manual ? { ok: false, code: 'manual', message: '' } : await grader.grade(gradeInput, sentence);
    const fields = resultFields(out);
    if (manual) { fields.pendingReason = ''; fields.manual = true; }
    { const a = activity.get(st.sid); if (a) { a.typingAt = 0; a.draftLen = 0; } }
    const rec = st.demo ? { id: 'demo-' + ch.n + '-' + attempt } : store.addRecord(Object.assign({
      ts: Date.now(), sid: st.sid, name: st.name, cls: st.cls, cid: ch.n, attempt, rd: ar.id,
      comp: ch.ids.comp, struct: ch.ids.struct, topic: ch.ids.topic,
      compLabel: resolved.comp.label, structLabel: resolved.struct.label, topicLabel, topicCustom,
      sentence, flagged: false,
    }, ch.g ? { gk: ch.g, gno: store.groupOf(st.sid) } : {}, fields));

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
    if (st.demo) return send(res, 200, { id: 'demo' });
    if (store.settings.poster === false) throw new HttpError(403, '지금은 포스터 프롬프트 만들기가 닫혀 있어요.');
    if (!activeRound()) throw new HttpError(403, '지금 열려 있는 회차가 없어요. 지난 회차의 내용은 고칠 수 없어요.');
    requirePhase2(st);
    if (rateLimited('poster:' + st.sid, 20, 60 * 1000)) throw new HttpError(429, '너무 빨리 만들고 있어요. 잠시 뒤에 다시 해 주세요.');
    const b = await readBody(req, 32 * 1024);
    const prompt = String(b.prompt || '').trim().slice(0, 4000);
    if (!prompt) throw new HttpError(400, '프롬프트가 비어 있어요.');
    const opts = {};
    if (b.opts && typeof b.opts === 'object') {
      for (const [k, v] of Object.entries(b.opts).slice(0, 30)) if (typeof v === 'string') opts[String(k).slice(0, 20)] = v.slice(0, 300);
    }
    if (groupOn() && b.recId) {   // 모둠: 포스터 선택·만들기는 모둠장만. 선택 내용은 문장 기록에 붙여 모둠원 화면에 보여 준다
      requireLeader(st);
      const rec = store.getRecord(String(b.recId));
      if (!rec || !rec.gk || rec.gk !== groupKey(st)) throw new HttpError(404, '문장을 찾을 수 없어요.');
      if (!activeRound() || recRound(rec) !== activeRound().id) throw new HttpError(403, '끝난 회차의 내용은 고칠 수 없어요.');
      if (finalVerdict(rec) !== 'correct') throw new HttpError(400, '문법 조건을 통과한 문장만 포스터를 만들 수 있어요.');
      store.patchRecord(rec.id, { poster: { opts, prompt, promptEn: String(b.promptEn || '').trim().slice(0, 4000), by: st.name, at: Date.now() }, roomDone: 0 });
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
    if (st.demo) return send(res, 200, { ok: true });
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

    // 회차 열기: 열려 있는 회차가 없을 때만. 지금 설정(난이도·모둠 활동·모둠 문장 수·조건)이 이 회차의 조건이 된다.
    if (method === 'POST' && pathname === '/api/teacher/round/open') {
      const b = await readBody(req, 1024);
      if (activeRound()) throw new HttpError(400, '열려 있는 회차가 있어요. 먼저 그 회차를 닫아 주세요.');
      const list = roundsList().slice();
      const no = list.reduce((m, x) => Math.max(m, x.no || 0), 0) + 1;
      const s = store.settings;
      const round = { id: 'r' + no, no, name: clip(b.name, 40) || `${no}회차`, openedAt: Date.now(), closedAt: 0, level: s.level, groupMode: s.groupMode === true, groupCount: s.groupCount || 8, groupPlan: s.groupPlan || {}, split: b.split === true, phase: 1, note: clip(b.note, 200) };
      list.push(round);
      store.updateSettings({ rounds: list, open: true, groupSeed: (Number(s.groupSeed) || 1) + 1 });   // 새 회차는 모둠도 새 조건을 받는다
      grader.cache.clear();
      return send(res, 200, teacherInfo());
    }
    if (method === 'POST' && pathname === '/api/teacher/round/close') {
      const ar = activeRound();
      if (!ar) throw new HttpError(400, '열려 있는 회차가 없어요.');
      const list = roundsList().map((x) => (x.id === ar.id ? Object.assign({}, x, { closedAt: Date.now() }) : x));
      store.updateSettings({ rounds: list });
      return send(res, 200, teacherInfo());
    }
    if (method === 'POST' && pathname === '/api/teacher/round/phase') {   // 2차시 열기(1차시로 되돌리기도 가능)
      const b = await readBody(req, 256);
      const ar = activeRound();
      if (!ar) throw new HttpError(400, '열려 있는 회차가 없어요.');
      if (!ar.split) throw new HttpError(400, '이 회차는 차시를 나누지 않고 열었어요.');
      store.updateSettings({ rounds: roundsList().map((x) => (x.id === ar.id ? Object.assign({}, x, { phase: b.phase === 1 ? 1 : 2 }) : x)) });
      return send(res, 200, teacherInfo());
    }
    if (method === 'POST' && pathname === '/api/teacher/round/rename') {
      const b = await readBody(req, 512);
      const name = clip(b.name, 40);
      if (!name) throw new HttpError(400, '회차 이름을 입력해 주세요.');
      if (!roundsList().some((x) => x.id === b.id)) throw new HttpError(404, '회차를 찾을 수 없어요.');
      store.updateSettings({ rounds: roundsList().map((x) => (x.id === b.id ? Object.assign({}, x, { name }) : x)) });
      return send(res, 200, teacherInfo());
    }

    if (method === 'PUT' && pathname === '/api/teacher/settings') {
      const b = await readBody(req, 4096);
      const patch = {};
      if (b.level !== undefined) patch.level = b.level;
      if (b.open !== undefined) patch.open = !!b.open;
      if (b.revealAfter !== undefined) patch.revealAfter = parseInt(b.revealAfter, 10);
      if (b.aiMode !== undefined) patch.aiMode = b.aiMode === 'off' ? 'off' : 'on';
      if (b.poster !== undefined) patch.poster = !!b.poster;
      if (b.topicChoice !== undefined) patch.topicChoice = !!b.topicChoice;
      if (b.groupMode !== undefined) patch.groupMode = !!b.groupMode;
      if (b.groupCount !== undefined) patch.groupCount = parseInt(b.groupCount, 10);
      if (b.groupPlan && typeof b.groupPlan === 'object') patch.groupPlan = b.groupPlan;
      if (b.groupReseed) patch.groupSeed = (Number(store.settings.groupSeed) || 1) + 1;
      if (typeof b.padletTemplate === 'string') patch.padletTemplate = b.padletTemplate;
      if (typeof b.observerPassword === 'string') patch.observerPassword = b.observerPassword;
      if (Array.isArray(b.observerClasses)) patch.observerClasses = b.observerClasses;
      if (typeof b.apiKey === 'string' && b.apiKey.trim()) patch.apiKey = b.apiKey;
      if (b.clearApiKey) patch.apiKey = '';
      if (typeof b.model === 'string') patch.model = b.model;
      if (b.provider === 'claude' || b.provider === 'gemini') patch.provider = b.provider;
      if (typeof b.geminiKey === 'string' && b.geminiKey.trim()) patch.geminiApiKey = b.geminiKey;
      if (b.clearGeminiKey) patch.geminiApiKey = '';
      if (typeof b.geminiModel === 'string') patch.geminiModel = b.geminiModel;
      if (b.imageGen !== undefined) patch.imageGen = !!b.imageGen;
      if (typeof b.imageModel === 'string') patch.imageModel = b.imageModel;
      if (b.imageMax !== undefined) patch.imageMax = parseInt(b.imageMax, 10);
      store.updateSettings(patch);
      grader.cache.clear();
      return send(res, 200, teacherInfo());
    }

    // 이미지 만들기 시험: 작은 그림 하나를 만들어 키·모델이 되는지만 확인한다 (패들렛에는 올리지 않는다)
    if (method === 'POST' && pathname === '/api/teacher/image-test') {
      const gcfg = aiConfig('gemini');
      const g = await IMAGES.generate({ key: gcfg.apiKey, base: gcfg.baseUrl ? gcfg.baseUrl.replace(/\/+$/, '') + '/v1beta' : '', model: store.settings.imageModel || process.env.GEMINI_IMAGE_MODEL || '', prompt: 'A simple flat illustration of a red apple on a white background.' });
      if (!g.ok) return send(res, 200, { ok: false, message: g.message });
      const url = await IMAGES.save({ buf: g.buf, mime: g.mime, name: 'test-' + Date.now().toString(36), env: process.env });
      return send(res, 200, { ok: true, url: url || '', stored: !!url, message: url ? '이미지 만들기와 저장이 모두 잘 돼요.' : '이미지는 만들어졌지만 저장소(ml-poster 버킷)를 쓸 수 없어요.' });
    }

    // 모둠 편성 현황: 반별 학생의 모둠과 모둠별 진행(완성한 문장 수)
    if (method === 'GET' && pathname === '/api/teacher/groups') {
      const cls = query.get('cls') || '';
      const count = store.settings.groupCount || 8;
      const plan = store.settings.groupPlan || {};
      const students = store.students.filter((x) => !cls || x.cls === cls);
      const groups = [];
      for (let no = 1; no <= count; no++) {
        const ld0 = cls ? groupLeader(cls, no) : null;
        const members = students.filter((x) => store.groupOf(x.sid) === no).map((x) => ({ sid: x.sid, name: x.name, no: x.no, leader: !!ld0 && ld0.sid === x.sid }));
        let done = 0, total = 0;
        if (cls && members.length) { const v = groupView({ sid: members[0].sid, cls, name: '' }); total = v.total; done = v.slots.filter((x) => x.status === 'done').length; }
        groups.push({ no, members, done, total });
      }
      return send(res, 200, {
        count, mode: groupOn(), plan, planTotal: Object.values(plan).reduce((a, b) => a + b, 0),
        structs: C.snapshot().structs.map((x) => ({ id: x.id, label: x.label, level: x.level, off: !!x.off })),
        groups, unassigned: students.filter((x) => !store.groupOf(x.sid)).map((x) => ({ sid: x.sid, name: x.name, no: x.no })),
        all: students.map((x) => ({ sid: x.sid, name: x.name, no: x.no, g: store.groupOf(x.sid), leader: !!store.groupOf(x.sid) && !!groupLeader(x.cls, store.groupOf(x.sid)) && groupLeader(x.cls, store.groupOf(x.sid)).sid === x.sid })),
      });
    }
    // 학생의 모둠을 옮기거나(no 1~) 모둠에서 빼기(no 0)
    if (method === 'POST' && pathname === '/api/teacher/group/assign') {
      const b = await readBody(req, 2048);
      const sid = normSid(b.sid);
      const no = parseInt(b.no, 10) || 0;
      if (!store.studentBySid(sid)) throw new HttpError(404, '학생을 찾을 수 없어요.');
      if (no < 0 || no > (store.settings.groupCount || 8)) throw new HttpError(400, '모둠 번호가 올바르지 않아요.');
      store.setGroup(sid, no);
      return send(res, 200, { ok: true });
    }
    if (method === 'POST' && pathname === '/api/teacher/group/leader') {
      const b = await readBody(req, 512);
      const sid = normSid(b.sid);
      const stu = store.studentBySid(sid);
      const no = stu ? store.groupOf(sid) : 0;
      if (!stu || !no) throw new HttpError(400, '모둠에 들어 있는 학생만 모둠장이 될 수 있어요.');
      store.setLeader(`${stu.cls}|${no}`, sid);
      return send(res, 200, { ok: true });
    }
    if (method === 'GET' && pathname === '/api/teacher/gboard') {
      const cls = query.get('cls') || '';
      if (!cls) throw new HttpError(400, '반을 선택해 주세요.');
      return send(res, 200, Object.assign(await gboardData(cls, viewRound(query.get('rd') || '')), { rd: viewRound(query.get('rd') || ''), rounds: roundsList().map(roundPub) }));
    }
    if (method === 'POST' && pathname === '/api/teacher/group/clear') {
      const b = await readBody(req, 512);
      const cls = String(b.cls || '');
      for (const x of store.students) if (x.cls === cls && store.groupOf(x.sid)) store.setGroup(x.sid, 0);
      return send(res, 200, { ok: true });
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
        const bu = String(b.boardUrl || '').trim();
        if (bu && !PADLET.LINK_RE.test(bu)) throw new HttpError(400, '패들렛 주소는 https://padlet.com/ 으로 시작해야 해요.');
        const au = String(b.allUrl || '').trim();
        if (au && !PADLET.LINK_RE.test(au)) throw new HttpError(400, '전체 보기 링크는 https://padlet.com/ 으로 시작해야 해요.');
        patch.padletClass = { cls, kind: b.kind === 'group' ? 'group' : 'solo', boardId, rooms: parsed.rooms, boardUrl: bu, allUrl: au };
      }
      store.updateSettings(patch);
      return send(res, 200, Object.assign(teacherInfo(), { skipped }));
    }

    if (method === 'POST' && pathname === '/api/teacher/padlet/test') {
      const b = await readBody(req, 2048);
      const cfg = padCfg(String(b.cls || ''), b.kind === 'group' ? 'group' : 'solo');
      const out = await PADLET.test(store.settings.padletApiKey, cfg && cfg.boardId);
      return send(res, 200, out);
    }

    // 패들렛 주소 → 보드 ID·섹션 자동 불러오기 → 번호/이름으로 명단과 매칭 (규칙 먼저, 못 읽은 제목만 AI)
    if (method === 'POST' && pathname === '/api/teacher/padlet/import') {
      const b = await readBody(req, 4096);
      const cls = String(b.cls || '');
      const kind = b.kind === 'group' ? 'group' : 'solo';
      const roster = kind === 'group'
        ? Array.from({ length: store.settings.groupCount || 8 }, (_, i) => ({ no: i + 1, name: '' }))   // 모둠용: 섹션 제목의 번호 = 모둠 번호
        : store.students.filter((x) => x.cls === cls).map((x) => ({ no: Number(x.no), name: x.name })).filter((x) => x.no > 0);
      if (!store.students.some((x) => x.cls === cls)) throw new HttpError(400, '반을 선택해 주세요.');
      if (!roster.length) throw new HttpError(400, '이 반 학생들의 번호를 학번에서 읽지 못했어요. 명단을 5자리 학번(예: 20301)으로 등록해 주세요.');
      const boardId = PADLET.boardIdFromInput(b.url);
      const got = await PADLET.fetchSections(store.settings.padletApiKey, boardId);
      if (!got.ok) return send(res, 200, { ok: false, message: got.message, detail: got.detail || '' });
      const rows = PADLET.matchSections(got.sections, roster);
      let ai = { n: 0 };
      if (b.useAi && grader.configured()) {
        const maxNo = Math.max(...roster.map((x) => x.no));
        ai = (await PADLET.aiFill(rows, maxNo, (sy, um, mt) => grader.callApi(sy, um, mt), require('./lib/grader').extractJson)) || { n: 0 };
        // AI 가 찾은 번호는 이 반 명단에 있는 번호만 인정한다
        const has = new Set(roster.map((x) => x.no));
        for (const r of rows) if (r.by === 'AI' && !has.has(r.no)) { r.no = 0; r.by = ''; r.note = '명단에 없는 번호예요'; }
      }
      const cfg = padCfg(cls, kind) || { rooms: {} };
      const rooms = Object.assign({}, cfg.rooms || {});
      const matched = rows.filter((r) => r.no);
      for (const r of matched) rooms[String(r.no)] = { section: r.id, link: (rooms[String(r.no)] || {}).link || '' };
      const lines = Object.entries(rooms).sort((x, y) => x[0] - y[0]).map(([no, r]) => [no, r.section, r.link].filter(Boolean).join('\t'));
      const got_nos = new Set(matched.map((r) => r.no));
      return send(res, 200, {
        ok: true, boardId: got.boardId, boardUrl: got.boardUrl || '', title: got.title, total: rows.length, matched: matched.length, aiUsed: ai.n || 0, aiError: ai.error || '',
        aiAsked: !!b.useAi && grader.configured(),
        unmatched: rows.filter((r) => !r.no).map((r) => ({ title: r.title, note: r.note })),
        missing: roster.filter((x) => !got_nos.has(x.no)).map((x) => ({ no: x.no, name: kind === 'group' ? '모둠' : x.name, group: kind === 'group' })),
        byRule: matched.filter((r) => r.by !== 'AI').length,
        linksMissing: Object.entries(rooms).filter(([, r]) => !r.link).length,
        roomsText: lines.join('\n'),
      });
    }

    if (method === 'GET' && pathname === '/api/teacher/padlet/rooms') {
      const cfg = padCfg(query.get('cls') || '', query.get('kind') === 'group' ? 'group' : 'solo') || { boardId: '', rooms: {} };
      const lines = Object.entries(cfg.rooms || {}).sort((a, b) => a[0] - b[0]).map(([no, r]) => [no, r.section, r.link].filter(Boolean).join('\t'));
      return send(res, 200, { boardId: cfg.boardId || '', boardUrl: cfg.boardUrl || '', allUrl: cfg.allUrl || '', roomsText: lines.join('\n') });
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
    if (method === 'GET' && pathname === '/api/teacher/board') return send(res, 200, await boardData(query.get('cls') || '', false));

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
      const rdv = viewRound(query.get('rd') || '');
      const sm = statsMap(since, rdv);
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
        reviewOpen: open, rd: rdv, rounds: roundsList().map(roundPub),
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
      const gnoF = parseInt(query.get('gno'), 10) || 0;
      const rdF = viewRound(query.get('rd') || '');
      const before = parseInt(query.get('before'), 10) || Infinity;
      const limit = Math.min(parseInt(query.get('limit'), 10) || 100, 500);
      const out = [];
      for (let i = store.records.length - 1; i >= 0 && out.length < limit; i--) {
        const r = store.records[i];
        if (r.ts >= before || r.ts < since) continue;
        if (cls && r.cls !== cls) continue;
        if (sid && r.sid !== sid) continue;
        if (gnoF && r.gno !== gnoF) continue;
        if (rdF && recRound(r) !== rdF) continue;
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

    // 화면에 보이는 기록(선택한 id 목록)을 한꺼번에 지운다
    if (method === 'POST' && pathname === '/api/teacher/records/delete') {
      const b = await readBody(req, 64 * 1024);
      const ids = Array.isArray(b.ids) ? b.ids.slice(0, 500).map(String) : [];
      let n = 0;
      for (const id of ids) if (store.deleteRecord(id)) n++;
      return send(res, 200, { deleted: n });
    }

    // 한 반의 기록과 포스터 프롬프트를 모두 지운다(반을 반드시 지정해야 한다)
    if (method === 'POST' && pathname === '/api/teacher/class/reset') {
      const b = await readBody(req, 2048);
      const cls = String(b.cls || '');
      if (!cls) throw new HttpError(400, '반을 선택해 주세요.');
      const ids = store.records.filter((r) => r.cls === cls).map((r) => r.id);
      let n = 0;
      for (const id of ids) if (store.deleteRecord(id)) n++;
      for (const st of store.students.filter((x) => x.cls === cls)) store.deletePostersOf(st.sid);
      return send(res, 200, { deleted: n });
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
      const rdq = query.get('rd') || '';
      const rname = new Map(roundsList().map((x) => [x.id, x.name]));
      const rows = [['활동 회차', '일시', '반', '학번', '이름', '모둠', '문장 성분 조건', '문장의 짜임 조건', '공익광고 주제', '시도 횟수', '제출 문장', '최종 판정', 'AI 판정', '교사 수정', '학생 확인 요청', 'AI 피드백 요약', '교사 피드백']];
      const label = { correct: '정답', incorrect: '오답', pending: '판정 대기' };
      for (const r of store.records) {
        if (r.ts < since || (cls && r.cls !== cls) || (rdq && recRound(r) !== rdq)) continue;
        const fb = r.checks ? Object.values(r.checks).filter((c) => !c.ok).map((c) => c.reason).join(' / ') : (r.pendingReason || '');
        rows.push([rname.get(recRound(r)) || '', fmtTime(r.ts), r.cls, r.sid, r.name, r.gno || '', r.compLabel, r.structLabel, r.topicLabel, r.attempt, r.sentence,
          label[finalVerdict(r)] || '', (r.manual ? 'AI 미사용' : label[r.verdict]) || '', r.override ? (label[r.override.verdict] + (r.override.note ? ': ' + r.override.note : '')) : '',
          r.flagged ? '예' : '', fb, r.tfeedback || '']);
      }
      return sendFile(res, 200, '제출기록.csv', toCsv(rows), 'text/csv; charset=utf-8');
    }

    if (method === 'GET' && pathname === '/api/teacher/export/notes.csv') {
      const cls = query.get('cls') || '';
      const rname = new Map(roundsList().map((x) => [x.id, x.name]));
      const rows = [['활동 회차', '반', '모둠', '문장 번호', '작성자', '학번', '작성 시각', '아이디어']];
      for (const n of store.notes) {
        if (cls && n.cls !== cls) continue;
        rows.push([rname.get(n.rd) || '', n.cls, n.gno, (n.slot || 0) + 1, n.name, n.sid, fmtTime(n.ts), n.text]);
      }
      return sendFile(res, 200, '모둠아이디어연습장.csv', toCsv(rows), 'text/csv; charset=utf-8');
    }

    if (method === 'GET' && pathname === '/api/teacher/export/summary.csv') {
      const since = periodStart(query.get('period') || 'all');
      const cls = query.get('cls') || '';
      const sm = statsMap(since, query.get('rd') || '');
      const rows = [['반', '학번', '이름', '제출 수', '문법 정답 수', '문법 오답 수', '판정 대기', '정답률(%)', '교사 피드백 수', '마지막 제출']];
      for (const s of store.students) {
        if (cls && s.cls !== cls) continue;
        const t = sm.get(s.sid) || { tries: 0, correct: 0, incorrect: 0, pending: 0, topicTodo: 0, topicOk: 0, topicNo: 0, fb: 0, last: 0 };
        rows.push([s.cls, s.sid, s.name, t.tries, t.correct, t.incorrect, t.pending, t.tries ? Math.round((t.correct / t.tries) * 100) : '', t.fb, fmtTime(t.last)]);
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
