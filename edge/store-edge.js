'use strict';
// Supabase(Postgres)에 저장하는 Store. lib/store.js 의 규칙(Store)을 그대로 쓰고, 저장 방식만 바꾼다.
// 메모리의 사본을 바로 고치고, 저장은 줄을 세워(enqueue) 두었다가 응답을 보내기 전에 flush() 로 마친다.
// 여러 요청(여러 서버 인스턴스)이 같은 데이터를 보도록, 요청마다 sync() 로 바뀐 것만 가져온다.
const { Store, DEFAULT_SETTINGS } = require('../lib/store');
const C = require('../lib/conditions');
const crypto = require('crypto');

const URL_ = (globalThis.Deno && Deno.env.get('SUPABASE_URL')) || '';
const KEY_ = (globalThis.Deno && Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) || '';

async function rest(method, path, body, prefer) {
  const res = await fetch(URL_ + '/rest/v1/' + path, {
    method,
    headers: Object.assign({ apikey: KEY_, authorization: 'Bearer ' + KEY_, 'content-type': 'application/json' }, prefer ? { prefer } : {}),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`DB ${method} ${path.split('?')[0]} ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

const OVERLAP = 500;   // 동시에 저장된 항목을 놓치지 않도록 번호를 조금 겹쳐서 읽는다

class DbStore extends Store {
  constructor() {
    super('/db');                // 파일은 쓰지 않는다(fs 는 비어 있는 대체품)
    this.kvVer = {}; this.recVer = 0; this.posVer = 0;
    this.padletErr = '';
    this.chains = new Map(); this.inflight = new Set(); this.err = null;
    this.lastKv = 0; this.lastRec = 0; this.lastPos = 0; this.syncing = null;
    this.lastTouch = new Map();
  }

  // ----- 저장 줄 세우기 -----
  enqueue(key, fn) {
    const prev = this.chains.get(key) || Promise.resolve();
    const p = prev.then(fn).catch((e) => { this.err = e; console.error('[저장 오류]', e && e.message); });
    this.chains.set(key, p); this.inflight.add(p);
    p.finally(() => { this.inflight.delete(p); if (this.chains.get(key) === p) this.chains.delete(key); });
    return p;
  }
  async flush() {
    while (this.inflight.size) await Promise.all([...this.inflight]);
    if (this.err) { const e = this.err; this.err = null; throw e; }
  }

  // ----- 설정·명단·자리·조건: 문서 하나씩 -----
  writeJson(file, data) {
    if (!this.chains) return;   // 부모 생성자가 부르는 경우(저장할 것 없음)
    const key = String(file).split('/').pop().replace(/\.json$/, '');
    this.putKv(key, data);
  }
  putKv(key, val) {
    return this.enqueue('kv:' + key, async () => {
      const r = await rest('POST', 'ml_kv?on_conflict=key', [{ key, val }], 'resolution=merge-duplicates,return=representation');
      if (r && r[0]) this.kvVer[key] = r[0].ver;
    });
  }
  delKv(key) {
    return this.enqueue('kv:' + key, async () => { await rest('DELETE', 'ml_kv?key=eq.' + key, undefined, 'return=minimal'); delete this.kvVer[key]; });
  }
  setGroup(sid, no) {   // 학생마다 따로 저장해서, 동시에 모둠을 고른 학생들끼리 덮어쓰지 않게 한다
    if (no) { this.groups[sid] = no; this.putKv('gm:' + sid, { no }); } else { delete this.groups[sid]; this.delKv('gm:' + sid); }
  }
  setLeader(gk, sid) {
    const key = 'gl:' + Buffer.from(gk, 'utf8').toString('hex');
    if (sid) { this.leaders[gk] = sid; this.putKv(key, { sid }); } else { delete this.leaders[gk]; this.delKv(key); }
  }
  addNote(n) {
    n.id = this.newId();
    this.notes.push(n);
    this.putKv('gn:' + n.id, n);
    return n;
  }
  setPadletErr(t) { this.padletErr = t || ''; this.putKv('padlet_err', { t: this.padletErr }); }

  applyKv(key, val) {
    if (key === 'roster') this.students = Array.isArray(val) ? val : [];
    else if (key === 'settings') this.settings = Object.assign({}, DEFAULT_SETTINGS, val || {});
    else if (key === 'seats') { const o = Object.assign({}, val || {}); delete o.__cols; this.seats = o; }
    else if (key === 'conditions') C.load(val);
    else if (key === 'secret') { if (val && val.s) this.secret = val.s; }
    else if (key.startsWith('gm:')) { const sid = key.slice(3); if (val && val.no) this.groups[sid] = Number(val.no); else delete this.groups[sid]; }
    else if (key.startsWith('gl:')) { const gk = Buffer.from(key.slice(3), 'hex').toString('utf8'); if (val && val.sid) this.leaders[gk] = String(val.sid); else delete this.leaders[gk]; }
    else if (key.startsWith('gn:')) { if (val && val.id && !this.notes.some((x) => x.id === val.id)) { this.notes.push(val); this.notes.sort((a, b) => (a.ts || 0) - (b.ts || 0)); } }
    else if (key === 'padlet_err') this.padletErr = (val && val.t) || '';
  }

  // ----- 기록·포스터: 한 줄씩. ver 이 커지는 순서대로 새것·바뀐 것만 읽는다 -----
  applyLine(o) { return super.applyLine(o); }
  appendLine(o) {
    this.applyLine(o);
    const id = o.t === 'rec' ? o.r.id : o.id;
    this.enqueue('r:' + id, async () => {
      if (o.t === 'rec') await rest('POST', 'ml_records', [{ id, data: o.r }], 'return=minimal');
      else if (o.t === 'patch') await rest('POST', 'rpc/ml_patch', { p_id: id, p_fields: o.f });
      else if (o.t === 'del') await rest('PATCH', 'ml_records?id=eq.' + id, { del: true }, 'return=minimal');
    });
  }
  addPoster(p) {
    p.id = this.newId();
    this.applyPosterLine({ t: 'poster', p });
    this.enqueue('p:' + p.id, () => rest('POST', 'ml_posters', [{ id: p.id, data: p }], 'return=minimal'));
    return p;
  }
  deletePoster(id) {
    if (!this.posters.some((x) => x.id === id)) return false;
    this.applyPosterLine({ t: 'del', id });
    this.enqueue('p:' + id, () => rest('PATCH', 'ml_posters?id=eq.' + id, { del: true }, 'return=minimal'));
    return true;
  }

  async pull(table, verProp, apply) {
    let since = Math.max(0, this[verProp] - OVERLAP), max = this[verProp];
    for (;;) {
      const rows = await rest('GET', `${table}?select=id,data,del,ver&ver=gt.${since}&order=ver.asc&limit=1000`);
      for (const r of rows) { apply(r); if (r.ver > max) max = r.ver; }
      if (rows.length < 1000) break;
      since = rows[rows.length - 1].ver;
    }
    this[verProp] = max;
  }

  async syncKv(second) {
    const vers = await rest('GET', 'ml_kv?select=key,ver');
    const cur = new Map(vers.map((r) => [r.key, r.ver]));
    if (!cur.has('secret') && !second) {
      await rest('POST', 'ml_kv?on_conflict=key', [{ key: 'secret', val: { s: crypto.randomBytes(32).toString('hex') } }], 'resolution=ignore-duplicates,return=minimal');
      return this.syncKv(true);
    }
    const changed = [...cur].filter(([k, v]) => this.kvVer[k] !== v).map(([k]) => k);
    if (changed.length) {
      const rows = await rest('GET', 'ml_kv?select=key,val,ver&key=in.(' + changed.map((k) => '"' + k + '"').join(',') + ')');
      for (const r of rows) { this.applyKv(r.key, r.val); this.kvVer[r.key] = r.ver; }
    }
    for (const k of Object.keys(this.kvVer)) if (!cur.has(k)) { this.applyKv(k, null); delete this.kvVer[k]; }
  }

  syncRecords() {
    let added = false;
    return this.pull('ml_records', 'recVer', (r) => {
      const had = this.byId.get(r.id);
      if (r.del) { if (had) { this.byId.delete(r.id); const i = this.records.indexOf(had); if (i >= 0) this.records.splice(i, 1); } return; }
      if (had) { for (const k of Object.keys(had)) delete had[k]; Object.assign(had, r.data); }
      else { this.records.push(r.data); this.byId.set(r.id, r.data); added = true; }
    }).then(() => { if (added) this.records.sort((a, b) => (a.ts || 0) - (b.ts || 0)); });
  }

  syncPosters() {
    return this.pull('ml_posters', 'posVer', (r) => {
      const i = this.posters.findIndex((x) => x.id === r.id);
      if (r.del) { if (i >= 0) this.posters.splice(i, 1); return; }
      if (i >= 0) this.posters[i] = r.data; else this.posters.push(r.data);
    }).then(() => this.posters.sort((a, b) => (a.ts || 0) - (b.ts || 0)));
  }

  // 요청 하나를 처리하기 전에 최신 상태로 맞춘다. fresh=false 이면 1초 안에 맞춘 적이 있는 부분은 건너뛴다.
  async sync({ records = true, posters = false, fresh = false } = {}) {
    if (this.syncing) { try { await this.syncing; } catch (e) { /* 아래에서 다시 */ } }
    const now = Date.now(), old = (t) => fresh || !t || now - t >= 1000;
    const jobs = [];
    if (old(this.lastKv)) jobs.push(this.syncKv().then(() => { this.lastKv = Date.now(); }));
    if (records && old(this.lastRec)) jobs.push(this.syncRecords().then(() => { this.lastRec = Date.now(); }));
    if (posters && old(this.lastPos)) jobs.push(this.syncPosters().then(() => { this.lastPos = Date.now(); }));
    if (!jobs.length) return;
    const run = Promise.all(jobs);
    this.syncing = run;
    try { await run; } finally { if (this.syncing === run) this.syncing = null; }
  }

  // ----- 접속·입력 중 표시(현황판) -----
  touch(sid) {
    const now = Date.now();
    if (now - (this.lastTouch.get(sid) || 0) < 30000) return;
    this.lastTouch.set(sid, now);
    this.setActivity(sid, { presence: now });
  }
  setActivity(sid, fields) {
    this.enqueue('a:' + sid, () => rest('POST', 'ml_activity?on_conflict=sid', [Object.assign({ sid }, fields)], 'resolution=merge-duplicates,return=minimal'));
  }
  async loadActivity() {
    const rows = await rest('GET', 'ml_activity?select=*&limit=2000');
    const presence = new Map(), activity = new Map();
    for (const r of rows) {
      presence.set(r.sid, Number(r.presence) || 0);
      activity.set(r.sid, { typingAt: Number(r.typing_at) || 0, draftLen: Number(r.draft_len) || 0, challengeAt: Number(r.challenge_at) || 0 });
    }
    return { presence, activity };
  }
}

module.exports = { DbStore };
