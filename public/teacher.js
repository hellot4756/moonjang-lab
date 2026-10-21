'use strict';
(function () {
  const app = document.getElementById('app');
  const KEY = 'moonjang.teacher.v1';

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === false || v == null) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(kid));
    }
    return el;
  }

  const T = {
    token: '', info: null, tab: 'status', cls: '', period: 'all', verdict: '', auto: true,
    timer: null, boardF: '', seatEdit: false, conds: null, drawer: null, dirty: false, topicF: '', fbF: '', fbDirty: false,
  };
  try { T.token = sessionStorage.getItem(KEY) || ''; } catch (e) { /* 무시 */ }
  // 새로고침해도 보던 탭과 반 선택을 그대로 유지한다
  const VKEY = 'moonjang.teacher.view.v1';
  const TAB_IDS = ['status', 'board', 'records', 'roster', 'conds', 'posters', 'settings'];
  try {
    const v = JSON.parse(sessionStorage.getItem(VKEY) || 'null');
    if (v && TAB_IDS.includes(v.tab)) T.tab = v.tab;
    if (v && typeof v.cls === 'string') T.cls = v.cls;
  } catch (e) { /* 무시 */ }
  function saveView() { try { sessionStorage.setItem(VKEY, JSON.stringify({ tab: T.tab, cls: T.cls })); } catch (e) { /* 무시 */ } }

  async function api(path, body, method) {
    const opt = { method: method || (body === undefined ? 'GET' : 'POST'), headers: { 'content-type': 'application/json' } };
    if (T.token) opt.headers.Authorization = 'Bearer ' + T.token;
    if (body !== undefined) opt.body = JSON.stringify(body);
    let res;
    try { res = await fetch((window.ML_API || '') + path, opt); } catch (e) { throw new Error('서버에 연결할 수 없어요. 프로그램이 켜져 있는지 확인해 주세요.'); }
    let data = {};
    try { data = await res.json(); } catch (e) { /* 본문 없음 */ }
    if (!res.ok) {
      if (res.status === 401 && T.token) { logout(); }
      throw new Error(data.error || '문제가 생겼어요.');
    }
    return data;
  }

  async function download(path, filename) {
    try {
      const res = await fetch((window.ML_API || '') + path, { headers: { Authorization: 'Bearer ' + T.token } });
      if (!res.ok) throw new Error('내려받지 못했어요.');
      const blob = await res.blob();
      const a = h('a', { href: URL.createObjectURL(blob), download: filename });
      document.body.append(a); a.click(); a.remove();
    } catch (e) { toast(e.message, true); }
  }

  function toast(msg, bad) {
    const el = h('div', { class: 'notice ' + (bad ? 'bad' : 'ok'), role: 'status', style: 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:50;max-width:90vw;box-shadow:0 6px 24px rgba(0,0,0,.25)' }, msg);
    document.body.append(el);
    setTimeout(() => el.remove(), 3200);
  }

  function logout() {
    try { sessionStorage.removeItem(KEY); sessionStorage.removeItem(VKEY); } catch (e) { /* 무시 */ }
    T.token = ''; clearInterval(T.timer); renderLogin();
  }

  const fmt = (ts) => ts ? new Date(ts).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '-';
  const VERDICT = { correct: ['문법 정답', 'ok'], incorrect: ['문법 오답', 'bad'], pending: ['판정 대기', 'warn'] };
  const CHECK_NAMES = { component: '문장 성분', structure: '문장의 짜임', topic: '공익광고 주제', wellformed: '완결된 한 문장' };
  const VERDICT_SHORT = { correct: '문법 정답', incorrect: '문법 오답', pending: '판정 대기' };
  const QUICK_FB = ['잘 썼어요!', '주제와 더 가깝게 써 보세요.', '문장이 길어요. 간결하게 줄여 보세요.', '띄어쓰기·맞춤법을 확인해 보세요.'];

  // ---------- 로그인 ----------
  function renderLogin() {
    const err = h('div', { class: 'notice bad', role: 'alert', hidden: true });
    const pw = h('input', { type: 'password', id: 'pw', autocomplete: 'current-password' });
    const form = h('form', { class: 'login card', novalidate: true },
      h('div', null, h('p', { class: 'eyebrow' }, '교사 전용'), h('h1', null, '문장 연습실')),
      h('p', { class: 'muted' }, '프로그램을 켠 창에 표시된 교사 비밀번호를 입력하세요. (.env 파일의 TEACHER_PASSWORD)'),
      h('label', { class: 'field', for: 'pw' }, '비밀번호', pw), err,
      h('button', { class: 'btn primary', type: 'submit' }, '들어가기'));
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault(); err.hidden = true;
      try {
        const r = await api('/api/teacher/login', { password: pw.value });
        T.token = r.token;
        try { sessionStorage.setItem(KEY, T.token); } catch (e) { /* 무시 */ }
        await start();
      } catch (e) { err.textContent = e.message; err.hidden = false; }
    });
    app.replaceChildren(form);
    pw.focus();
  }

  // ---------- 뼈대 ----------
  const TABS = [['status', '현황'], ['board', '현황판'], ['records', '제출 모아보기'], ['roster', '명단 관리'], ['conds', '조건 관리'], ['posters', '포스터'], ['settings', '설정·시험']];

  async function start() {
    try { T.info = await api('/api/teacher/info'); } catch (e) { return; }
    renderShell();
  }

  function renderShell() {
    saveView();
    const top = h('div', { class: 'top' },
      h('div', { class: 'brand' }, h('span', { class: 'stampbox sm' }, '제2막'), '문장 연습실', h('small', null, '문법광인의 서재 · 교사 화면')),
      h('button', { class: 'btn sm', type: 'button', onclick: logout }, '로그아웃'));
    const tabs = h('div', { class: 'tabs', role: 'tablist' });
    for (const [id, name] of TABS) {
      tabs.append(h('button', {
        class: 'tab', role: 'tab', 'aria-selected': String(T.tab === id), 'data-tab': id,
        onclick: () => {
          if (T.tab === 'conds' && T.dirty && id !== 'conds' && !confirm('저장하지 않은 조건 수정이 있어요. 저장하지 않고 이동할까요?')) return;
          if (id !== 'conds') T.dirty = false;
          T.tab = id; renderShell();
        },
      }, name));
    }
    const body = h('div', { id: 'body', class: 'wrap wide', style: 'max-width:none' });
    app.replaceChildren(top, tabs, body);
    clearInterval(T.timer);
    if (T.tab === 'status') showStatus(body);
    else if (T.tab === 'board') showBoard(body);
    else if (T.tab === 'records') showRecords(body);
    else if (T.tab === 'roster') showRoster(body);
    else if (T.tab === 'conds') showConditions(body);
    else if (T.tab === 'posters') showPosters(body);
    else showSettings(body);
  }

  function autoRefresh(fn) {
    clearInterval(T.timer);
    if (!T.auto) return;
    T.timer = setInterval(() => { if (!document.hidden && !T.drawer && !T.fbDirty) fn(); }, 10000);
  }

  function classSelect(onchange) {
    const sel = h('select', { 'aria-label': '반 선택' }, h('option', { value: '' }, '전체 반'));
    for (const c of (T.classes || [])) sel.append(h('option', { value: c.cls }, `${c.cls} (${c.count}명)`));
    sel.value = T.cls;
    sel.addEventListener('change', () => { T.cls = sel.value; saveView(); onchange(); });
    return sel;
  }
  function periodSelect(onchange) {
    const sel = h('select', { 'aria-label': '기간 선택' },
      h('option', { value: 'all' }, '전체 기간'), h('option', { value: 'today' }, '오늘'), h('option', { value: '7d' }, '최근 7일'));
    sel.value = T.period;
    sel.addEventListener('change', () => { T.period = sel.value; onchange(); });
    return sel;
  }
  function autoBox(fn) {
    const cb = h('input', { type: 'checkbox', id: 'auto' });
    cb.checked = T.auto;
    cb.addEventListener('change', () => { T.auto = cb.checked; autoRefresh(fn); });
    return h('label', { for: 'auto', class: 'small muted', style: 'display:flex;gap:6px;align-items:center' }, cb, '10초마다 새로고침');
  }
  const qs = (o) => Object.entries(o).filter(([, v]) => v !== '' && v != null).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');

  // ---------- 교실 현황판: 학생 한 명이 네모 한 칸. 한 줄에 6칸 ----------
  const BOARD_STATES = [
    ['typing', '입력 중', '✎'], ['pending', '확인 대기', '⏳'], ['correct', '정답', '✓'],
    ['incorrect', '오답·반려', '✕'], ['waiting', '접속함', '○'], ['offline', '미접속', '–'],
  ];
  function showBoard(body) {
    const grid = h('div', { id: 'board' });
    const legend = h('div', { class: 'blegend' });
    let data = null, seats = {}, dragging = false;
    let COLS = 6;

    // 한 반의 칸 배열(학생 또는 null)을 만든다. 저장된 자리 배치를 따르고, 배치에 없는 학생은 뒤에 붙인다.
    const slotsFor = (cls, list) => {
      const byId = new Map(list.map((x) => [x.sid, x]));
      const out = (seats[cls] || []).map((sid) => byId.get(sid) || null);
      const placed = new Set(out.filter(Boolean).map((x) => x.sid));
      const rest = list.filter((x) => !placed.has(x.sid)).sort((x, y) => (x.no || 999) - (y.no || 999) || x.sid.localeCompare(y.sid));
      while (out.length && !out[out.length - 1]) out.pop();
      out.push(...rest);
      return out;
    };
    const saveSeats = async (cls, slots) => {
      const ids = slots.map((x) => (x ? x.sid : ''));
      while (ids.length && !ids[ids.length - 1]) ids.pop();
      seats[cls] = ids;
      try { await api('/api/teacher/seats', { cls, slots: ids }, 'PUT'); } catch (e) { toast(e.message, true); }
    };

    const draw = () => {
      if (!data) return;
      const cnt = {};
      for (const s of data.students) cnt[s.state] = (cnt[s.state] || 0) + 1;
      legend.replaceChildren(...BOARD_STATES.map(([id, name, icon]) => h('button', {
        type: 'button', class: 'lg st-' + id + (T.boardF === id ? ' on' : ''), 'aria-pressed': String(T.boardF === id),
        title: '누르면 이 상태의 칸만 강조해요', onclick: () => { T.boardF = T.boardF === id ? '' : id; draw(); },
      }, h('span', { class: 'ic', 'aria-hidden': 'true' }, icon), ' ' + name + ' ', h('b', null, String(cnt[id] || 0)))));
      const byCls = new Map();
      for (const s of data.students) { if (!byCls.has(s.cls)) byCls.set(s.cls, []); byCls.get(s.cls).push(s); }
      const out = [];
      if (!data.students.length) out.push(h('div', { class: 'card muted' }, '명단이 비어 있어요. [명단 관리] 탭에서 학생 명단을 먼저 넣어 주세요.'));
      for (const [c, list] of byCls) {
        const slots = slotsFor(c, list);
        while (slots.length % COLS) slots.push(null);
        if (T.seatEdit) for (let k = 0; k < COLS; k++) slots.push(null);   // 편집 중에는 빈 줄 하나를 더 보여 준다
        const titleRow = h('h3', { class: 'btitle' }, c, h('span', { class: 'muted small' }, ` ${list.length}명`));
        if (T.seatEdit) titleRow.append(h('button', { class: 'btn sm', type: 'button', style: 'margin-left:10px', onclick: async () => { await saveSeats(c, []); seats[c] = []; draw(); } }, '번호순으로 되돌리기'));
        out.push(titleRow);
        const board = h('div', { class: 'board' + (T.seatEdit ? ' editing' : '') });
        board.dataset.cls = c;
        slots.forEach((s, i) => {
          if (!s) { board.append(h('div', { class: 'slot', 'data-i': String(i), 'aria-hidden': 'true' })); return; }
          const [, name, icon] = BOARD_STATES.find((x) => x[0] === s.state);
          const tip = [`${s.no ? s.no + '번 ' : ''}${s.name} · ${name}`, s.attempt ? `${s.attempt}번째 도전` : '', s.sentence ? '“' + s.sentence + '”' : '', s.state === 'typing' ? `쓰는 중 (${s.draftLen}자)` : ''].filter(Boolean).join('\n');
          board.append(h('button', {
            type: 'button', class: 'cell st-' + s.state + (T.boardF && T.boardF !== s.state ? ' dim' : ''), title: T.seatEdit ? '끌어서 자리를 옮겨요' : tip, 'data-i': String(i), 'data-sid': s.sid,
            'aria-label': `${s.no ? s.no + '번 ' : ''}${s.name} ${name}`, onclick: () => { if (!T.seatEdit) openDrawer(s); },
          },
            h('div', { class: 'ctop' }, h('span', { class: 'no' }, s.no || '', s.level ? h('span', { class: 'lvtag', title: s.level === 'easy' ? '난이도 하' : '난이도 상' }, s.level === 'easy' ? '하' : '상') : null), s.attempt > 1 ? h('span', { class: 'att' }, s.attempt + '회') : null),
            h('div', { class: 'nm' }, s.name),
            h('div', { class: 'cst' }, h('span', { class: 'ic', 'aria-hidden': 'true' }, icon), h('span', { class: 'lb' }, ' ' + (s.state === 'pending' && !s.manual ? 'AI 오류' : name))),
            s.topicTodo ? h('span', { class: 'flag', title: '주제 확인 필요' }, '주') : (s.review ? h('span', { class: 'flag', title: '확인 필요' }, '!') : null)));
        });
        if (T.seatEdit) attachDrag(board, c, slots);
        out.push(board);
      }
      grid.replaceChildren(...out);
    };

    // 마우스와 터치(태블릿) 모두 되는 끌어서 옮기기: 다른 칸 위에 놓으면 서로 바뀌고, 빈 자리에 놓으면 그 자리로 옮겨 가요.
    function attachDrag(board, cls, slots) {
      board.addEventListener('pointerdown', (ev) => {
        const cell = ev.target.closest('.cell');
        if (!cell || ev.button > 0) return;
        const from = parseInt(cell.dataset.i, 10);
        const x0 = ev.clientX, y0 = ev.clientY;
        let ghost = null, over = null;
        dragging = true;
        const move = (e) => {
          if (!ghost) {
            if (Math.hypot(e.clientX - x0, e.clientY - y0) < 6) return;
            const r = cell.getBoundingClientRect();
            ghost = cell.cloneNode(true); ghost.classList.add('ghost');
            ghost.style.width = r.width + 'px'; ghost.style.height = r.height + 'px';
            document.body.append(ghost); cell.classList.add('dragging');
          }
          ghost.style.left = (e.clientX - ghost.offsetWidth / 2) + 'px';
          ghost.style.top = (e.clientY - ghost.offsetHeight / 2) + 'px';
          const el = document.elementFromPoint(e.clientX, e.clientY);
          const t = el && el.closest('[data-i]');
          const ok = t && t.parentElement === board ? t : null;
          if (over !== ok) { if (over) over.classList.remove('over'); over = ok; if (over) over.classList.add('over'); }
          e.preventDefault();
        };
        const end = async () => {
          document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', end); document.removeEventListener('pointercancel', cancel);
          if (ghost) ghost.remove();
          cell.classList.remove('dragging'); if (over) over.classList.remove('over');
          if (ghost && over) {
            const to = parseInt(over.dataset.i, 10);
            if (to !== from) { const tmp = slots[from]; slots[from] = slots[to]; slots[to] = tmp; await saveSeats(cls, slots); }
          }
          dragging = false; draw();
        };
        const cancel = () => { if (ghost) ghost.remove(); cell.classList.remove('dragging'); document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', end); document.removeEventListener('pointercancel', cancel); dragging = false; draw(); };
        document.addEventListener('pointermove', move, { passive: false }); document.addEventListener('pointerup', end); document.addEventListener('pointercancel', cancel);
      });
    }

    const editBtn = h('button', { class: 'btn sm', type: 'button' });
    const syncEdit = () => {
      editBtn.textContent = T.seatEdit ? '자리 배치 편집 끝내기' : '자리 배치 편집';
      editBtn.className = 'btn sm' + (T.seatEdit ? ' primary' : '');
      hint.textContent = T.seatEdit ? '칸을 끌어서 앉아 있는 자리대로 옮겨 보세요. 빈 칸에 놓으면 그 자리로 옮겨 가요. (자동 저장, 태블릿에도 같은 배치로 보여요)' : '3초마다 자동으로 바뀌어요 · 칸을 누르면 그 학생의 제출 기록, 판정, 피드백을 볼 수 있어요';
    };
    const hint = h('span', { class: 'muted small' });
    editBtn.addEventListener('click', () => { T.seatEdit = !T.seatEdit; syncEdit(); draw(); });
    const load = async () => {
      if (dragging) return;
      try {
        data = await api('/api/teacher/board?' + qs({ cls: T.cls })); T.classes = data.classes; COLS = data.cols || 6;
        if (!T.seatEdit) seats = data.seats || {};
        else for (const c of Object.keys(data.seats || {})) if (!(c in seats)) seats[c] = data.seats[c];
        draw();
      } catch (e) { grid.replaceChildren(h('div', { class: 'notice bad' }, e.message)); }
    };
    const sel = () => classSelect(load);
    const tb = h('div', { class: 'toolbar' }, sel(), editBtn, hint);
    syncEdit();
    body.append(tb, legend, grid);
    load().then(() => { tb.replaceChild(sel(), tb.firstChild); });
    T.timer = setInterval(() => { if (!document.hidden) load(); }, 3000);
  }

  // ---------- 현황 ----------
  function showStatus(body) {
    const info = T.info;
    const urlBox = h('div', { class: 'card' },
      h('h2', null, '학생 접속 주소'),
      h('p', { class: 'muted small', style: 'margin-bottom:8px' }, window.ML_API ? '학생들은 인터넷이 되는 곳이면 어디서든 아래 주소(또는 QR)로 들어와 학번과 이름을 입력해요.' : '학생들은 같은 와이파이에 연결한 뒤 아래 주소(또는 QR)로 들어와 학번과 이름을 입력해요.'));
    const urls = window.ML_API ? [new URL('./', location.href).href] : info.urls;
    if (urls.length) {
      for (const u of urls) urlBox.append(h('div', { class: 'url' }, u));
      const qrHost = h('div', { class: 'qr', style: 'margin-top:10px' });
      try {
        const qr = window.qrcode(0, 'M'); qr.addData(urls[0]); qr.make();
        qrHost.innerHTML = qr.createSvgTag(5, 0);
        urlBox.append(qrHost);
      } catch (e) { /* QR 라이브러리가 없으면 주소만 보여 준다 */ }
    } else {
      urlBox.append(h('div', { class: 'notice warn' }, '네트워크 주소를 찾지 못했어요. 컴퓨터가 와이파이에 연결되어 있는지 확인해 주세요.'));
    }
    const state = h('div', { class: 'card' }, h('h2', null, '수업 상태'));
    const openBtn = h('button', { class: 'btn ' + (info.settings.open ? '' : 'primary'), type: 'button' }, info.settings.open ? '학생 입장 닫기' : '학생 입장 열기');
    openBtn.addEventListener('click', async () => {
      T.info = await api('/api/teacher/settings', { open: !info.settings.open }, 'PUT'); renderShell();
    });
    state.append(
      h('div', { class: 'toolbar' },
        h('span', { class: 'pill ' + (info.settings.open ? 'ok' : 'gray') }, info.settings.open ? '입장 가능' : '입장 닫힘'), openBtn),
      h('div', { class: 'toolbar', style: 'margin-top:12px' },
        info.settings.aiMode === 'off'
          ? [h('span', { class: 'pill blue' }, 'AI 없이 선생님이 직접 판정'), h('span', { class: 'muted small' }, '제출 모아보기에서 문법 정답/오답, 주제, 피드백을 달아 주세요')]
          : [h('span', { class: 'pill ' + (info.ai.configured ? 'ok' : 'warn') }, info.ai.configured ? 'AI 판정 연결됨' : 'AI 키 필요'),
            h('span', { class: 'muted small' }, info.ai.configured ? info.ai.model : '설정 탭에서 API 키를 입력하세요')]),
      h('p', { class: 'muted small', style: 'margin-top:12px' }, `명단 ${info.students}명 · 누적 제출 ${info.records}건`));
    const statsBox = h('div', { id: 'stats', class: 'stats' });
    const data = h('div', { id: 'data', class: 'card', style: 'padding:0' });

    const load = async () => {
      try {
        const o = await api('/api/teacher/overview?' + qs({ cls: T.cls, period: T.period }));
        T.classes = o.classes; T.overview = o;
        renderStatusData(statsBox, data, o);
      } catch (e) { data.replaceChildren(h('div', { class: 'notice bad', style: 'margin:14px' }, e.message)); }
    };
    const tb = h('div', { class: 'toolbar' }, classSelect(load), periodSelect(load), autoBox(load), h('span', { class: 'spacer' }),
      h('button', { class: 'btn sm', type: 'button', onclick: () => download('/api/teacher/export/summary.csv?' + qs({ cls: T.cls, period: T.period }), '학생별누적.csv') }, '학생별 누적 CSV'),
      h('button', { class: 'btn sm', type: 'button', onclick: () => download('/api/teacher/export/records.csv?' + qs({ cls: T.cls, period: T.period }), '제출기록.csv') }, '제출 기록 CSV'));
    body.append(h('div', { class: 'two' }, urlBox, state), statsBox, tb, data);
    load().then(() => { tb.replaceChild(classSelect(load), tb.firstChild); });
    autoRefresh(load);
  }

  function renderStatusData(statsBox, data, o) {
    const sum = o.students.reduce((a, s) => ({ tries: a.tries + s.tries, correct: a.correct + s.correct }), { tries: 0, correct: 0 });
    const rate = sum.tries ? Math.round((sum.correct / sum.tries) * 100) : 0;
    const review = h('button', { class: 'link', type: 'button', onclick: () => { T.tab = 'records'; T.verdict = 'review'; T.topicF = ''; renderShell(); } }, '확인하기');
    const mk = (n, label, extra) => h('div', { class: 'stat' }, h('b', null, String(n)), h('span', null, label), extra || null);
    statsBox.replaceChildren(
      mk(o.online, '접속 중인 학생'), mk(sum.tries, '제출한 문장'), mk(sum.correct, '문법 정답'), mk(rate + '%', '정답률'),
      mk(o.reviewOpen, '교사 확인 필요', o.reviewOpen ? h('div', null, review) : null),
      mk(o.topicOpen, '주제 확인 필요', o.topicOpen ? h('div', null, h('button', { class: 'link', type: 'button', onclick: () => { T.tab = 'records'; T.verdict = 'correct'; T.topicF = 'todo'; renderShell(); } }, '확인하기')) : null));
    const table = h('table', { class: 'grid' });
    table.append(h('thead', null, h('tr', null,
      h('th', null, ''), h('th', null, '반'), h('th', { class: 'num' }, '번호'), h('th', null, '이름'), h('th', null, '학번'),
      h('th', { class: 'num' }, '제출'), h('th', { class: 'num' }, '문법 정답'), h('th', null, '정답률'), h('th', null, '확인 필요'), h('th', null, '주제 확인'), h('th', null, '마지막 제출'))));
    const tb = h('tbody');
    if (!o.students.length) tb.append(h('tr', null, h('td', { colspan: '11', class: 'muted' }, '명단이 비어 있어요. [명단 관리] 탭에서 학생 명단을 먼저 넣어 주세요.')));
    for (const s of o.students) {
      const r = s.tries ? Math.round((s.correct / s.tries) * 100) : 0;
      const tr = h('tr', { class: 'click', tabindex: '0', onclick: () => openDrawer(s) },
        h('td', null, h('span', { class: 'dot' + (s.online ? ' on' : ''), title: s.online ? '접속 중' : '' })),
        h('td', null, s.cls), h('td', { class: 'num' }, s.no || ''), h('td', null, s.name), h('td', null, s.sid),
        h('td', { class: 'num' }, s.tries), h('td', { class: 'num' }, s.correct),
        h('td', null, s.tries ? [h('span', { class: 'bar' }, h('i', { style: `width:${r}%` })), r + '%'] : '-'),
        h('td', null, s.review ? h('span', { class: 'pill warn' }, s.review + '건') : ''),
        h('td', null, s.topicTodo ? h('span', { class: 'pill blue' }, s.topicTodo + '건') : ''),
        h('td', null, fmt(s.last)));
      tr.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') openDrawer(s); });
      tb.append(tr);
    }
    table.append(tb);
    data.replaceChildren(h('div', { class: 'scroll', style: 'max-height:60vh' }, table));
  }

  // ---------- 제출 기록 카드 ----------
  function highlight(text, wheres) {
    const box = h('div', { class: 'sentence' });
    const ranges = [];
    for (const w of wheres) { const i = w ? text.indexOf(w) : -1; if (i >= 0) ranges.push([i, i + w.length]); }
    ranges.sort((a, b) => a[0] - b[0]);
    let pos = 0;
    for (const [a, b] of ranges) {
      if (a < pos) continue;
      if (a > pos) box.append(text.slice(pos, a));
      box.append(h('mark', null, text.slice(a, b))); pos = b;
    }
    if (pos < text.length) box.append(text.slice(pos));
    return box;
  }

  function recCard(r, onChange) {
    const v = VERDICT[r.final] || ['', 'gray'];
    const head = h('div', { class: 'head' },
      h('span', { class: 'pill ' + v[1] }, v[0]),
      r.override ? h('span', { class: 'pill gray' }, r.manual ? '교사 판정' : 'AI는 ' + (VERDICT[r.verdict] || ['?'])[0] + ' → 교사 수정') : null,
      r.confidence === 'low' ? h('span', { class: 'pill warn' }, 'AI 확신 낮음') : null,
      r.flagged ? h('span', { class: 'pill warn' }, '학생이 확인 요청') : null,
      h('b', null, `${r.cls} ${r.name}`), h('span', { class: 'muted small' }, `${r.sid} · ${fmt(r.ts)} · ${r.attempt}번째`));
    const card = h('div', { class: 'card rec' }, head,
      h('div', { class: 'conds-line' }, `성분: ${r.compLabel} / 짜임: ${r.structLabel} / 주제: ${r.topicLabel}${r.topicCustom ? ' (학생이 고름)' : ''}`));
    if (r.tfeedback) card.querySelector('.head').append(h('span', { class: 'pill blue' }, '피드백 있음'));
    const fails = r.checks ? Object.entries(r.checks).filter(([, c]) => !c.ok) : [];
    card.append(highlight(r.sentence, fails.map(([, c]) => c.where)));
    if (r.pendingReason) card.append(h('div', { class: 'notice warn' }, 'AI 판정을 하지 못했어요: ' + r.pendingReason));
    for (const [k, c] of fails) {
      card.append(h('div', { class: 'fixrow' }, h('b', null, CHECK_NAMES[k] + ' '), c.reason, c.fix ? h('div', null, '→ ' + c.fix) : null));
    }
    if (r.flagNote) card.append(h('div', { class: 'small muted' }, '학생 메모: ' + r.flagNote));
    if (r.override) card.append(h('div', { class: 'small muted' }, `교사 수정: ${VERDICT[r.override.verdict][0]}${r.override.note ? ' (' + r.override.note + ')' : ''}`));
    if (r.analysis || r.example) {
      card.append(h('details', { class: 'small' }, h('summary', null, 'AI 분석과 예시'),
        r.analysis ? h('pre', { style: 'white-space:pre-wrap;font:inherit;margin:6px 0' }, r.analysis) : null,
        r.example ? h('div', { style: 'font-family:var(--serif)' }, '예시: ' + r.example) : null,
        r.tip ? h('div', { class: 'muted' }, '참고: ' + r.tip) : null));
    }
    const act = async (verdict) => {
      try { const o = await api('/api/teacher/override', { id: r.id, verdict }); onChange(o.record); } catch (e) { toast(e.message, true); }
    };
    const acts = h('div', { class: 'acts' });
    const mTxt = r.manual && !r.override;
    if (r.final !== 'correct') acts.append(h('button', { class: 'btn sm' + (mTxt ? ' primary' : ''), type: 'button', onclick: () => act('correct') }, mTxt ? '문법 정답' : '정답으로 수정'));
    if (r.final !== 'incorrect') acts.append(h('button', { class: 'btn sm' + (mTxt ? ' primary' : ''), type: 'button', onclick: () => act('incorrect') }, mTxt ? '문법 오답' : '오답으로 수정'));
    if (r.needsReviewNow && !mTxt) acts.append(h('button', { class: 'btn sm primary', type: 'button', onclick: () => act('keep') }, '확인함'));
    if (r.override) acts.append(h('button', { class: 'btn sm', type: 'button', onclick: () => act('clear') }, r.manual ? '판정 취소' : 'AI 판정으로 되돌리기'));
    if (r.verdict === 'pending' && !r.override && !r.manual) {
      acts.append(h('button', { class: 'btn sm', type: 'button', onclick: async () => {
        try {
          const o = await api('/api/teacher/regrade', { id: r.id });
          if (o.ok) { toast('다시 판정했어요.'); onChange(null); } else toast(o.message || '다시 판정하지 못했어요.', true);
        } catch (e) { toast(e.message, true); }
      } }, 'AI로 다시 판정'));
    }
    acts.append(h('button', { class: 'btn sm danger', type: 'button', onclick: async () => {
      if (!confirm('이 기록을 삭제할까요? 되돌릴 수 없어요.')) return;
      try { await api('/api/teacher/record/delete', { id: r.id }); onChange(null); } catch (e) { toast(e.message, true); }
    } }, '삭제'));
    card.append(acts);
    card.append(teacherPanel(r, onChange));
    return card;
  }


  // 주제 판단(교사)과 학생에게 보여 줄 피드백
  function teacherPanel(r, onChange) {
    const wrap = h('div', { class: 'tpanel' });
    const save = async (body, okMsg) => {
      try { const o = await api('/api/teacher/feedback', Object.assign({ id: r.id }, body)); T.fbDirty = false; if (okMsg) toast(okMsg); onChange(o.record); } catch (e) { toast(e.message, true); }
    };
    const mark = (val, label, cls) => h('button', {
      class: 'btn sm' + (r.topicJudge === val ? ' ' + cls : ''), type: 'button', 'aria-pressed': String(r.topicJudge === val),
      onclick: () => save({ topic: r.topicJudge === val ? '' : val }),
    }, label);
    wrap.append(h('div', { class: 'toolbar' }, h('b', { class: 'small' }, '주제 판단'),
      mark('ok', '적절', 'primary'), mark('no', '부적절', 'danger'),
      !r.topicJudge && r.final === 'correct' ? h('span', { class: 'pill blue' }, '확인 필요') : null,
      h('span', { class: 'muted small' }, '(공익광고 주제와 내용이 맞는지는 교사가 판단해요)')));
    const ta = h('textarea', { class: 'fbtext', rows: '2', maxlength: '500', placeholder: '학생에게 보여 줄 피드백을 적어 주세요. (학생 화면에 바로 표시돼요)', 'aria-label': '교사 피드백' });
    ta.value = r.tfeedback || '';
    ta.addEventListener('input', () => { T.fbDirty = ta.value !== (r.tfeedback || ''); });
    const chips = h('div', { class: 'chips' });
    for (const q of QUICK_FB) chips.append(h('button', { class: 'chip', type: 'button', onclick: () => { ta.value = ta.value ? ta.value.replace(/\s*$/, '') + ' ' + q : q; ta.focus(); T.fbDirty = true; } }, q));
    wrap.append(ta, chips, h('div', { class: 'toolbar' },
      h('button', { class: 'btn sm primary', type: 'button', onclick: () => save({ feedback: ta.value }, '피드백을 저장했어요.') }, '피드백 저장'),
      r.tfeedback ? h('button', { class: 'btn sm', type: 'button', onclick: () => save({ feedback: '' }, '피드백을 지웠어요.') }, '피드백 지우기') : null,
      r.tfeedback ? h('span', { class: 'muted small' }, '저장됨 · ' + fmt(r.tfeedbackAt)) : null));
    return wrap;
  }

  // ---------- 제출 모아보기 ----------
  function showRecords(body) {
    const list = h('div', { class: 'wrap wide', style: 'max-width:none' });
    let recs = [];
    let more = false;
    const moreBtn = h('button', { class: 'btn', type: 'button', hidden: true }, '더 보기');
    const draw = () => {
      list.replaceChildren();
      if (!recs.length) list.append(h('div', { class: 'card muted' }, '조건에 맞는 제출이 없어요.'));
      for (const r of recs) list.append(recCard(r, (upd) => { if (upd) { const i = recs.findIndex((x) => x.id === r.id); recs[i] = upd; draw(); } else load(); }));
      moreBtn.hidden = !more;
    };
    const load = async (append) => {
      try {
        const before = append && recs.length ? recs[recs.length - 1].ts : '';
        const o = await api('/api/teacher/records?' + qs({ cls: T.cls, period: T.period, verdict: T.verdict, limit: 50, before, topic: T.topicF, fb: T.fbF }));
        recs = append ? recs.concat(o.records) : o.records;
        more = o.records.length === 50;
        draw();
      } catch (e) { list.replaceChildren(h('div', { class: 'notice bad' }, e.message)); }
    };
    moreBtn.addEventListener('click', () => load(true));
    const vsel = h('select', { 'aria-label': '판정 선택' },
      h('option', { value: '' }, '모든 판정'), h('option', { value: 'review' }, '교사 확인 필요'), h('option', { value: 'correct' }, '문법 정답'),
      h('option', { value: 'incorrect' }, '문법 오답'), h('option', { value: 'pending' }, '판정 대기'));
    vsel.value = T.verdict;
    vsel.addEventListener('change', () => { T.verdict = vsel.value; load(); });
    const regradeAll = h('button', { class: 'btn sm', type: 'button', onclick: async () => {
      try {
        const o = await api('/api/teacher/regrade', { all: true });
        toast(`판정 대기 ${o.ok + o.fail}건 중 ${o.ok}건을 판정했어요.` + (o.fail ? ' ' + (o.message || '') : ''), !!o.fail);
        load();
      } catch (e) { toast(e.message, true); }
    } }, '판정 대기 모두 AI로 판정');
    const tsel = h('select', { 'aria-label': '주제 판단 선택' },
      h('option', { value: '' }, '주제 전체'), h('option', { value: 'todo' }, '주제 확인 필요 (문법 정답 중)'), h('option', { value: 'ok' }, '주제 적절'), h('option', { value: 'no' }, '주제 부적절'));
    tsel.value = T.topicF;
    tsel.addEventListener('change', () => { T.topicF = tsel.value; load(); });
    const fsel = h('select', { 'aria-label': '피드백 선택' },
      h('option', { value: '' }, '피드백 전체'), h('option', { value: 'none' }, '피드백 없음'), h('option', { value: 'has' }, '피드백 있음'));
    fsel.value = T.fbF;
    fsel.addEventListener('change', () => { T.fbF = fsel.value; load(); });
    const bulkOk = h('button', { class: 'btn sm', type: 'button', onclick: async () => {
      const ids = recs.filter((x) => !x.topicJudge).map((x) => x.id);
      if (!ids.length) { toast('주제 판단이 필요한 기록이 없어요.', true); return; }
      if (!confirm(`화면에 보이는 기록 중 주제를 아직 판단하지 않은 ${ids.length}건을 모두 '적절'로 표시할까요? (부적절한 것은 나중에 개별로 바꿀 수 있어요)`)) return;
      try { const o = await api('/api/teacher/feedback/bulk', { ids, topic: 'ok' }); toast(`${o.changed}건을 '적절'로 표시했어요.`); load(); } catch (e) { toast(e.message, true); }
    } }, "보이는 기록 모두 '주제 적절'");
    const delShown = h('button', { class: 'btn sm danger', type: 'button', onclick: async () => {
      const ids = recs.map((x) => x.id);
      if (!ids.length) { toast('지울 기록이 없어요.', true); return; }
      if (!confirm(`지금 화면에 보이는 기록 ${ids.length}건을 모두 지울까요? 되돌릴 수 없어요.\n(위의 반·판정·기간 선택에 맞는 기록 중 불러온 것만 지워져요.)`)) return;
      try { const o = await api('/api/teacher/records/delete', { ids }); toast(`${o.deleted}건을 지웠어요.`); load(); } catch (e) { toast(e.message, true); }
    } }, '보이는 기록 지우기');
    const delClass = h('button', { class: 'btn sm danger', type: 'button', onclick: async () => {
      if (!T.cls) { toast('위에서 반을 먼저 선택해 주세요.', true); return; }
      if (!confirm(`${T.cls}의 모든 기록과 포스터 프롬프트를 지울까요? 되돌릴 수 없어요.`)) return;
      if (!confirm(`정말 ${T.cls} 전체를 지울까요? 한 번 더 확인해요.`)) return;
      try { const o = await api('/api/teacher/class/reset', { cls: T.cls }); toast(`${T.cls}: ${o.deleted}건을 지웠어요.`); load(); } catch (e) { toast(e.message, true); }
    } }, '이 반 기록 모두 지우기');
    const tb = h('div', { class: 'toolbar' }, classSelect(() => load()), vsel, tsel, fsel, periodSelect(() => load()), autoBox(() => load()), h('span', { class: 'spacer' }), bulkOk, regradeAll, delShown, delClass);
    body.append(tb, list, moreBtn);
    api('/api/teacher/overview').then((o) => { T.classes = o.classes; tb.replaceChild(classSelect(() => load()), tb.firstChild); }).catch(() => {});
    load();
    autoRefresh(() => load());
  }

  // ---------- 학생 상세 ----------
  async function openDrawer(s) {
    const panel = h('div', { class: 'panel', role: 'dialog', 'aria-label': s.name + ' 기록' });
    const drawer = h('div', { class: 'drawer', onclick: (ev) => { if (ev.target === drawer) close(); } }, panel);
    const close = () => { drawer.remove(); T.drawer = null; };
    T.drawer = drawer;
    const list = h('div', { class: 'wrap', style: 'max-width:none' });
    const rate = s.tries ? Math.round((s.correct / s.tries) * 100) : 0;
    panel.append(
      h('div', { class: 'top' }, h('h2', null, `${s.cls} ${s.no ? s.no + '번 ' : ''}${s.name}`), h('button', { class: 'btn sm', type: 'button', onclick: close }, '닫기')),
      h('div', { class: 'muted' }, `학번 ${s.sid} · 제출 ${s.tries}건 · 정답 ${s.correct}건 · 정답률 ${rate}%`),
      list);
    document.body.append(drawer);
    let recs = [];
    const draw = () => {
      list.replaceChildren();
      if (!recs.length) list.append(h('div', { class: 'card muted' }, '아직 제출한 문장이 없어요.'));
      for (const r of recs) list.append(recCard(r, (upd) => { if (upd) { recs[recs.indexOf(r)] = upd; draw(); } else load(); }));
    };
    const load = async () => {
      try { recs = (await api('/api/teacher/records?' + qs({ sid: s.sid, limit: 200, period: T.period }))).records; draw(); } catch (e) { list.replaceChildren(h('div', { class: 'notice bad' }, e.message)); }
    };
    load();
  }

  // ---------- 명단 관리 ----------
  function showRoster(body) {
    const msg = h('div', { hidden: true });
    const cls = h('input', { type: 'text', id: 'rcls', placeholder: '예: 2학년 3반 (학번이 5자리면 비워 두세요)' });
    const text = h('textarea', { id: 'rtext', class: 'roster', placeholder: '학번 이름 (한 줄에 한 명)\n20301 김하늘\n20302 이도윤\n20303 박서연\n\n엑셀에서 두 열을 복사해 붙여 넣어도 돼요.' });
    const mode = h('select', { id: 'rmode' }, h('option', { value: 'merge' }, '추가하고 이미 있는 학번은 갱신'), h('option', { value: 'replace' }, '붙여 넣은 반은 기존 명단을 지우고 새로 등록'));
    const importBtn = h('button', { class: 'btn primary', type: 'button' }, '명단 등록');
    importBtn.addEventListener('click', async () => {
      msg.hidden = true;
      try {
        const o = await api('/api/teacher/roster/import', { text: text.value, cls: cls.value, mode: mode.value });
        msg.className = 'notice ok'; msg.hidden = false;
        msg.textContent = `${o.read}명을 읽었어요. 새로 ${o.added}명 추가, ${o.updated}명 갱신. (전체 ${o.total}명)` + (o.skipped.length ? ` 읽지 못한 줄 ${o.skipped.length}개: ${o.skipped.slice(0, 5).join(' | ')}` : '');
        text.value = '';
        T.info = await api('/api/teacher/info');
        loadList();
      } catch (e) { msg.className = 'notice bad'; msg.hidden = false; msg.textContent = e.message; }
    });
    const imp = h('section', { class: 'card' }, h('h2', null, '반별 명단 붙여 넣기'),
      h('p', { class: 'muted small', style: 'margin-bottom:12px' }, '학번이 5자리(예: 20312 = 2학년 3반 12번)면 반이 자동으로 나뉘어요. 한 번에 여러 반을 붙여 넣어도 돼요.'),
      h('div', { class: 'wrap', style: 'max-width:none' },
        h('label', { class: 'field', for: 'rcls' }, '반 이름 (선택)', cls),
        h('label', { class: 'field', for: 'rtext' }, '명단', text),
        h('label', { class: 'field', for: 'rmode' }, '등록 방식', mode),
        h('div', { class: 'toolbar' }, importBtn), msg));

    const asid = h('input', { type: 'text', id: 'asid', inputmode: 'numeric', placeholder: '학번' });
    const aname = h('input', { type: 'text', id: 'aname', placeholder: '이름' });
    const acls = h('input', { type: 'text', id: 'acls', placeholder: '반 (선택)' });
    const addBtn = h('button', { class: 'btn', type: 'button' }, '추가');
    addBtn.addEventListener('click', async () => {
      try {
        await api('/api/teacher/roster/add', { sid: asid.value, name: aname.value, cls: acls.value });
        asid.value = ''; aname.value = ''; toast('추가했어요.'); loadList();
      } catch (e) { toast(e.message, true); }
    });
    const one = h('section', { class: 'card' }, h('h2', null, '한 명 추가'),
      h('div', { class: 'toolbar' }, asid, aname, acls, addBtn));

    const listBox = h('section', { class: 'card', style: 'padding:0' });
    const loadList = async () => {
      try {
        const [ov, info] = await Promise.all([api('/api/teacher/overview?' + qs({ cls: T.cls })), api('/api/teacher/info')]);
        T.classes = ov.classes; T.info = info;
        const LV = [['', '수업 설정대로'], ['easy', '하 (쉬운 조건)'], ['basic', '상 (기본 조건)']];
        const checks = new Map();
        const all = h('input', { type: 'checkbox', 'aria-label': '전체 선택' });
        all.addEventListener('change', () => { for (const c of checks.values()) c.checked = all.checked; });
        const table = h('table', { class: 'grid' }, h('thead', null, h('tr', null,
          h('th', null, all), h('th', null, '반'), h('th', { class: 'num' }, '번호'), h('th', null, '이름'), h('th', null, '학번'), h('th', null, '난이도'), h('th', { class: 'num' }, '제출'), h('th', null, ''))));
        const tb = h('tbody');
        if (!ov.students.length) tb.append(h('tr', null, h('td', { colspan: '8', class: 'muted' }, '등록된 학생이 없어요.')));
        for (const s of ov.students) {
          const cb = h('input', { type: 'checkbox', 'aria-label': s.name + ' 선택' }); checks.set(s.sid, cb);
          const lvSel = h('select', { 'aria-label': s.name + ' 난이도', style: 'width:auto;min-width:9.5em' }, LV.map(([v, n]) => h('option', { value: v }, n)));
          lvSel.value = s.level || '';
          lvSel.addEventListener('change', async () => {
            try { await api('/api/teacher/roster/level', { sids: [s.sid], level: lvSel.value }); toast(`${s.name}: ${LV.find((x) => x[0] === lvSel.value)[1]}`); } catch (e) { toast(e.message, true); loadList(); }
          });
          tb.append(h('tr', null, h('td', null, cb), h('td', null, s.cls), h('td', { class: 'num' }, s.no || ''), h('td', null, s.name), h('td', null, s.sid), h('td', null, lvSel), h('td', { class: 'num' }, s.tries),
            h('td', null, h('div', { class: 'acts', style: 'display:flex;gap:6px' },
              h('button', { class: 'btn sm', type: 'button', onclick: async () => {
                if (!s.tries || !confirm(`${s.name} 학생의 기록 ${s.tries}건을 모두 지울까요? 되돌릴 수 없어요.`)) return;
                const o = await api('/api/teacher/student/reset', { sid: s.sid }); toast(`${o.deleted}건을 지웠어요.`); loadList();
              } }, '기록 지우기'),
              h('button', { class: 'btn sm danger', type: 'button', onclick: async () => {
                if (!confirm(`${s.name} 학생을 명단에서 뺄까요? 기록은 남아요.`)) return;
                await api('/api/teacher/roster/remove', { sid: s.sid }); loadList();
              } }, '명단에서 빼기')))));
        }
        table.append(tb);
        const bulkSel = h('select', { id: 'bulklv', 'aria-label': '선택한 학생 난이도', style: 'width:auto' }, LV.map(([v, n]) => h('option', { value: v }, n)));
        const bulkBtn = h('button', { class: 'btn sm', type: 'button', onclick: async () => {
          const sids = [...checks].filter(([, c]) => c.checked).map(([sid]) => sid);
          if (!sids.length) { toast('먼저 학생을 선택해 주세요.', true); return; }
          try { const o = await api('/api/teacher/roster/level', { sids, level: bulkSel.value }); toast(`${o.changed}명의 난이도를 바꿨어요.`); loadList(); } catch (e) { toast(e.message, true); }
        } }, '선택한 학생에게 적용');
        const top = h('div', { class: 'toolbar', style: 'padding:14px' }, h('h2', { style: 'margin:0' }, `현재 명단 (${ov.students.length}명)`), classSelect(loadList),
          h('span', { class: 'spacer' }), h('span', { class: 'muted small' }, '선택한 학생의 난이도를'), bulkSel, bulkBtn);
        const note = h('p', { class: 'muted small', style: 'padding:0 14px 10px' }, '난이도 \'하\'는 문장의 짜임을 쉬운 것만, 문장 성분은 개수를 가장 적게 뽑아요. \'상\'은 기본 조건만, 성분 개수를 가장 많게 뽑아요. 다음에 받는 조건부터 적용돼요. 학생 화면에는 표시되지 않아요.');
        listBox.replaceChildren(top, note, h('div', { class: 'scroll', style: 'max-height:55vh' }, table));
      } catch (e) { listBox.replaceChildren(h('div', { class: 'notice bad', style: 'margin:14px' }, e.message)); }
    };
    body.append(imp, one, listBox);
    loadList();
  }



  // ---------- 포스터 프롬프트 모아보기 ----------
  function showPosters(body) {
    const list = h('div', { class: 'wrap wide', style: 'max-width:none' });
    let all = [];
    let latestOnly = true;
    const draw = () => {
      let items = all;
      if (latestOnly) { const seen = new Set(); items = all.filter((p) => (seen.has(p.sid) ? false : (seen.add(p.sid), true))); }
      list.replaceChildren();
      if (!items.length) list.append(h('div', { class: 'card muted' }, '아직 학생들이 만든 포스터 프롬프트가 없어요. 학생 화면 아래의 [포스터 프롬프트 만들기]에서 만들어요.'));
      for (const p of items) {
        const copy = async (text, ta) => {
          try { await navigator.clipboard.writeText(text); toast('복사했어요.'); }
          catch (e) { ta.select(); try { document.execCommand('copy'); toast('복사했어요.'); } catch (e2) { toast('복사하지 못했어요.', true); } }
        };
        const mk = (label, text) => {
          const ta = h('textarea', { readonly: true, rows: '9', style: 'width:100%;font-size:.9rem' }); ta.value = text || '';
          return h('details', { class: 'small', style: 'margin-top:6px' }, h('summary', null, label),
            ta, h('div', { class: 'toolbar', style: 'margin-top:6px' }, h('button', { class: 'btn sm', type: 'button', onclick: () => copy(text || '', ta) }, '복사')));
        };
        const sameCount = all.filter((x) => x.sid === p.sid).length;
        list.append(h('div', { class: 'card rec' },
          h('div', { class: 'head' }, h('b', null, `${p.cls} ${p.name}`), h('span', { class: 'muted small' }, `${p.sid} · ${fmt(p.ts)}`),
            p.topic ? h('span', { class: 'pill blue' }, p.topic) : null, sameCount > 1 ? h('span', { class: 'pill gray' }, `이 학생 ${sameCount}번 만듦`) : null),
          h('div', { class: 'sentence' }, p.sentence || ''),
          h('div', { class: 'small muted' }, ['style', 'mood', 'color', 'composition'].map((k) => ((window.Poster && window.Poster.OPTIONS[k]) ? (window.Poster.OPTIONS[k].items.find((x) => x[0] === (p.opts || {})[k]) || [])[1] : '')).filter(Boolean).join(' · ')),
          mk('프롬프트 (한국어)', p.prompt), mk('프롬프트 (English)', p.promptEn),
          h('div', { class: 'acts' }, h('button', { class: 'btn sm danger', type: 'button', onclick: async () => {
            if (!confirm('이 프롬프트를 삭제할까요?')) return;
            try { await api('/api/teacher/poster/delete', { id: p.id }); load(); } catch (e) { toast(e.message, true); }
          } }, '삭제'))));
      }
    };
    const load = async () => {
      try { const o = await api('/api/teacher/posters?' + qs({ cls: T.cls })); all = o.posters; draw(); }
      catch (e) { list.replaceChildren(h('div', { class: 'notice bad' }, e.message)); }
    };
    const cb = h('input', { type: 'checkbox', id: 'latest' }); cb.checked = true;
    cb.addEventListener('change', () => { latestOnly = cb.checked; draw(); });
    const tb = h('div', { class: 'toolbar' }, classSelect(() => load()), h('label', { for: 'latest', class: 'small muted', style: 'display:flex;gap:6px;align-items:center' }, cb, '학생별 최신 것만'), autoBox(() => load()), h('span', { class: 'spacer' }),
      h('button', { class: 'btn sm', type: 'button', onclick: () => download('/api/teacher/export/posters.csv?' + qs({ cls: T.cls }), '포스터프롬프트.csv') }, '포스터 프롬프트 CSV'));
    body.append(tb, list);
    api('/api/teacher/overview').then((o) => { T.classes = o.classes; tb.replaceChild(classSelect(() => load()), tb.firstChild); }).catch(() => {});
    load();
    autoRefresh(() => load());
  }

  // ---------- 조건 관리 ----------
  window.addEventListener('beforeunload', (ev) => { if (T.dirty) { ev.preventDefault(); ev.returnValue = ''; } });

  function showConditions(body) {
    let D = null;
    let PARTS = [];
    const box = h('div', { class: 'wrap', style: 'max-width:none' }, h('p', { class: 'muted' }, '조건을 불러오는 중이에요…'));
    body.append(box);

    const markDirty = () => { T.dirty = true; updateBar(); };
    let bar, saveBtn;
    function updateBar() {
      if (!bar) return;
      bar.className = 'notice ' + (T.dirty ? 'warn' : 'info');
      bar.textContent = T.dirty
        ? '바꾼 내용이 아직 저장되지 않았어요. 맨 위나 맨 아래의 [저장]을 눌러야 학생들에게 적용돼요.'
        : '고친 뒤 [저장]을 누르면 그 순간부터 새로 조건을 받는 학생에게 적용돼요. 이미 받은 조건은 그대로 이어서 풀 수 있어요.';
      for (const b of box.querySelectorAll('[data-save]')) b.disabled = !T.dirty;
    }

    async function save() {
      try {
        const r = await api('/api/teacher/conditions', D, 'PUT');
        D = r.conditions; PARTS = r.parts || PARTS; T.dirty = false;
        T.info.counts = r.counts; T.info.conditionsCustomized = r.customized;
        toast('저장했어요.'); render();
      } catch (e) { toast(e.message, true); }
    }

    const field = (label, el, hint) => h('label', { class: 'field' }, label, el, hint ? h('span', { class: 'muted small' }, hint) : null);

    function item(kind, it) {
      const lvPill = () => h('span', { class: 'pill ' + (it.level === 'easy' ? 'ok' : 'blue') }, it.level === 'easy' ? '쉬움' : '기본');
      const title = h('span', { class: 'ctitle' }, it.label || '(이름 없음)');
      const offPill = h('span', { class: 'pill gray', hidden: !it.off }, '꺼짐');
      const sum = h('summary', null, lvPill(), ' ', title, ' ', offPill);
      const det = h('details', { class: 'citem' + (it.off ? ' off' : '') }, sum);
      if (!it.label && !it.short) det.open = true;

      const inName = h('input', { type: 'text', maxlength: '60', value: it.label });
      inName.addEventListener('input', () => { it.label = inName.value; title.textContent = it.label || '(이름 없음)'; markDirty(); });
      const inLevel = h('select', null, h('option', { value: 'easy' }, '쉬움'), h('option', { value: 'basic' }, '기본'));
      inLevel.value = it.level;
      inLevel.addEventListener('change', () => { it.level = inLevel.value; sum.firstChild.replaceWith(lvPill()); markDirty(); });
      const inShort = h('textarea', { rows: '2', maxlength: '200' }); inShort.value = it.short;
      inShort.addEventListener('input', () => { it.short = inShort.value; markDirty(); });
      const inEx = h('input', { type: 'text', maxlength: '200', value: it.example });
      inEx.addEventListener('input', () => { it.example = inEx.value; markDirty(); });
      const inRub = h('textarea', { rows: '5', maxlength: '1000' }); inRub.value = it.rubric;
      inRub.addEventListener('input', () => { it.rubric = inRub.value; markDirty(); });
      const on = h('input', { type: 'checkbox' }); on.checked = !it.off;
      on.addEventListener('change', () => { it.off = !on.checked; offPill.hidden = on.checked; det.classList.toggle('off', it.off); markDirty(); });
      const del = h('button', { class: 'btn sm danger', type: 'button', onclick: () => {
        if (!confirm(`'${it.label || '이 조건'}' 조건을 지울까요? (저장해야 반영돼요. 이미 쌓인 기록의 글자는 그대로 남아요.)`)) return;
        D[kind] = D[kind].filter((x) => x !== it); markDirty(); render();
      } }, '지우기');

      det.append(h('div', { class: 'wrap cform', style: 'max-width:none' },
        field('조건 이름 (학생에게 크게 보여요)', inName),
        field('난이도', inLevel, '난이도 설정(쉬움/기본/섞어서)에 따라 이 구분으로 뽑아요.'),
        field('학생에게 보여 줄 안내 문장', inShort, "예: 목적어(~을/~를)를 넣어 쓰세요."),
        field('예시 (정답 공개 전에도 학생에게 보여요)', inEx, '예: 나는 밥을 먹었다. (밥을 = 목적어)'),
        field('AI 판정 기준 (학생에게는 안 보여요)', inRub, '무엇이 있어야 정답인지, 무엇은 인정하고 무엇은 안 되는지를 구체적으로 적을수록 판정이 정확해져요. 비워 두면 위 안내 문장으로 자동 작성돼요.'),
        h('label', { class: 'check-line' }, on, ' 이 조건을 학생에게 출제하기'),
        h('div', { class: 'toolbar' }, del)));
      return det;
    }


    function sevenCard() {
      const sv = D.seven;
      const radio = (val, label, hint) => {
        const r = h('input', { type: 'radio', name: 'cmode', value: val });
        r.checked = sv.mode === val;
        r.addEventListener('change', () => { sv.mode = val; markDirty(); render(); });
        return h('label', { class: 'check-line', style: 'align-items:flex-start' }, r, h('span', null, h('b', null, label), h('br'), h('span', { class: 'muted small' }, hint)));
      };
      const card = h('section', { class: 'card', 'data-kind': 'seven' }, h('h2', null, '문장 성분 출제 방식'),
        radio('seven', '문장 성분 7가지 중에서 무작위로 뽑기', "학생마다 주어·서술어·목적어·보어·관형어·부사어·독립어 중 정해진 개수가 무작위로 나와요. 예) '목적어·관형어·부사어가 모두 있는 문장'"),
        radio('preset', '미리 정한 조건 목록에서 뽑기', "'목적어가 없는 문장'처럼 직접 만든 조건 목록을 써요. (아래에서 고치고 추가할 수 있어요)"));
      if (sv.mode === 'seven') {
        const pool = h('div', { class: 'toolbar', style: 'margin-top:8px' });
        for (const pt of PARTS) {
          const cb = h('input', { type: 'checkbox' }); cb.checked = sv.pool.includes(pt.id);
          cb.addEventListener('change', () => {
            sv.pool = PARTS.map((x) => x.id).filter((id) => id === pt.id ? cb.checked : sv.pool.includes(id));
            const n = sv.pool.length || 1;
            if (sv.max > n) sv.max = n; if (sv.min > n) sv.min = n;
            markDirty(); render();
          });
          pool.append(h('label', { class: 'check-line' }, cb, pt.name));
        }
        const mkSel = (val, onch, label) => {
          const n = Math.max(1, sv.pool.length);
          const sel = h('select', { 'aria-label': label, style: 'width:auto' });
          for (let i = 1; i <= n; i++) sel.append(h('option', { value: String(i) }, i + '개'));
          sel.value = String(Math.min(val, n));
          sel.addEventListener('change', () => { onch(parseInt(sel.value, 10)); markDirty(); render(); });
          return sel;
        };
        card.append(
          h('div', { class: 'wrap', style: 'max-width:none;margin-top:12px;padding-left:2px' },
            h('div', null, h('b', { class: 'small' }, '출제할 성분 (체크한 것 중에서 뽑아요)'), pool),
            h('div', { class: 'toolbar' }, h('b', { class: 'small' }, '한 번에 들어갈 성분 개수'),
              mkSel(sv.min, (v) => { sv.min = v; if (sv.max < v) sv.max = v; }, '최소 개수'), '~',
              mkSel(sv.max, (v) => { sv.max = v; if (sv.min > v) sv.min = v; }, '최대 개수'),
              h('span', { class: 'muted small' }, sv.min === sv.max ? `항상 ${sv.min}개씩 나와요.` : `${sv.min}개에서 ${sv.max}개 사이로 무작위로 나와요.`)),
            h('p', { class: 'muted small' }, "참고: 주어·서술어는 거의 모든 문장에 있어서 쉬워요. 어렵게 하려면 두 개를 빼고 보어·독립어 등을 남겨 보세요. 보어와 목적어는 한 문장에 함께 넣기 어려워 함께 뽑지 않아요.")));
      }
      return card;
    }

    function section(kind, name, desc) {
      const list = h('div', { class: 'clist' });
      for (const it of D[kind]) list.append(item(kind, it));
      const add = h('button', { class: 'btn', type: 'button', onclick: () => {
        D[kind].push({ id: '', level: 'easy', label: '', short: '', example: '', rubric: '' });
        markDirty(); render(); const all = box.querySelectorAll(`[data-kind=${kind}] details.citem`); const last = all[all.length - 1]; if (last) { last.open = true; last.querySelector('input').focus(); }
      } }, '+ 조건 추가');
      const n = D[kind].filter((x) => !x.off).length;
      return h('section', { class: 'card', 'data-kind': kind }, h('h2', null, name, ' ', h('span', { class: 'pill gray' }, `켜진 것 ${n}개 / 전체 ${D[kind].length}개`)),
        h('p', { class: 'muted small', style: 'margin-bottom:12px' }, desc), list, h('div', { style: 'margin-top:12px' }, add));
    }

    function topics() {
      const list = h('div', { class: 'tlist' });
      for (const it of D.topics) {
        const on = h('input', { type: 'checkbox', 'aria-label': '출제하기' }); on.checked = !it.off;
        const inp = h('input', { type: 'text', maxlength: '40', value: it.label, 'aria-label': '주제 이름' });
        on.addEventListener('change', () => { it.off = !on.checked; inp.classList.toggle('off', it.off); markDirty(); });
        inp.addEventListener('input', () => { it.label = inp.value; markDirty(); });
        if (it.off) inp.classList.add('off');
        const del = h('button', { class: 'btn sm', type: 'button', 'aria-label': '지우기', onclick: () => { D.topics = D.topics.filter((x) => x !== it); markDirty(); render(); } }, '×');
        list.append(h('div', { class: 'trow' }, on, inp, del));
      }
      const bulk = h('textarea', { rows: '4', placeholder: '여러 주제를 한꺼번에 추가하려면 한 줄에 하나씩 붙여 넣으세요.\n예)\n시험 부정행위 근절\n학교 급식 잔반 줄이기' });
      const addBulk = h('button', { class: 'btn', type: 'button', onclick: () => {
        const have = new Set(D.topics.map((x) => x.label));
        let added = 0;
        for (const line of bulk.value.split(/\r?\n/)) {
          const label = line.replace(/^[\s\-•·\d.)]+/, '').trim().slice(0, 40);
          if (!label || have.has(label)) continue;
          have.add(label); D.topics.push({ id: '', label }); added++;
        }
        if (!added) { toast('추가할 새 주제가 없어요.', true); return; }
        markDirty(); render(); toast(`${added}개를 추가했어요. [저장]을 눌러야 반영돼요.`);
      } }, '추가');
      const n = D.topics.filter((x) => !x.off).length;
      return h('section', { class: 'card', 'data-kind': 'topics' }, h('h2', null, '공익광고 주제 ', h('span', { class: 'pill gray' }, `켜진 것 ${n}개 / 전체 ${D.topics.length}개`)),
        h('p', { class: 'muted small', style: 'margin-bottom:12px' }, '체크한 주제만 학생에게 출제돼요. 이름을 눌러 바로 고칠 수 있어요.'),
        list, h('div', { class: 'wrap', style: 'max-width:640px;margin-top:12px' }, bulk, h('div', null, addBulk)));
    }

    function render() {
      const mkSave = () => h('button', { class: 'btn primary', type: 'button', 'data-save': '', onclick: save }, '저장');
      bar = h('div', { class: 'notice info', role: 'status' });
      const reset = h('button', { class: 'btn danger', type: 'button', onclick: async () => {
        if (!confirm('모든 조건을 처음 상태(기본 조건)로 되돌릴까요? 직접 만들거나 고친 내용이 사라져요. 기록은 그대로 남아요.')) return;
        try { const r = await api('/api/teacher/conditions/reset', {}); D = r.conditions; PARTS = r.parts; T.dirty = false; T.info.counts = r.counts; T.info.conditionsCustomized = false; toast('기본 조건으로 되돌렸어요.'); render(); } catch (e) { toast(e.message, true); }
      } }, '기본 조건으로 되돌리기');
      box.replaceChildren(...[
        h('section', { class: 'card' }, h('h2', null, '조건 관리'),
          h('p', { class: 'muted', style: 'margin-bottom:12px' }, '문장 성분 조건(출제 방식과 개수), 문장의 짜임 조건, 공익광고 주제를 정할 수 있어요. 학생에게는 켜 둔 조건 중에서 무작위로 나가요. 공익광고 주제는 AI가 판정하지 않고 선생님이 직접 판단해요.'),
          bar, h('div', { class: 'toolbar', style: 'margin-top:12px' }, mkSave(), reset,
            T.info.conditionsCustomized ? h('span', { class: 'pill blue' }, '수정한 조건 사용 중') : h('span', { class: 'pill gray' }, '기본 조건 사용 중'))),
        sevenCard(),
        D.seven.mode === 'preset' ? section('comps', '문장 성분 조건 목록', '"~가 있는 문장"처럼 학생이 문장에 넣어야 할 성분을 정해요.') : null,
        section('structs', '문장의 짜임 조건', '홑문장, 이어진문장, 안은문장 등 문장의 짜임을 정해요.'),
        topics(),
        h('div', { class: 'toolbar' }, mkSave())].filter(Boolean));
      updateBar();
    }

    api('/api/teacher/conditions/full').then((r) => { D = r.conditions; PARTS = r.parts; render(); })
      .catch((e) => box.replaceChildren(h('div', { class: 'notice bad' }, e.message)));
  }

  // ---------- 설정·시험 ----------
  function showSettings(body) {
    const info = T.info;
    const lv = h('select', { id: 'lv' }, h('option', { value: 'mixed' }, '쉬움과 기본을 섞어서'), h('option', { value: 'easy' }, '쉬움만'), h('option', { value: 'basic' }, '기본만'));
    lv.value = info.settings.level;
    const rv = h('select', { id: 'rv' }, h('option', { value: '3' }, '3번 틀리면 예시 문장 보여 주기'), h('option', { value: '2' }, '2번 틀리면 예시 문장 보여 주기'), h('option', { value: '5' }, '5번 틀리면 예시 문장 보여 주기'), h('option', { value: '0' }, '맞힌 뒤에만 예시 문장 보여 주기'));
    rv.value = String(info.settings.revealAfter);
    const po = h('select', { id: 'po' }, h('option', { value: '1' }, '포스터 프롬프트 만들기: 학생에게 열기'), h('option', { value: '0' }, '포스터 프롬프트 만들기: 닫기 (나중에 열기)'));
    po.value = info.settings.poster === false ? '0' : '1';
    const tc = h('select', { id: 'tc' }, h('option', { value: '1' }, '주제 선택: 학생이 바꾸거나 직접 쓸 수 있게'), h('option', { value: '0' }, '주제 선택: 정해진 주제로 고정'));
    tc.value = info.settings.topicChoice === false ? '0' : '1';
    const saveClass = h('button', { class: 'btn primary', type: 'button', onclick: async () => {
      try { T.info = await api('/api/teacher/settings', { level: lv.value, revealAfter: parseInt(rv.value, 10), poster: po.value === '1', topicChoice: tc.value === '1' }, 'PUT'); toast('저장했어요.'); } catch (e) { toast(e.message, true); }
    } }, '저장');
    const classCard = h('section', { class: 'card' }, h('h2', null, '수업 설정'),
      h('div', { class: 'wrap', style: 'max-width:520px' },
        h('label', { class: 'field', for: 'lv' }, '문장의 짜임 난이도 (문장 성분 개수는 [조건 관리]에서 정해요)', lv),
        h('label', { class: 'field', for: 'rv' }, '예시 문장 공개', rv),
        h('label', { class: 'field', for: 'tc' }, '공익광고 주제', tc),
        h('label', { class: 'field', for: 'po' }, '포스터 프롬프트', po),
        h('div', null, saveClass),
        h('p', { class: 'muted small' }, (info.counts.mode === 'seven' ? `문장 성분 ${info.counts.sevenPool}가지 중 ${info.counts.sevenMin === info.counts.sevenMax ? info.counts.sevenMin : info.counts.sevenMin + '~' + info.counts.sevenMax}개` : `문장 성분 조건 ${info.counts.comps}가지`) + `, 문장의 짜임 ${info.counts.structs}가지, 공익광고 주제 ${info.counts.topics}가지에서 학생마다 무작위로 뽑아요. (고치려면 [조건 관리] 탭)`)));

    const mode = h('select', { id: 'aimode' }, h('option', { value: 'on' }, 'AI가 문법을 판정하고, 선생님이 확인·수정'), h('option', { value: 'off' }, 'AI 없이 선생님이 직접 판정 (API 키·비용 필요 없음)'));
    mode.value = info.settings.aiMode === 'off' ? 'off' : 'on';
    const modeSave = h('button', { class: 'btn primary', type: 'button', onclick: async () => {
      try { T.info = await api('/api/teacher/settings', { aiMode: mode.value }, 'PUT'); toast('저장했어요.'); renderShell(); } catch (e) { toast(e.message, true); }
    } }, '저장');
    const modeCard = h('section', { class: 'card' }, h('h2', null, '판정 방식'),
      h('div', { class: 'wrap', style: 'max-width:520px' },
        h('label', { class: 'field', for: 'aimode' }, '학생이 문장을 제출하면', mode),
        h('p', { class: 'muted small' }, 'AI 없이 방식에서는 학생에게 결과가 바로 나오지 않고 "선생님이 확인해 줄 거예요"라고 안내돼요. 선생님이 [제출 모아보기]에서 문법 정답/오답, 주제 적절/부적절, 피드백을 달면 학생 화면에 15초 안에 나타나요. 언제든 바꿀 수 있고, 바꾸기 전에 받은 제출은 그대로 남아요.'),
        h('div', null, modeSave)));

    // 패들렛 양식
    const SAMPLE = { '이름': '김하늘', '학번': '20301', '반': '2학년 3반', '광고문구': '학생들은 플라스틱을 줄인다', '성분조건': '주어·목적어가 모두 있는 문장', '짜임조건': '명사절을 안은문장', '주제': '플라스틱 사용 줄이기' };
    const ptpl = h('textarea', { id: 'ptpl', rows: '6', style: 'font-family:inherit' });
    ptpl.value = info.settings.padletTemplate || window.Poster.DEFAULT_PADLET;
    const pprev = h('pre', { class: 'block', style: 'white-space:pre-wrap;font:inherit;margin:0' });
    const updPrev = () => { pprev.textContent = window.Poster.fillTemplate(ptpl.value, SAMPLE); };
    ptpl.addEventListener('input', updPrev); updPrev();
    const padSave = h('button', { class: 'btn primary', type: 'button', onclick: async () => {
      try { T.info = await api('/api/teacher/settings', { padletTemplate: ptpl.value.trim() === window.Poster.DEFAULT_PADLET ? '' : ptpl.value }, 'PUT'); toast('패들렛 양식을 저장했어요.'); } catch (e) { toast(e.message, true); }
    } }, '저장');
    const padReset = h('button', { class: 'btn', type: 'button', onclick: () => { ptpl.value = window.Poster.DEFAULT_PADLET; updPrev(); } }, '기본 양식으로');
    const padCard = h('section', { class: 'card' }, h('h2', null, '패들렛 글 양식'),
      h('div', { class: 'wrap', style: 'max-width:520px' },
        h('p', { class: 'muted small' }, '학생이 [패들렛에 올릴 글 만들기]에서 복사하는 글의 양식이에요. 아래 낱말을 쓰면 학생 내용으로 바뀌어요: ' + window.Poster.PADLET_TOKENS.map((x) => '{' + x + '}').join(' ')),
        h('label', { class: 'field', for: 'ptpl' }, '양식', ptpl),
        h('div', null, h('b', { class: 'small' }, '미리보기 (예시 학생)'), pprev),
        h('div', { class: 'toolbar' }, padSave, padReset)));

    // 패들렛 연결: 학생이 자기 번호의 섹션(소회의실)에 바로 올리게 한다
    const pInfo = info.settings.padlet || { keySet: false, classes: {} };
    const pkey = h('input', { type: 'password', id: 'pkey', autocomplete: 'off', placeholder: pInfo.keySet ? pInfo.keyHint + ' (바꾸려면 새 키 입력)' : '패들렛 개발자 설정의 API 키' });
    const pmsg = h('div', { hidden: true });
    const pshow = (t, cls) => { pmsg.className = 'notice ' + cls; pmsg.textContent = t; pmsg.hidden = false; };
    const pcls = h('select', { id: 'pcls', 'aria-label': '반 선택' }, h('option', { value: '' }, '반 선택'));
    const pboard = h('input', { type: 'text', id: 'pboard', autocomplete: 'off', placeholder: '위에서 주소를 불러오면 자동으로 채워져요' });
    const prooms = h('textarea', { id: 'prooms', rows: '8', style: 'font-family:ui-monospace,Consolas,monospace;font-size:.85rem', placeholder: '번호  섹션ID(sec_…)  소회의실 링크(https://padlet.com/…)\n1  sec_AbCd…  https://padlet.com/…/breakout-room/…' });
    const purl = h('input', { type: 'text', id: 'purl', autocomplete: 'off', placeholder: '예: https://padlet.com/내아이디/제목-abcd1234efgh5678' });
    const pall = h('input', { type: 'text', id: 'pall', autocomplete: 'off', placeholder: '예: https://padlet.com/내아이디/제목-abcd1234efgh5678' });
    const puseAi = h('input', { type: 'checkbox', id: 'puseai', checked: true });
    const pres = h('div', { hidden: true, class: 'small' });
    const pimport = h('button', { class: 'btn primary', type: 'button', onclick: async () => {
      if (!pcls.value) { pshow('반을 먼저 선택해 주세요.', 'bad'); return; }
      if (!purl.value.trim()) { pshow('패들렛 주소를 넣어 주세요.', 'bad'); return; }
      if (!T.info.settings.padlet.keySet && !pkey.value.trim()) { pshow('패들렛 API 키를 먼저 입력하고 [저장]해 주세요.', 'bad'); return; }
      pshow('보드를 읽고 명단과 맞추는 중이에요…', 'info'); pres.hidden = true;
      try {
        const o = await api('/api/teacher/padlet/import', { cls: pcls.value, url: purl.value, useAi: puseAi.checked });
        if (!o.ok) { pshow(o.message + (o.detail ? ' · ' + o.detail : ''), 'bad'); return; }
        pboard.value = o.boardId; prooms.value = o.roomsText; if (o.boardUrl) purl.value = o.boardUrl;
        pres.replaceChildren(
          h('p', null, h('b', null, `「${o.title || '제목 없음'}」`), ` 섹션 ${o.total}개 중 ${o.matched}개를 명단과 맞췄어요 (규칙 ${o.byRule}개${o.aiAsked ? `, AI ${o.aiUsed}개` : ''}).`),
          o.aiError ? h('p', { class: 'muted' }, 'AI 해석은 건너뛰었어요: ' + o.aiError) : null,
          o.unmatched.length ? h('p', null, h('b', null, '맞추지 못한 섹션: '), o.unmatched.slice(0, 12).map((u) => u.title + (u.note ? `(${u.note})` : '')).join(' · ') + (o.unmatched.length > 12 ? ` 외 ${o.unmatched.length - 12}개` : '')) : null,
          o.missing.length ? h('p', null, h('b', null, '섹션이 없는 학생: '), o.missing.slice(0, 20).map((m) => `${m.no}번 ${m.name}`).join(', ') + (o.missing.length > 20 ? ` 외 ${o.missing.length - 20}명` : '')) : null,
          o.linksMissing ? h('p', { class: 'muted' }, `소회의실 링크는 패들렛이 API로 주지 않아요. 링크가 비어 있는 방 ${o.linksMissing}개는 아래 목록 줄 끝에 직접 붙여 넣어 주세요(없어도 바로 올리기는 돼요).`) : null,
          h('p', null, '아래 목록을 확인한 뒤 ', h('b', null, '[저장]'), '을 눌러야 적용돼요.'));
        pres.hidden = false; pshow('불러왔어요. 확인하고 저장해 주세요.', 'ok');
      } catch (e) { pshow(e.message, 'bad'); }
    } }, '섹션 자동 불러오기');
    const pstat = h('p', { class: 'muted small' });
    const refreshStat = () => {
      const c = (T.info.settings.padlet.classes || {})[pcls.value];
      pstat.textContent = !pcls.value ? '' : c ? `이 반: 방 ${c.rooms}개 등록 (바로 올리기 ${c.withSection}개, 방 열기 링크 ${c.withLink}개)` : '이 반은 아직 등록하지 않았어요.';
    };
    api('/api/teacher/overview').then((o) => { for (const c of o.classes) pcls.append(h('option', { value: c.cls }, `${c.cls} (${c.count}명)`)); }).catch(() => {});
    pcls.addEventListener('change', async () => {
      pboard.value = ''; prooms.value = ''; purl.value = ''; pall.value = ''; refreshStat();
      if (!pcls.value) return;
      try { const r = await api('/api/teacher/padlet/rooms?' + qs({ cls: pcls.value })); pboard.value = r.boardId; prooms.value = r.roomsText; purl.value = r.boardUrl || ''; pall.value = r.allUrl || ''; } catch (e) { pshow(e.message, 'bad'); }
    });
    const psave = h('button', { class: 'btn primary', type: 'button', onclick: async () => {
      try {
        const b = {}; if (pkey.value.trim()) b.apiKey = pkey.value;
        if (pcls.value) { b.cls = pcls.value; b.boardId = pboard.value; b.roomsText = prooms.value; b.boardUrl = /^https:\/\/padlet\.com\//.test(purl.value.trim()) ? purl.value.trim() : ''; b.allUrl = /^https:\/\/padlet\.com\//.test(pall.value.trim()) ? pall.value.trim() : ''; }
        if (!Object.keys(b).length) { pshow('저장할 내용이 없어요.', 'bad'); return; }
        const o = await api('/api/teacher/padlet', b, 'PUT'); T.info = o; pkey.value = '';
        pshow('저장했어요.' + (o.skipped && o.skipped.length ? ` 읽지 못한 줄 ${o.skipped.length}개: ${o.skipped.slice(0, 3).join(' | ')}` : ''), 'ok'); refreshStat();
      } catch (e) { pshow(e.message, 'bad'); }
    } }, '저장');
    const ptest = h('button', { class: 'btn', type: 'button', onclick: async () => {
      if (!pcls.value) { pshow('반을 먼저 선택해 주세요.', 'bad'); return; }
      pshow('연결을 시험하는 중이에요…', 'info');
      try { const o = await api('/api/teacher/padlet/test', { cls: pcls.value }); pshow(o.ok ? '키와 보드 ID가 맞아요. (글은 올리지 않았어요)' : o.message + (o.detail ? ' · ' + o.detail : ''), o.ok ? 'ok' : 'bad'); } catch (e) { pshow(e.message, 'bad'); }
    } }, '연결 시험');
    const pclear = h('button', { class: 'btn danger', type: 'button', onclick: async () => {
      if (!confirm('저장된 패들렛 API 키를 지울까요? 학생 화면의 [바로 올리기]가 사라져요.')) return;
      try { T.info = await api('/api/teacher/padlet', { clearApiKey: true }, 'PUT'); pshow('키를 지웠어요.', 'ok'); } catch (e) { pshow(e.message, 'bad'); }
    } }, 'API 키 지우기');
    const padletCard = h('section', { class: 'card' }, h('h2', null, '패들렛 연결 (학생이 내 방에 바로 올리기)'),
      h('div', { class: 'wrap', style: 'max-width:640px' },
        h('p', { class: 'muted small' }, '학생이 [패들렛에 올릴 글 만들기]에서 버튼 한 번으로 자기 번호의 섹션에 글을 올려요. 글은 선생님 계정 이름으로 올라가요. 반마다 보드 ID와 번호별 섹션 ID·소회의실 링크를 한 번 등록해 주세요. 키는 이 컴퓨터의 data 폴더에만 저장돼요.'),
        h('p', null, h('span', { class: 'pill ' + (pInfo.keySet ? 'ok' : 'warn') }, pInfo.keySet ? 'API 키 저장됨' : 'API 키가 필요해요'), ' ', pInfo.keySet ? h('span', { class: 'muted small' }, pInfo.keyHint) : null,
          pInfo.lastError ? h('span', { class: 'pill bad', style: 'margin-left:8px', title: pInfo.lastError }, '최근 오류: ' + pInfo.lastError) : null),
        h('label', { class: 'field', for: 'pkey' }, 'Padlet API 키', pkey),
        h('label', { class: 'field', for: 'pcls' }, '반', pcls),
        h('label', { class: 'field', for: 'purl' }, '패들렛 주소 (보드 주소를 복사해 붙여 넣으세요. 저장하면 학생의 [방 열기] 버튼이 이 주소로 가요. 번호별 소회의실 링크를 따로 넣으면 그 링크가 우선이에요)', purl),
        h('label', { class: 'field', for: 'pall' }, '모두의 결과물 보기 링크 (이 반 학생이 [③ 포스터 업로드 완료]를 누르면 [다른 친구들 포스터 보러가기] 버튼이 나타나요. 비워 두면 ③ 버튼이 안 보여요)', pall),
        h('label', { class: 'check-line' }, puseAi, ' 규칙으로 못 읽은 섹션 제목은 AI에게 번호를 물어보기 (제목만 보내고 학생 이름·명단은 보내지 않아요)'),
        h('div', { class: 'toolbar' }, pimport), pres,
        h('label', { class: 'field', for: 'pboard' }, '보드 ID', pboard),
        h('label', { class: 'field', for: 'prooms' }, '번호별 섹션 ID·링크 (한 줄에 한 명, 엑셀에서 복사해 붙여 넣어도 돼요)', prooms),
        pstat,
        h('div', { class: 'toolbar' }, psave, ptest, pclear), pmsg));

    const ai = info.ai;
    const prov = h('select', { id: 'prov' }, h('option', { value: 'claude' }, 'Claude (Anthropic)'), h('option', { value: 'gemini' }, 'Gemini (Google)'));
    prov.value = ai.provider || 'claude';
    const key = h('input', { type: 'password', id: 'key', autocomplete: 'off', placeholder: ai.claude.configured ? ai.claude.keyHint + ' (바꾸려면 새 키 입력)' : 'sk-ant-...' });
    const model = h('input', { type: 'text', id: 'model', placeholder: '비워 두면 기본 모델 (' + ai.claude.model + ')' });
    model.value = info.settings.model || '';
    const gkey = h('input', { type: 'password', id: 'gkey', autocomplete: 'off', placeholder: ai.gemini.configured ? ai.gemini.keyHint + ' (바꾸려면 새 키 입력)' : 'AIza...' });
    const gmodel = h('input', { type: 'text', id: 'gmodel', placeholder: '비워 두면 기본 모델 (' + ai.gemini.model + ')' });
    gmodel.value = info.settings.geminiModel || '';
    const aiMsg = h('div', { hidden: true });
    const showMsg = (t, cls) => { aiMsg.className = 'notice ' + cls; aiMsg.textContent = t; aiMsg.hidden = false; };
    const claudeBox = h('div', { class: 'wrap', style: 'max-width:520px' },
      h('p', null, h('span', { class: 'pill ' + (ai.claude.configured ? 'ok' : 'warn') }, ai.claude.configured ? 'Claude 키 저장됨' : 'Claude 키 없음'), ' ', ai.claude.configured ? h('span', { class: 'muted small' }, ai.claude.keyHint) : null),
      h('label', { class: 'field', for: 'key' }, 'Claude API 키 (Claude Console에서 발급)', key),
      h('label', { class: 'field', for: 'model' }, '모델 이름 (고급)', model));
    const geminiBox = h('div', { class: 'wrap', style: 'max-width:520px' },
      h('p', null, h('span', { class: 'pill ' + (ai.gemini.configured ? 'ok' : 'warn') }, ai.gemini.configured ? 'Gemini 키 저장됨' : 'Gemini 키 없음'), ' ', ai.gemini.configured ? h('span', { class: 'muted small' }, ai.gemini.keyHint) : null),
      h('label', { class: 'field', for: 'gkey' }, 'Gemini API 키 (Google AI Studio에서 발급)', gkey),
      h('label', { class: 'field', for: 'gmodel' }, '모델 이름 (고급)', gmodel),
      h('p', { class: 'muted small' }, '무료 이용 한도의 Gemini API는 입력 내용이 Google 서비스 개선에 쓰일 수 있어요. 학생 이름과 학번은 보내지 않고 조건과 문장만 보내요.'));
    const sync = () => { claudeBox.hidden = prov.value !== 'claude'; geminiBox.hidden = prov.value !== 'gemini'; };
    prov.addEventListener('change', sync); sync();
    const saveKey = h('button', { class: 'btn primary', type: 'button', onclick: async () => {
      try {
        const body2 = { provider: prov.value, model: model.value, geminiModel: gmodel.value };
        if (key.value.trim()) body2.apiKey = key.value;
        if (gkey.value.trim()) body2.geminiKey = gkey.value;
        T.info = await api('/api/teacher/settings', body2, 'PUT'); key.value = ''; gkey.value = ''; showMsg('저장했어요. [연결 시험]으로 확인해 보세요.', 'ok'); renderShell();
      } catch (e) { showMsg(e.message, 'bad'); }
    } }, '저장');
    const ping = h('button', { class: 'btn', type: 'button', onclick: async () => {
      showMsg('연결을 시험하는 중이에요… (저장한 AI로 시험해요)', 'info');
      try { const o = await api('/api/teacher/ping', {}); showMsg(o.ok ? '연결에 성공했어요.' : o.message, o.ok ? 'ok' : 'bad'); } catch (e) { showMsg(e.message, 'bad'); }
    } }, '연결 시험');
    const aiCard = h('section', { class: 'card' }, h('h2', null, 'AI 판정 연결'),
      h('p', { class: 'muted small', style: 'margin-bottom:12px' }, '문장 판정에 쓸 AI를 고르고 API 키를 입력해요. 학생의 이름과 학번은 AI에 보내지 않고, 조건과 문장만 보내요. 키는 저장해 둔 서버에만 보관돼요. AI를 바꾸면 이미 판정한 기록은 그대로 남아요.'),
      h('div', { class: 'wrap', style: 'max-width:520px' },
        h('label', { class: 'field', for: 'prov' }, '판정에 쓸 AI', prov),
        h('p', null, h('span', { class: 'pill ' + (ai.configured ? 'ok' : 'warn') }, ai.configured ? '지금 연결: ' + (ai.provider === 'gemini' ? 'Gemini' : 'Claude') : '선택한 AI의 키가 필요해요'), ' ', ai.configured ? h('span', { class: 'muted small' }, ai.model) : null),
        ai.fallback ? h('p', { class: 'muted small' }, '예비 AI: ' + (ai.fallback === 'gemini' ? 'Gemini' : 'Claude') + ' (위 AI가 응답하지 않거나 오류일 때 자동으로 대신 판정해요. 두 AI의 키를 모두 입력해 둔 경우에만 작동해요.)') : null,
        claudeBox, geminiBox,
        h('div', { class: 'toolbar' }, saveKey, ping), aiMsg));

    // 판정 시험
    const sel = (id, list) => { const s = h('select', { id }); for (const o of list) s.append(h('option', { value: o.id }, (o.level ? (o.level === 'easy' ? '[쉬움] ' : '[기본] ') : '') + o.label + (o.off ? ' (꺼짐)' : ''))); return s; };
    const tryBox = h('section', { class: 'card' }, h('h2', null, '판정 시험해 보기'), h('p', { class: 'muted' }, '조건 목록을 불러오는 중이에요…'));
    const buildTry = (conds) => {
      const sevenMode = conds.seven && conds.seven.mode === 'seven';
      let c1;
      const partBoxes = [];
      if (sevenMode) {
        c1 = h('div', { class: 'toolbar', id: 'tc' });
        conds.parts.forEach((pt, i) => {
          const cb = h('input', { type: 'checkbox', value: pt.id }); cb.checked = i === 2 || i === 4;
          partBoxes.push(cb); c1.append(h('label', { class: 'check-line' }, cb, pt.name));
        });
      } else { c1 = sel('tc', conds.comps); }
      const compValue = () => sevenMode ? 'p:' + partBoxes.filter((x) => x.checked).map((x) => x.value).join('+') : c1.value;
      const c2 = sel('ts', conds.structs), c3 = sel('tt', conds.topics);
      const sen = h('textarea', { id: 'tsen', rows: '3', placeholder: '조건에 맞춰 직접 쓴 문장을 입력해 보세요. (기록에는 남지 않아요)' });
      const out = h('div');
      const go = h('button', { class: 'btn primary', type: 'button' }, '판정해 보기');
      go.addEventListener('click', async () => {
        out.replaceChildren(h('p', { class: 'muted' }, '판정하는 중이에요…'));
        try {
          const o = await api('/api/teacher/try', { comp: compValue(), struct: c2.value, topic: c3.value, sentence: sen.value });
          if (!o.ok) { out.replaceChildren(h('div', { class: 'notice bad' }, o.message)); return; }
          const r = o.result;
          const fails = Object.values(r.checks).filter((c) => !c.ok).map((c) => c.where);
          const wrap = h('div', { class: 'wrap', style: 'max-width:none' },
            h('div', { class: 'toolbar' }, h('span', { class: 'pill ' + (r.verdict === 'correct' ? 'ok' : 'bad') }, r.verdict === 'correct' ? '정답' : '오답'), r.confidence === 'low' ? h('span', { class: 'pill warn' }, 'AI 확신 낮음 (실제 수업에서는 교사 확인 대상)') : null),
            highlight(sen.value.trim(), fails));
          for (const [k, c] of Object.entries(r.checks)) wrap.append(h('div', { class: 'check ' + (c.ok ? 'ok' : 'no') }, h('div', { class: 'tag' }, c.ok ? '충족' : '고치기'), h('div', null, h('div', { class: 't' }, CHECK_NAMES[k]), c.reason, c.fix ? h('div', { class: 'fixrow' }, '→ ' + c.fix + (c.where ? ` (고칠 부분: ${c.where})` : '')) : null)));
          if (r.analysis) wrap.append(h('div', { class: 'block' }, h('div', { class: 'ttl' }, '분석'), h('pre', null, r.analysis)));
          if (r.example) wrap.append(h('div', { class: 'block' }, h('div', { class: 'ttl' }, '예시'), r.example));
          out.replaceChildren(wrap);
        } catch (e) { out.replaceChildren(h('div', { class: 'notice bad' }, e.message)); }
      });
      tryBox.replaceChildren(h('h2', null, '판정 시험해 보기'),
        h('p', { class: 'muted small', style: 'margin-bottom:12px' }, '수업 전에 AI가 어떻게 판정하는지 직접 확인해 보세요. 비용이 조금 들지만 학생 기록에는 남지 않아요.'),
        h('div', { class: 'wrap', style: 'max-width:640px' },
          sevenMode ? h('div', { class: 'field' }, '문장 성분 조건 (체크한 성분이 모두 있어야 해요)', c1) : h('label', { class: 'field', for: 'tc' }, '문장 성분 조건', c1), h('label', { class: 'field', for: 'ts' }, '문장의 짜임 조건', c2),
          h('label', { class: 'field', for: 'tt' }, '공익광고 주제 (AI는 판정하지 않고, 예시 문장을 만들 때만 참고해요)', c3), h('label', { class: 'field', for: 'tsen' }, '문장', sen), h('div', null, go), out));
    };
    api('/api/teacher/conditions').then(buildTry).catch((e) => tryBox.replaceChildren(h('div', { class: 'notice bad' }, e.message)));

    // 수업 참관용 계정: 공용 비밀번호 하나로 여러 명이 동시에 들어올 수 있다
    const opw = h('input', { type: 'text', id: 'opw', autocomplete: 'off', placeholder: '비워 두면 참관 계정이 꺼져요', value: info.settings.observerPassword || '' });
    const oUrl = new URL('observer.html', window.ML_API ? new URL('./', location.href).href : location.origin + '/').href;
    const obsSave = h('button', { class: 'btn primary', type: 'button', onclick: async () => {
      try { T.info = await api('/api/teacher/settings', { observerPassword: opw.value.trim() }, 'PUT'); toast(opw.value.trim() ? '참관 계정을 열었어요.' : '참관 계정을 껐어요.'); } catch (e) { toast(e.message, true); }
    } }, '저장');
    const obsCard = h('section', { class: 'card' }, h('h2', null, '수업 참관용 계정'),
      h('div', { class: 'wrap', style: 'max-width:520px' },
        h('p', { class: 'muted small' }, '참관 선생님께 아래 주소와 비밀번호를 알려 주세요. 같은 비밀번호로 여러 명이 동시에 들어올 수 있어요. 참관자는 ① 학생 이름을 가린 현황판을 읽기만 할 수 있고 ② 학생 화면을 체험할 수 있어요. 체험한 문장은 어디에도 저장되지 않고 수업에 영향을 주지 않아요.'),
        h('div', { class: 'url' }, oUrl),
        h('label', { class: 'field', for: 'opw' }, '참관 비밀번호', opw),
        h('div', { class: 'toolbar' }, obsSave)));

    const dataCard = h('section', { class: 'card' }, h('h2', null, '자료 보관'),
      h('p', { class: 'muted' }, '명단과 모든 제출 기록은 프로그램 폴더 안의 data 폴더에 저장돼요. 이 폴더를 복사해 두면 백업이 되고, 새 컴퓨터로 옮길 때도 그대로 쓸 수 있어요.'));
    body.append(...[h('div', { class: 'two' }, classCard, modeCard), info.settings.aiMode === 'off' ? h('p', { class: 'muted small' }, 'AI 없이 선생님이 직접 판정하는 방식이라 아래 AI 연결과 판정 시험은 사용하지 않아요.') : null, h('div', { class: 'two' }, aiCard, padCard), padletCard, obsCard, tryBox, dataCard].filter(Boolean));
  }

  if (T.token) start().then(() => { if (!T.info) renderLogin(); }); else renderLogin();
})();
