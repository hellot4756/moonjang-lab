#!/usr/bin/env python3
"""server.js 와 lib/*.js 를 Supabase Edge Function(Deno) 하나의 파일로 묶는다. 사용: python3 edge/build.py  -> edge/dist/ml-api/index.ts"""
import os, re, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
rd = lambda p: open(os.path.join(ROOT, p), encoding='utf8').read()

def sub(s, a, b, count=1):
    if a not in s:
        sys.exit('치환 대상을 찾지 못함: ' + a[:70])
    return s.replace(a, b, count)

PRELUDE = r'''// @ts-nocheck
// 자동 생성 파일 (edge/build.py). 직접 고치지 말고 server.js · lib/*.js · edge/*.js 를 고친 뒤 다시 만드세요.
import { Buffer } from "node:buffer";
import nodeProcess from "node:process";
import crypto from "node:crypto";

const process = { env: Object.assign({}, nodeProcess.env, (() => { try { return Deno.env.toObject(); } catch (e) { return {}; } })()) };
const fs = {
  mkdirSync() {}, writeFileSync() {}, renameSync() {}, appendFileSync() {}, unlinkSync() {},
  existsSync() { return false; }, statSync() { return { isFile: () => false }; },
  readFileSync() { throw new Error('no file'); },
};
const path = { join: (...a) => a.join('/').replace(/\/+/g, '/'), sep: '/', extname: (p) => (String(p).match(/\.[^./]*$/) || [''])[0] };
const os = { networkInterfaces: () => ({}) };

const __M = {};
function __require(n) {
  if (n === 'fs') return fs;
  if (n === 'path') return path;
  if (n === 'os') return os;
  if (n === 'crypto') return crypto;
  const k = String(n).replace(/^.*\//, '').replace(/\.js$/, '');
  if (!(k in __M)) throw new Error('모듈 없음: ' + n);
  return __M[k];
}
const require = __require;
function __def(name, fn) {
  const module = { exports: {} };
  fn(module, module.exports, __require, process, Buffer);
  __M[name] = module.exports;
}
'''

parts = [PRELUDE]
for name, file in [('padlet', 'lib/padlet.js'), ('images', 'lib/images.js'), ('poster', 'public/poster.js'), ('store', 'lib/store.js'),
                   ('grader', 'lib/grader.js'), ('conditions', 'lib/conditions.js'), ('store-edge', 'edge/store-edge.js')]:
    src = rd(file)
    # 모듈 안에서 쓰는 process 환경변수 접근은 위 대체품을 쓴다.
    parts.append('__def(%r, function (module, exports, require, process, Buffer) {\n%s\n});\n' % (name, src))

# ---- server.js 를 바꿔서 붙인다 ----
s = rd('server.js')
# 1) 머리말(.env 읽기 등)을 지우고 필요한 것만 남긴다
i = s.index("const PADLET = require('./lib/padlet');")
head_end = s
s = s[i:]
s = sub(s, "const PORT = parseInt(process.env.PORT, 10) || 3000;\nconst DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');\n", "const PORT = 0;\n")
s = sub(s, "const { Store, normName,", "const { DbStore } = require('./edge/store-edge');\nconst { Store, normName,")
s = sub(s, "const store = new Store(DATA_DIR);\nC.init(path.join(DATA_DIR, 'conditions.json'));", "const store = new DbStore();\nC.setHook({ save: (st) => (st ? store.putKv('conditions', st) : store.delKv('conditions')) });")
# 2) 요청/응답: Node http 대신 웹 표준 Request/Response
a = s.index("function readBody(req, limit) {")
b = s.index("function bearer(req) {")
s = s[:a] + '''async function readBody(req, limit) {
  const text = await req.text();
  if (text.length > limit) throw new HttpError(413, '보낸 내용이 너무 커요.');
  if (!text) return {};
  try { return JSON.parse(text); } catch (e) { throw new HttpError(400, '요청 형식이 올바르지 않아요.'); }
}

function send(res, status, obj) {
  return new Response(JSON.stringify(obj), { status, headers: {
    'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
  } });
}

function sendFile(res, status, name, text, type) {
  return new Response(text, { status, headers: {
    'content-type': type, 'cache-control': 'no-store',
    'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
  } });
}

''' + s[b:]
s = sub(s, "const h = req.headers.authorization || '';", "const h = req.headers.get('authorization') || '';")
s = sub(s, "const ip = req.socket.remoteAddress || '';", "const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim();")
# 3) 접속·입력 중 표시는 데이터베이스로
s = sub(s, "let padletLastError = '';   // 마지막 패들렛 오류(교사 화면에서 확인용, 저장하지 않음)\nconst presence = new Map(); // sid -> 마지막 접속 시각\nconst activity = new Map(); // sid -> { typingAt, draftLen, challengeAt }  (교실 현황판용, 저장하지 않음)\n", "")
s = sub(s, "presence.set(st.sid, Date.now());\n  return st;", "store.touch(st.sid);\n  return st;")
s = sub(s, "    presence.set(st.sid, Date.now());\n    return send(res, 200, {\n      token: sign({ r: 's'", "    store.touch(st.sid);\n    return send(res, 200, {\n      token: sign({ r: 's'")
s = sub(s, "activity.set(st.sid, { typingAt: 0, draftLen: 0, challengeAt: Date.now() });", "store.setActivity(st.sid, { typing_at: 0, draft_len: 0, challenge_at: Date.now() });")
s = sub(s, """    const a = activity.get(st.sid) || { typingAt: 0, draftLen: 0, challengeAt: 0 };
    a.draftLen = n; a.typingAt = n > 0 ? Date.now() : 0;
    activity.set(st.sid, a);""", """    store.setActivity(st.sid, { draft_len: n, typing_at: n > 0 ? Date.now() : 0 });""")
