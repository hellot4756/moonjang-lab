'use strict';
(function () {
  const app = document.getElementById('app');
  const KEY = 'moonjang.observer.v1';
  const SKEY = 'moonjang.student.v1';
  let token = '', timer = null, cls = '', filter = '', view = 'solo';
  try { token = sessionStorage.getItem(KEY) || ''; } catch (e) { /* 무시 */ }

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === false || v == null) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) { if (kid == null || kid === false) continue; el.append(kid.nodeType ? kid : document.createTextNode(kid)); }
    return el;
  }
  async function api(path, body) {
    const opt = { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json' } };
    if (token) opt.headers.Authorization = 'Bearer ' + token;
    if (body !== undefined) opt.body = JSON.stringify(body);
    let res;
    try { res = await fetch((window.ML_API || '') + path, opt); } catch (e) { throw new Error('서버에 연결할 수 없어요.'); }
    let data = {};
    try { data = await res.json(); } catch (e) { /* 본문 없음 */ }
    if (!res.ok) { if (res.status === 401 && token) { out(); } throw new Error(data.error || '문제가 생겼어요.'); }
    return data;
  }
  function out() {
    try { sessionStorage.removeItem(KEY); } catch (e) { /* 무시 */ }
    token = ''; clearInterval(timer); renderLogin();
  }

  function renderLogin() {
    const err = h('div', { class: 'notice bad', role: 'alert', hidden: true });
    const pw = h('input', { type: 'password', id: 'pw', autocomplete: 'off' });
    const form = h('form', { class: 'login card', novalidate: true },
      h('div', null, h('p', { class: 'eyebrow' }, '수업 참관'), h('h1', null, '문장 연습실')),
      h('p', { class: 'muted' }, '참관 비밀번호를 입력하면 수업 현황을 보고, 학생 화면을 체험해 볼 수 있어요.'),
      h('label', { class: 'field', for: 'pw' }, '참관 비밀번호', pw), err,
      h('button', { class: 'btn primary', type: 'submit' }, '들어가기'));
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault(); err.hidden = true;
      try {
        const r = await api('/api/observer/login', { password: pw.value });
        token = r.token;
        try { sessionStorage.setItem(KEY, token); } catch (e) { /* 무시 */ }
        renderMain();
      } catch (e) { err.textContent = e.message; err.hidden = false; }
    });
    app.replaceChildren(form); pw.focus();
  }

  const STATES = [['typing', '입력 중', '✎'], ['pending', '확인 대기', '⏳'], ['correct', '정답', '✓'], ['incorrect', '오답·반려', '✕'], ['waiting', '접속함', '○'], ['offline', '미접속', '–']];

  async function tryIt(mode) {
    // 학생 화면 체험: 참관 토큰으로 학생 화면을 연다(서버가 기록·현황판에 남기지 않는다). mode: 'solo' 개인 학습 | 'group' 모둠 학습
    let dtoken = token;
    try { dtoken = (await api('/api/observer/demo-token', { mode })).token; } catch (e) { alert(e.message); return; }
    try {
      sessionStorage.removeItem('moonjang.demog.v1');
      sessionStorage.setItem(SKEY, JSON.stringify({ token: dtoken, student: { sid: '참관체험', name: '참관 체험', cls: '참관', no: 0 }, demo: true }));
    } catch (e) { alert('이 브라우저에서는 체험 화면을 열 수 없어요.'); return; }
    location.href = './';
  }

  function renderMain() {
    const top = h('div', { class: 'top' },
      h('div', { class: 'brand' }, h('span', { class: 'stampbox sm' }, '제2막'), '문장 연습실', h('small', null, '문법광인의 서재 · 수업 참관')),
      h('div', null, h('button', { class: 'btn sm primary', type: 'button', onclick: () => tryIt('solo') }, '개인 학습 체험하기'), ' ', h('button', { class: 'btn sm primary', type: 'button', onclick: () => tryIt('group') }, '모둠 학습 체험하기'), ' ', h('button', { class: 'btn sm', type: 'button', onclick: out }, '나가기')));
    const note = h('div', { class: 'notice ok' }, '학생 이름은 가려서 보여요. 체험한 문장과 기록은 저장되지 않아 실제 수업에 영향이 없어요.');
    const toolbar = h('div', { class: 'toolbar' });
    const legend = h('div', { class: 'blegend' });
    const grid = h('div', { id: 'board' });
    const gridG = h('div', { id: 'gboard' });
    app.replaceChildren(top, h('div', { class: 'wrap wide', style: 'max-width:none' }, note, toolbar, legend, grid, gridG));
    let data = null, gdata = null;
    const GST = { done: ['완성', 'ok'], doing: ['진행 중', 'blue'], idle: ['시작 전', 'gray'] };
    const drawG = () => {
      legend.replaceChildren(); grid.replaceChildren();
      if (!gdata) return;
      const cnt = { done: 0, doing: 0, idle: 0 };
      for (const g of gdata.groups) cnt[g.state]++;
      const online = gdata.groups.reduce((n, g) => n + g.members.filter((m) => m.online).length, 0);
      legend.replaceChildren(...['done', 'doing', 'idle'].map((k) => h('span', { class: 'pill ' + GST[k][1], style: 'margin-right:6px' }, `${GST[k][0]} ${cnt[k]}`)), h('span', { class: 'pill gray' }, `모둠 ${gdata.groups.length}개 · 접속 ${online}명`));
      const cards = gdata.groups.map((g) => h('div', { class: 'card gb ' + g.state },
        h('div', { class: 'gbhead' }, h('b', null, `${gdata.cls.replace('학년 ', '-').replace('반', '')} · ${g.no}모둠`), h('span', { class: 'pill ' + GST[g.state][1] }, GST[g.state][0])),
        h('div', { class: 'mprog' }, h('div', { class: 'mbar', style: `width:${g.total ? Math.round(g.done / g.total * 100) : 0}%` })),
        h('div', { class: 'gbstat' }, h('b', null, `문장 ${g.done}/${g.total}`), g.pending ? ` · 확인 중 ${g.pending}` : '', ` · 도전 ${g.tries} · 오답 ${g.wrong}`),
        h('div', { class: 'gbmem' }, g.members.map((m) => h('div', { class: 'gbm' + (m.online ? ' on' : '') },
          h('i', { class: 'dot' + (m.typing ? ' typing' : m.online ? ' on' : '') }), h('span', null, m.name), m.leader ? h('span', { class: 'pill gray' }, '모둠장') : null, m.typing ? h('span', { class: 'muted small' }, `입력 중 ${m.draftLen}자`) : null))),
        h('div', { class: 'gbslots small' }, g.slots.map((x) => h('span', { class: 'pill ' + (x.status === 'done' ? 'ok' : x.status === 'pending' ? 'warn' : 'gray'), style: 'margin:0 4px 4px 0' }, `문장 ${x.i + 1} ${x.status === 'done' ? '완성' : x.status === 'pending' ? '확인 중' : '아직'}`)))));
      gridG.replaceChildren(cards.length ? h('div', { class: 'gbgrid' }, cards) : h('div', { class: 'card muted' }, '이 반에는 아직 모둠을 고른 학생이 없어요.'));
    };
    const draw = () => {
      if (view === 'group') { drawG(); return; }
      gridG.replaceChildren();
      if (!data) return;
      const cnt = {};
      for (const s of data.students) cnt[s.state] = (cnt[s.state] || 0) + 1;
      legend.replaceChildren(...STATES.map(([id, name, icon]) => h('button', { type: 'button', class: 'lg st-' + id + (filter === id ? ' on' : ''), onclick: () => { filter = filter === id ? '' : id; draw(); } },
        h('span', { class: 'ic', 'aria-hidden': 'true' }, icon), ' ' + name + ' ', h('b', null, String(cnt[id] || 0)))));
      const byCls = new Map();
      for (const s of data.students) { if (!byCls.has(s.cls)) byCls.set(s.cls, []); byCls.get(s.cls).push(s); }
      const COLS = data.cols || 6, nodes = [];
      if (!data.students.length) nodes.push(h('div', { class: 'card muted' }, '아직 명단이 없어요.'));
      for (const [c, list] of byCls) {
        const byId = new Map(list.map((x) => [x.sid, x]));
        const slots = ((data.seats || {})[c] || []).map((sid) => byId.get(sid) || null);
        const placed = new Set(slots.filter(Boolean).map((x) => x.sid));
        while (slots.length && !slots[slots.length - 1]) slots.pop();
        slots.push(...list.filter((x) => !placed.has(x.sid)).sort((a, b) => (a.no || 999) - (b.no || 999)));
        while (slots.length % COLS) slots.push(null);
        nodes.push(h('h3', { class: 'btitle' }, c, h('span', { class: 'muted small' }, ` ${list.length}명`)));
        const board = h('div', { class: 'board' });
        slots.forEach((s) => {
          if (!s) { board.append(h('div', { class: 'slot', 'aria-hidden': 'true' })); return; }
          const [, name, icon] = STATES.find((x) => x[0] === s.state);
          board.append(h('div', { class: 'cell st-' + s.state + (filter && filter !== s.state ? ' dim' : ''), title: `${s.no ? s.no + '번 ' : ''}${s.name} · ${name}` },
            h('div', { class: 'ctop' }, h('span', { class: 'no' }, s.no || ''), s.attempt > 1 ? h('span', { class: 'att' }, s.attempt + '회') : null),
            h('div', { class: 'nm' }, s.name),
            h('div', { class: 'cst' }, h('span', { class: 'ic', 'aria-hidden': 'true' }, icon), h('span', { class: 'lb' }, ' ' + (s.state === 'pending' && !s.manual ? 'AI 오류' : name)))));
        });
        nodes.push(board);
      }
      grid.replaceChildren(...nodes);
    };
    const sel = () => {
      const el = h('select', { 'aria-label': '반 선택' }, h('option', { value: '' }, '전체 반'));
      for (const c of ((data && data.classes) || [])) el.append(h('option', { value: c.cls }, `${c.cls} (${c.count}명)`));
      el.value = cls; el.addEventListener('change', () => { cls = el.value; load(); });
      return el;
    };
    const hint = h('span', { class: 'muted small' }, '3초마다 자동으로 바뀌어요');
    const viewBtns = () => (data && data.groupMode ? [['solo', '개인 현황판'], ['group', '모둠 현황판']].map(([v, name]) => h('button', { type: 'button', class: 'chip' + (view === v ? ' on' : ''), 'aria-pressed': String(view === v), onclick: () => { view = v; if (v === 'group' && !cls && data.classes[0]) cls = data.classes[0].cls; toolbar.replaceChildren(sel(), ...viewBtns(), hint); load(); } }, name)) : []);
    const load = async () => {
      try {
        const first = !data;
        data = await api('/api/observer/board?cls=' + encodeURIComponent(cls));
        if (first || (data.groupMode && !toolbar.querySelector('.chip')) || (!data.groupMode && toolbar.querySelector('.chip'))) { if (!data.groupMode) view = 'solo'; toolbar.replaceChildren(sel(), ...viewBtns(), hint); }
        if (view === 'group') gdata = await api('/api/observer/gboard?cls=' + encodeURIComponent(cls));
        draw();
      } catch (e) { grid.replaceChildren(h('div', { class: 'notice bad' }, e.message)); }
    };
    load();
    clearInterval(timer);
    timer = setInterval(() => { if (!document.hidden) load(); }, 3000);
  }

  if (token) renderMain(); else renderLogin();
})();
