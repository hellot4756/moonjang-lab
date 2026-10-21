'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_SETTINGS = {
  level: 'mixed',        // 'easy' | 'basic' | 'mixed'
  open: true,            // 학생 입장 허용
  revealAfter: 3,        // 한 조건에서 N번 틀리면 예시 문장 공개 (0 = 공개 안 함)
  observerPassword: '', // 수업 참관용 공용 비밀번호(비어 있으면 참관 계정 꺼짐)
  padletTemplate: '',    // 패들렛 글 양식 (비어 있으면 기본 양식)
  padletApiKey: '',       // 패들렛 API 키 (교사 화면에는 가려서 보여 준다)
  padlet: {},             // { 반: { boardId, rooms: { 번호: { section, link } } } }
  topicChoice: true,     // 학생이 주제를 바꾸거나 직접 쓸 수 있게 하기
  poster: true,          // 학생에게 '포스터 프롬프트 만들기' 열기
  aiMode: 'on',          // 'on' = AI가 문법 판정 | 'off' = AI 없이 선생님이 직접 판정
  apiKey: '',
  model: '',
  provider: 'claude',    // 'claude' | 'gemini' (문장 판정에 쓸 AI)
  geminiApiKey: '',
  geminiModel: '',
  groupMode: false,      // true = 모둠 활동(모둠이 같은 조건을 받아 함께 문장·포스터를 만든다)
  groupCount: 8,         // 반별 모둠 수
  groupPlan: {},         // { 문장의 짜임 조건 id: 모둠이 만들 문장 수 }
  groupSeed: 1,          // 바꾸면 모든 모둠이 새 조건을 받는다
  rounds: [],            // 활동 회차: [{ id, no, name, openedAt, closedAt, ... }] 닫힌 회차는 학생이 고칠 수 없다
};

function normName(s) {
  return String(s || '').normalize('NFC').replace(/\s+/g, '');
}

function normSid(s) {
  return String(s || '').replace(/\D+/g, '');
}

// 5자리(예: 20312 = 2학년 3반 12번) 또는 4자리(예: 2312) 학번에서 반 이름을 만든다.
function classFromSid(sid) {
  if (/^\d{5}$/.test(sid)) return `${sid[0]}학년 ${parseInt(sid.slice(1, 3), 10)}반`;
  if (/^\d{4}$/.test(sid)) return `${sid[0]}학년 ${sid[1]}반`;
  return '';
}

function numberFromSid(sid) {
  if (/^\d{5}$/.test(sid)) return parseInt(sid.slice(3), 10);
  if (/^\d{4}$/.test(sid)) return parseInt(sid.slice(2), 10);
  return 0;
}

const SEAT_COLS = 6;   // 현황판 한 줄 칸 수