s = sub(s, "{ const a = activity.get(st.sid); if (a) { a.typingAt = 0; a.draftLen = 0; } }", "store.setActivity(st.sid, { typing_at: 0, draft_len: 0 });")
s = sub(s, "      const now = Date.now();\n      const lastBy", "      const { presence, activity } = await store.loadActivity();\n      const now = Date.now();\n      const lastBy")
s = sub(s, "async function gboardData(cls, rid) {\n  const now = Date.now();", "async function gboardData(cls, rid) {\n  const { presence, activity } = await store.loadActivity();\n  const now = Date.now();")
s = sub(s, "      const sm = statsMap(since, rdv);\n      const now = Date.now();\n      const classes = {};", "      const sm = statsMap(since, rdv);\n      const { presence } = await store.loadActivity();\n      const now = Date.now();\n      const classes = {};")
# 4) 패들렛 오류 표시는 데이터베이스에 저장
s = sub(s, "padletLastError = `${new Date().toLocaleTimeString('ko-KR')} ${st.cls} ${st.no}번: ${out.status || '연결 실패'} ${out.detail || ''}`.slice(0, 300);\n      console.log('[패들렛 오류]', padletLastError);",
        "store.setPadletErr(`${new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' })} ${st.cls} ${st.no}번: ${out.status || '연결 실패'} ${out.detail || ''}`.slice(0, 300));\n      console.log('[패들렛 오류]', store.padletErr);")
s = sub(s, "    padletLastError = '';\n", "    if (store.padletErr) store.setPadletErr('');\n")
s = sub(s, "lastError: padletLastError,", "lastError: store.padletErr,")
# 5) 한국 시간(서버는 UTC)
s = sub(s, "  const now = new Date();\n  if (period === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();",
        "  const KST = 9 * HOUR;\n  if (period === 'today') return Math.floor((Date.now() + KST) / (24 * HOUR)) * 24 * HOUR - KST;")
s = sub(s, "  const d = new Date(ts);\n  const p = (n) => String(n).padStart(2, '0');\n  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;",
        "  const d = new Date(ts + 9 * HOUR);\n  const p = (n) => String(n).padStart(2, '0');\n  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;")
# 6) 정적 파일·listen 대신 Deno.serve
cut = s.index("// ---------- 정적 파일 ----------")
s = s[:cut] + r'''// ---------- 진입점 (Supabase Edge Function) ----------
const ORIGINS = [/^https:\/\/[a-z0-9-]+\.github\.io$/i, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
function corsFor(req) {
  const o = req.headers.get('origin') || '';
  const h = { 'access-control-allow-methods': 'GET,POST,PUT,OPTIONS', 'access-control-allow-headers': 'authorization,content-type,apikey,x-client-info', 'access-control-max-age': '86400', vary: 'origin' };
  if (ORIGINS.some((re) => re.test(o))) h['access-control-allow-origin'] = o;
  return h;
}

Deno.serve(async (req) => {
  const cors = corsFor(req);
  const done = (res) => { const hd = new Headers(res.headers); for (const [k, v] of Object.entries(cors)) hd.set(k, v); return new Response(res.body, { status: res.status, headers: hd }); };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  try {
    const u = new URL(req.url);
    const pathname = u.pathname.replace(/^\/(?:functions\/v1\/)?ml-api/, '') || '/';
    if (pathname === '/' || pathname === '/health') return done(send(null, 200, { ok: true, name: 'moonjang-lab' }));
    if (!pathname.startsWith('/api/')) throw new HttpError(404, '찾을 수 없는 요청이에요.');
    const teacher = pathname.startsWith('/api/teacher/') || pathname === '/api/poster';
    await store.sync({ records: pathname !== '/api/typing', posters: teacher, fresh: teacher });
    const res = await handleApi(req, null, pathname, u.searchParams);
    await store.flush();
    return done(res);
  } catch (e) {
    if (e instanceof HttpError) return done(send(null, e.status, { error: e.message }));
    console.error('오류:', e);
    return done(send(null, 500, { error: '서버에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.' }));
  }
});
'''
parts.append(s)
out = ''.join(parts).replace('\ufeff', '\\ufeff')
# 배포용으로 줄이기: 주석만 있는 줄과 빈 줄을 지운다(문자열 안의 내용은 건드리지 않도록 '//' 로 시작하는 줄만)
out = '\n'.join(l for l in out.split('\n') if l.strip() and not l.lstrip().startswith('//') or l.startswith('// @ts-nocheck')) + '\n'
os.makedirs(os.path.join(ROOT, 'edge/dist/ml-api'), exist_ok=True)
open(os.path.join(ROOT, 'edge/dist/ml-api/index.ts'), 'w', encoding='utf8').write(out)
print('ok', len(out), 'bytes', out.count('\n'), 'lines')