class Store {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.rosterFile = path.join(dir, 'roster.json');
    this.settingsFile = path.join(dir, 'settings.json');
    this.recordsFile = path.join(dir, 'records.jsonl');
    this.postersFile = path.join(dir, 'posters.jsonl');
    this.seatsFile = path.join(dir, 'seats.json');
    this.secretFile = path.join(dir, 'secret.key');
    this.students = this.readJson(this.rosterFile, []);
    this.seats = this.loadSeats();   // { 반: [학번 또는 '', ...] }  교실 현황판 자리 배치(한 줄 SEAT_COLS칸)
    this.groupsFile = path.join(dir, 'groups.json');
    this.groups = this.readJson(this.groupsFile, {});   // { 학번: 모둠 번호 }
    this.leadersFile = path.join(dir, 'leaders.json');
    this.leaders = this.readJson(this.leadersFile, {}); // { '반|모둠번호': 모둠장 학번 } (없으면 모둠에서 번호가 가장 앞선 학생)
    this.settings = Object.assign({}, DEFAULT_SETTINGS, this.readJson(this.settingsFile, {}));
    this.secret = this.loadSecret();
    this.records = [];
    this.byId = new Map();
    this.loadRecords();
    this.posters = [];
    this.loadPosters();
    this.notesFile = path.join(dir, 'notes.jsonl');
    this.notes = [];   // 모둠 아이디어 연습장: 한 번 적으면 지울 수 없다
    this.loadNotes();
  }

  // 저장된 배치의 한 줄 칸 수가 지금과 다르면(예전 5칸 → 6칸) 줄 모양을 유지한 채 칸 수에 맞춰 옮긴다.
  loadSeats() {
    const raw = this.readJson(this.seatsFile, {});
    const from = Number.isInteger(raw.__cols) && raw.__cols > 0 ? raw.__cols : 5;
    const out = {};
    for (const [cls, arr] of Object.entries(raw)) {
      if (cls === '__cols' || !Array.isArray(arr)) continue;
      if (from === SEAT_COLS) { out[cls] = arr; continue; }
      const re = [];
      for (let i = 0; i < arr.length; i += from) {
        const row = arr.slice(i, i + from);
        while (row.length < SEAT_COLS) row.push('');
        re.push(...row.slice(0, SEAT_COLS));
        for (const extra of row.slice(SEAT_COLS)) if (extra) re.push(extra);   // 칸이 줄어드는 경우 넘친 학생은 뒤에 붙인다
      }
      while (re.length && !re[re.length - 1]) re.pop();
      out[cls] = re;
    }
    if (from !== SEAT_COLS) this.writeJson(this.seatsFile, Object.assign({ __cols: SEAT_COLS }, out));
    return out;
  }

  // 자리 배치 저장. slots: 학번 또는 ''(빈 자리)의 배열. 그 반 학생만, 중복 없이 받는다.
  setSeats(cls, slots) {
    const ok = new Set(this.students.filter((s) => s.cls === cls).map((s) => s.sid));
    const seen = new Set();
    const out = (Array.isArray(slots) ? slots : []).slice(0, 100).map((x) => {
      const sid = typeof x === 'string' ? x : '';
      if (!sid || !ok.has(sid) || seen.has(sid)) return '';
      seen.add(sid); return sid;
    });
    while (out.length && !out[out.length - 1]) out.pop();
    if (out.length) this.seats[cls] = out; else delete this.seats[cls];
    this.writeJson(this.seatsFile, Object.assign({ __cols: SEAT_COLS }, this.seats));
    return this.seats[cls] || [];
  }

  readJson(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
  }

  writeJson(file, data) {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  loadSecret() {
    try {
      const s = fs.readFileSync(this.secretFile, 'utf8').trim();
      if (s.length >= 32) return s;
    } catch (e) { /* 새로 만든다 */ }
    const s = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(this.secretFile, s, { mode: 0o600 });
    return s;
  }

  // ---------- 설정 ----------
  getSettings() { return this.settings; }

  updateSettings(patch) {
    const s = this.settings;
    if (['easy', 'basic', 'mixed'].includes(patch.level)) s.level = patch.level;
    if (typeof patch.open === 'boolean') s.open = patch.open;
    if (Number.isInteger(patch.revealAfter) && patch.revealAfter >= 0 && patch.revealAfter <= 10) s.revealAfter = patch.revealAfter;
    if (patch.aiMode === 'on' || patch.aiMode === 'off') s.aiMode = patch.aiMode;
    if (typeof patch.poster === 'boolean') s.poster = patch.poster;
    if (typeof patch.topicChoice === 'boolean') s.topicChoice = patch.topicChoice;
    if (typeof patch.padletApiKey === 'string') s.padletApiKey = patch.padletApiKey.trim().slice(0, 300);
    if (patch.padletClass && typeof patch.padletClass === 'object') {
      const { cls, boardId, rooms, boardUrl, allUrl, kind } = patch.padletClass;
      if (!s.padlet || typeof s.padlet !== 'object') s.padlet = {};
      const cur = s.padlet[cls] || {};
      const has = boardId || Object.keys(rooms || {}).length || allUrl;
      const next = { boardId: boardId || '', rooms: rooms || {}, boardUrl: boardUrl || '', allUrl: allUrl || '' };
      if (kind === 'group') {   // 모둠 활동용 연결은 개인용 설정과 따로 보관한다
        const g = has ? next : null;
        s.padlet[cls] = Object.assign({}, cur);
        if (g) s.padlet[cls].group = g; else delete s.padlet[cls].group;
      } else {
        const keepG = cur.group ? { group: cur.group } : {};
        s.padlet[cls] = Object.assign(has ? next : { boardId: '', rooms: {}, boardUrl: '', allUrl: '' }, keepG);
      }
      const e = s.padlet[cls];
      if (!e.boardId && !Object.keys(e.rooms || {}).length && !e.allUrl && !e.boardUrl && !e.group) delete s.padlet[cls];
    }
    if (typeof patch.observerPassword === 'string') s.observerPassword = patch.observerPassword.trim().slice(0, 40);
    if (typeof patch.padletTemplate === 'string') s.padletTemplate = patch.padletTemplate.replace(/\r/g, '').slice(0, 1000);
    if (typeof patch.apiKey === 'string') s.apiKey = patch.apiKey.trim();
    if (typeof patch.model === 'string') s.model = patch.model.trim();
    if (patch.provider === 'claude' || patch.provider === 'gemini') s.provider = patch.provider;
    if (typeof patch.geminiApiKey === 'string') s.geminiApiKey = patch.geminiApiKey.trim().slice(0, 300);
    if (typeof patch.geminiModel === 'string') s.geminiModel = patch.geminiModel.trim().slice(0, 80);
    if (typeof patch.groupMode === 'boolean') s.groupMode = patch.groupMode;
    if (Number.isInteger(patch.groupCount) && patch.groupCount >= 1 && patch.groupCount <= 30) s.groupCount = patch.groupCount;
    if (Number.isInteger(patch.groupSeed)) s.groupSeed = patch.groupSeed;
    if (Array.isArray(patch.rounds)) {
      s.rounds = patch.rounds.slice(0, 200).map((x) => ({
        id: String(x.id).slice(0, 12), no: Number(x.no) || 0, name: String(x.name || '').slice(0, 40),
        openedAt: Number(x.openedAt) || 0, closedAt: Number(x.closedAt) || 0,
        level: x.level || '', groupMode: !!x.groupMode, groupCount: Number(x.groupCount) || 0,
        split: !!x.split, phase: x.phase === 2 ? 2 : 1,
        groupPlan: x.groupPlan && typeof x.groupPlan === 'object' ? x.groupPlan : {}, note: String(x.note || '').slice(0, 200),
      }));
    }
    if (patch.groupPlan && typeof patch.groupPlan === 'object') {
      const plan = {};
      let total = 0;
      for (const [k, v] of Object.entries(patch.groupPlan).slice(0, 40)) {
        const n = Math.max(0, Math.min(5, parseInt(v, 10) || 0));
        if (n && total + n <= 12) { plan[String(k).slice(0, 40)] = n; total += n; }
      }
      s.groupPlan = plan;
    }
    this.writeJson(this.settingsFile, s);
    return s;
  }

  // ---------- 모둠 ----------
  groupOf(sid) { return Number(this.groups[sid]) || 0; }
  setLeader(gk, sid) {
    if (sid) this.leaders[gk] = sid; else delete this.leaders[gk];
    this.writeJson(this.leadersFile, this.leaders);
  }
  setGroup(sid, no) {
    if (no) this.groups[sid] = no; else delete this.groups[sid];
    this.writeJson(this.groupsFile, this.groups);
  }

  // ---------- 명단 ----------
  getStudents() { return this.students; }

  findStudent(sid, name) {
    const s = normSid(sid);
    const n = normName(name);
    return this.students.find((x) => x.sid === s && normName(x.name) === n) || null;
  }

  studentBySid(sid) { return this.students.find((x) => x.sid === sid) || null; }

  // entries: [{sid, name, cls?}], mode: 'merge' | 'replace'
  importRoster(entries, mode) {
    const keepLevel = new Map(this.students.filter((s) => s.level).map((s) => [s.sid, s.level]));
    if (mode === 'replace') {
      const classes = new Set(entries.map((e) => e.cls));
      this.students = this.students.filter((s) => !classes.has(s.cls));
    }
    let added = 0, updated = 0;
    for (const e of entries) {
      const idx = this.students.findIndex((s) => s.sid === e.sid);
      if (idx >= 0) {
        this.students[idx].name = e.name;
        this.students[idx].cls = e.cls;
        this.students[idx].no = e.no;
        updated++;
      } else {
        const lv = keepLevel.get(e.sid);
        this.students.push(Object.assign({ sid: e.sid, name: e.name, cls: e.cls, no: e.no, addedAt: Date.now() }, lv ? { level: lv } : {}));
        added++;
      }
    }
    this.sortStudents();
    this.writeJson(this.rosterFile, this.students);
    return { added, updated, total: this.students.length };
  }

  // 학생별 난이도: '' (수업 설정을 따름) | 'easy' (하: 쉬운 조건) | 'basic' (상: 기본 조건)
  setLevels(sids, level) {
    if (!['', 'easy', 'basic'].includes(level)) return 0;
    const set = new Set(sids);
    let n = 0;
    for (const s of this.students) {
      if (!set.has(s.sid)) continue;
      if (level) s.level = level; else delete s.level;
      n++;
    }
    if (n) this.writeJson(this.rosterFile, this.students);
    return n;
  }

  sortStudents() {
    this.students.sort((a, b) => (a.cls || '').localeCompare(b.cls || '', 'ko', { numeric: true }) || (a.no - b.no) || a.sid.localeCompare(b.sid));
  }

  removeStudent(sid) {
    const before = this.students.length;
    this.students = this.students.filter((s) => s.sid !== sid);
    this.writeJson(this.rosterFile, this.students);
    return before - this.students.length;
  }

  // ---------- 기록 ----------
  loadRecords() {
    let text = '';
    try { text = fs.readFileSync(this.recordsFile, 'utf8'); } catch (e) { return; }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let o;
      try { o = JSON.parse(line); } catch (e) { continue; }
      this.applyLine(o);
    }
  }

  applyLine(o) {
    if (o.t === 'rec') {
      const rec = o.r;
      this.records.push(rec);
      this.byId.set(rec.id, rec);
    } else if (o.t === 'patch') {
      const rec = this.byId.get(o.id);
      if (rec) Object.assign(rec, o.f);
    } else if (o.t === 'del') {
      const rec = this.byId.get(o.id);
      if (rec) {
        this.byId.delete(o.id);
        const i = this.records.indexOf(rec);
        if (i >= 0) this.records.splice(i, 1);
      }
    }
  }

  appendLine(o) {
    fs.appendFileSync(this.recordsFile, JSON.stringify(o) + '\n');
    this.applyLine(o);
  }

  newId() { return crypto.randomBytes(6).toString('hex'); }

  addRecord(rec) {
    rec.id = this.newId();
    this.appendLine({ t: 'rec', r: rec });
    return rec;
  }

  patchRecord(id, fields) {
    if (!this.byId.has(id)) return null;
    this.appendLine({ t: 'patch', id, f: fields });
    return this.byId.get(id);
  }

  deleteRecord(id) {
    if (!this.byId.has(id)) return false;
    this.appendLine({ t: 'del', id });
    return true;
  }

  deleteRecordsOf(sid) {
    const ids = this.records.filter((r) => r.sid === sid).map((r) => r.id);
    for (const id of ids) this.appendLine({ t: 'del', id });
    return ids.length;
  }

  getRecord(id) { return this.byId.get(id) || null; }

  // ---------- 모둠 아이디어 연습장 (덧붙이기만 가능) ----------
  loadNotes() {
    let text = '';
    try { text = fs.readFileSync(this.notesFile, 'utf8'); } catch (e) { return; }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try { this.notes.push(JSON.parse(line)); } catch (e) { /* 건너뜀 */ }
    }
  }
  addNote(n) {
    n.id = this.newId();
    this.notes.push(n);
    try { fs.appendFileSync(this.notesFile, JSON.stringify(n) + '\n'); } catch (e) { /* 저장 실패는 다음 요청에서 드러남 */ }
    return n;
  }

  // ---------- 포스터 프롬프트 (학생이 만든 것을 모아 둔다) ----------
  loadPosters() {
    let text = '';
    try { text = fs.readFileSync(this.postersFile, 'utf8'); } catch (e) { return; }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let o;
      try { o = JSON.parse(line); } catch (e) { continue; }
      this.applyPosterLine(o);
    }
  }

  applyPosterLine(o) {
    if (o.t === 'poster') this.posters.push(o.p);
    else if (o.t === 'del') this.posters = this.posters.filter((x) => x.id !== o.id);
  }

  addPoster(p) {
    p.id = this.newId();
    const line = { t: 'poster', p };
    fs.appendFileSync(this.postersFile, JSON.stringify(line) + '\n');
    this.applyPosterLine(line);
    return p;
  }

  deletePoster(id) {
    if (!this.posters.some((x) => x.id === id)) return false;
    const line = { t: 'del', id };
    fs.appendFileSync(this.postersFile, JSON.stringify(line) + '\n');
    this.applyPosterLine(line);
    return true;
  }

  deletePostersOf(sid) {
    const ids = this.posters.filter((x) => x.sid === sid).map((x) => x.id);
    for (const id of ids) this.deletePoster(id);
    return ids.length;
  }
}

function finalVerdict(r) {
  return r.override ? r.override.verdict : r.verdict;
}

module.exports = { Store, normName, normSid, classFromSid, numberFromSid, finalVerdict, DEFAULT_SETTINGS, SEAT_COLS };
