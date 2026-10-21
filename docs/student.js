'use strict';
(function () {
  const app = document.getElementById('app');
  const KEY = 'moonjang.student.v1';

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

  let sentText = '';  // 마지막으로 제출한 글
  const S = {
    token: '', student: null, challenge: null, attempts: 0, last: null,
    draft: '', stats: { tries: 0, correct: 0 }, busy: false, flagged: false,
    notice: '', showHist: false, history: [], topicText: '',
    posterOn: false, showPoster: false, showPadlet: false, padPick: '', padletTemplate: '', padlet: { post: false, link: '' }, group: null, pstate: { form: window.Poster.defaults(), out: null, lang: 'ko' }, mission: { itemId: '', copied: false, opened: false, others: false, view: '', pick: -1 },
  };

  function save() {
    try {
      sessionStorage.setItem(KEY, JSON.stringify({
        token: S.token, student: S.student, challenge: S.challenge, attempts: S.attempts,
        last: S.last, demo: S.demo, draft: S.draft, topicText: S.topicText, flagged: S.flagged, pstate: S.pstate, showPoster: S.showPoster, mission: S.mission,
      }));
    } catch (e) { /* 저장소를 쓸 수 없어도 동작한다 */ }
  }
  function load() {
    try {
      const o = JSON.parse(sessionStorage.getItem(KEY) || 'null');
      if (o && o.token) Object.assign(S, o);
    } catch (e) { /* 무시 */ }
  }
  function logout(expired) {
    try { sessionStorage.removeItem(KEY); } catch (e) { /* 무시 */ }
    Object.assign(S, { group: null, topicText: '', token: '', student: null, challenge: null, attempts: 0, last: null, draft: '', flagged: false, showHist: false, history: [], showPoster: false, pstate: { form: window.Poster.defaults(), out: null, lang: 'ko' } });
    S.notice = expired ? '다시 입장해 주세요.' : '';
    render();
  }

  async function api(path, body) {
    const opt = { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json' } };
    if (S.token) opt.headers.Authorization = 'Bearer ' + S.token;
    if (body !== undefined) opt.body = JSON.stringify(body);
    let res;
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 100000); opt.signal = ctl.signal;
    try { res = await fetch((window.ML_API || '') + path, opt); } catch (e) { throw new Error(e && e.name === 'AbortError' ? '응답이 너무 오래 걸려요. 잠시 뒤에 [내 기록]을 확인하거나 다시 제출해 주세요.' : '서버에 연결할 수 없어요. 와이파이 연결을 확인해 주세요.'); } finally { clearTimeout(tm); }
    let data = {};
    try { data = await res.json(); } catch (e) { /* 본문 없음 */ }
    if (!res.ok) {
      if (res.status === 401 && S.token) logout(true);
      const err = new Error(data.error || '문제가 생겼어요. 잠시 후 다시 시도해 주세요.');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // ---------- 입장 화면 ----------
  function renderLogin() {
    const err = h('div', { class: 'notice bad', role: 'alert', hidden: true });
    const sid = h('input', { type: 'text', id: 'sid', inputmode: 'numeric', autocomplete: 'off', placeholder: '예: 20312', required: true });
    const name = h('input', { type: 'text', id: 'name', autocomplete: 'off', placeholder: '예: 김하늘', required: true });
    const btn = h('button', { class: 'btn primary', type: 'submit' }, '입장하기');
    const form = h('form', { class: 'gate-panel', novalidate: true },
      h('div', null, h('p', { class: 'eyebrow' }, 'ENTRY REGISTRATION'), h('h2', null, '입실 등록')),
      h('p', { class: 'muted' }, '학번과 이름을 입력하면 수업이 시작돼요.'),
      S.notice ? h('div', { class: 'notice warn' }, S.notice) : null,
      h('div', { class: 'row' },
        h('label', { class: 'field', for: 'sid' }, '학번', sid),
        h('label', { class: 'field', for: 'name' }, '이름', name)),
      err, btn);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      err.hidden = true;
      if (!sid.value.trim() || !name.value.trim()) { err.textContent = '학번과 이름을 모두 입력해 주세요.'; err.hidden = false; return; }
      btn.disabled = true;
      try {
        const r = await api('/api/login', { sid: sid.value, name: name.value });
        S.token = r.token; S.student = r.student; S.notice = '';
        await enter();
      } catch (e) {
        err.textContent = e.message; err.hidden = false; btn.disabled = false;
      }
    });
    document.body.classList.add('is-gate'); app.classList.add('gatewrap');
    app.replaceChildren(h('div', { class: 'gate' },
      h('div', { class: 'gate-ceiling', 'aria-hidden': 'true' }),
      h('div', { class: 'gate-frame' },
        h('header', { class: 'gate-lintel' }, h('span', { class: 'gate-mark' }, '後'),
          h('span', { class: 'gate-owner' }, 'CATEGORY A', h('i', null, '/'), '문법광인의 서재 · 제2막'),
          h('span', { class: 'gate-led' }, h('i', { class: 'dot on' }), '수업 개시')),
        h('div', { class: 'gate-doors' },
          h('section', { class: 'gate-leaf left' },
            h('p', { class: 'eyebrow' }, '제2막 · 후계자 수업'),
            h('h1', null, '탈출인 줄 알았는데', h('br'), '후계자 수업이었다'),
            h('div', { class: 'gate-copy' },
              h('p', null, '문장을 훌륭히 ', h('b', null, '해부하고 분류'), '해 낸 너희를,', h('br'), h('b', null, '문법광인이 눈여겨보았다'), '.'),
              h('p', null, '이제 거꾸로, 주어진 ', h('b', null, '문법 조건'), '에 맞는 문장을 ', h('b', null, '직접 제작'), '한다. 완성한 문장은 포스터가 된다.')),
            h('p', { class: 'gate-order' }, '조건을 읽고, 문장을 짓고, 포스터로 내보내라.', h('br'), '이 방이 계속 안녕할 수 있게.'),
            h('p', { class: 'sig' }, '- A.N. -')),
          h('section', { class: 'gate-leaf right' }, form)))));
    sid.focus();
  }

  async function enter() {
    try {
      const me = await api('/api/me');
      S.demo = !!me.demo; S.student = me.student; S.stats = me.stats; S.history = me.history; S.posterOn = !!me.poster; S.padletTemplate = me.padletTemplate || ''; S.padlet = me.padlet || { post: false, link: '' };
      S.group = me.group || null;
      if (S.group && S.challenge && S.challenge.slot === undefined) S.challenge = null;   // 모둠 활동에서는 모둠 문제만 쓴다
      if (!S.group && S.challenge && S.challenge.slot !== undefined) S.challenge = null;
      if (S.group && !S.group.isLeader) S.challenge = null;
      if (S.challenge) {
        if (me.topicChoice === false) { S.challenge.topicChoice = false; S.topicText = ''; }
        else if (Array.isArray(me.topicList) && me.topicList.length) { S.challenge.topicChoice = true; S.challenge.topicList = me.topicList; }
      }
    } catch (e) { render(); return; }
    if (!S.challenge && !S.group) await newChallenge(false);
    save();
    render();
  }

  async function newChallenge(rerender) {
    try {
      const c = await api('/api/challenge', {});
      S.challenge = c; S.attempts = 0; S.last = null; S.draft = ''; S.topicText = ''; S.flagged = false; S.notice = '';
    } catch (e) {
      S.notice = e.message;
    }
    save();
    if (rerender !== false) render();
  }


  // ---------- 공익광고 포스터 프롬프트 ----------
  const P = window.Poster;

  // 모둠 활동에서 이미 완성한(또는 선생님이 확인 중인) 모둠 문장들
  function groupSentences() {
    const G = S.group;
    if (!G || !G.slots) return [];
    return G.slots.filter((x) => x.status !== 'todo').map((x) => ({ id: x.id, slot: x.i, sentence: x.sentence, topic: x.topic || '', comp: x.comp || '', struct: x.struct || '', verdict: x.status === 'done' ? 'correct' : 'pending', padletAt: x.padletAt || 0 }));
  }

  function posterSentences() {
    if (S.group) return groupSentences();
    const seen = new Set(), out = [];
    const add = (id, sentence, topic, verdict) => {
      const key = sentence + '|' + topic;
      if (!sentence || seen.has(key)) return;
      seen.add(key); out.push({ id, sentence, topic: topic || '', verdict });
    };
    if (S.last && S.last.sentence && S.last.verdict !== 'incorrect' && S.challenge) add(S.last.id, S.last.sentence, S.last.topic || S.challenge.conditions.topic.label, S.last.verdict);
    for (const it of S.history) if (it.verdict !== 'incorrect') add(it.id, it.sentence, it.topic, it.verdict);
    return out;
  }

  async function copyText(text, ta) {
    try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; } } catch (e) { /* 아래 방법으로 */ }
    try { ta.focus(); ta.select(); ta.setSelectionRange(0, text.length); return document.execCommand('copy'); } catch (e) { return false; }
  }

  function drawPoster(box) {
    const redo = () => (box._redraw ? box._redraw() : redo());
    const formOnly = !!box._formOnly;   // 미션 안내 화면에서는 입력 칸만 보여 준다
    const PS = S.pstate;
    const F = PS.form;
    const sents = posterSentences();
    const kids = formOnly ? [h('p', { class: 'muted', style: 'margin-bottom:10px' }, '마음에 드는 것을 고르세요. 잘 모르겠으면 그대로 두고 맨 아래 [프롬프트 만들기]를 눌러도 돼요.')]
      : [h('h2', null, '공익광고 포스터 프롬프트 만들기'),
        h('p', { class: 'muted', style: 'margin-bottom:12px' }, '내가 완성한 문장으로 이미지 만들기 AI에게 줄 요청문(프롬프트)을 만들어요. 아래에서 고르거나 쓴 뒤 [프롬프트 만들기]를 눌러 보세요.')];
    if (!sents.length) {
      kids.push(h('div', { class: 'notice warn' }, '먼저 조건에 맞는 문장을 완성해 보세요. 문법 조건을 맞힌 문장(선생님이 확인 중인 문장 포함)으로 만들 수 있어요.'));
      box.replaceChildren(...kids); return;
    }

    // 문장 고르기
    const sel = h('select', { id: 'pp-sent', 'aria-label': '문장 고르기' });
    sents.forEach((x, i) => sel.append(h('option', { value: String(i) }, `${x.sentence}${x.topic ? '  (' + x.topic + ')' : ''}`)));
    const idx = sents.findIndex((x) => x.sentence === F.sentence && x.topic === F.topic);
    if (idx >= 0) sel.value = String(idx);
    sel.addEventListener('change', () => { const x = sents[parseInt(sel.value, 10)]; F.sentence = x.sentence; F.topic = x.topic; PS.out = null; save(); redo(); });
    if (!F.sentence) { F.sentence = sents[0].sentence; F.topic = sents[0].topic; }

    const text = (key, label, ph, rows) => {
      const el = rows ? h('textarea', { rows: String(rows), maxlength: '200', placeholder: ph || '' }) : h('input', { type: 'text', maxlength: '100', placeholder: ph || '' });
      el.value = F[key] || '';
      el.addEventListener('input', () => { F[key] = el.value; save(); });
      return h('label', { class: 'field' }, label, el);
    };
    const chips = (key, extra) => {
      const o = P.OPTIONS[key];
      const wrap = h('div', { class: 'chips' });
      for (const [val, name] of o.items) {
        const on = F[key] === val && !(key === 'color' && F.colorCustom && F.colorCustom.trim());
        wrap.append(h('button', { type: 'button', class: 'chip' + (on ? ' on' : ''), 'aria-pressed': String(on), onclick: () => {
          F[key] = val; if (key === 'color') F.colorCustom = '';
          save(); redo();
        } }, name));
      }
      return h('div', { class: 'field' }, h('span', null, o.label), wrap, extra || null);
    };
    const colorCustom = h('input', { type: 'text', maxlength: '40', placeholder: '직접 쓰기 (예: 연한 하늘색과 흰색)' });
    colorCustom.value = F.colorCustom || '';
    colorCustom.addEventListener('input', () => { F.colorCustom = colorCustom.value; save(); });
    colorCustom.addEventListener('change', () => redo());

    const basics = [text('topic', '공익광고 주제 (바꿀 수 있어요)', '예: 플라스틱 사용 줄이기'),
      text('sentence', '포스터에 들어갈 문장 (꼭 그대로 들어가요. 고칠 수 있어요)', '', 2), chips('font'), chips('textPos'),
      chips('format'), chips('style'), chips('mood'), chips('color', colorCustom)];
    const more = [chips('composition'), chips('audience'),
      text('subject', '누가·무엇이 나오나요?', '예: 교복을 입은 학생들, 북극곰, 페트병'),
      text('scene', '어디에서 어떤 장면인가요?', '예: 쓰레기가 가득한 바다, 깨끗한 학교 운동장'),
      text('extra', '더 원하는 것 (세부 요청)', '예: 밝은 햇빛, 큰 글씨, 아이콘 몇 개 넣기', 2),
      text('avoid', '넣지 않았으면 하는 것', '예: 어두운 배경, 너무 많은 글자')];
    kids.push(h('div', { class: 'wrap pform', style: 'max-width:none' },
      formOnly ? null : h('label', { class: 'field', for: 'pp-sent' }, '어떤 문장으로 만들까요?', sel),
      basics,
      formOnly ? h('details', { class: 'pmore' }, h('summary', null, '더 자세히 꾸미고 싶다면 (선택)'), more) : more));

    const make = h('button', { class: 'btn primary', type: 'button', onclick: async () => {
      F.colorCustom = (F.colorCustom || '').trim();
      PS.out = { ko: P.build(F, 'ko'), en: P.build(F, 'en') };
      PS.lang = PS.lang || 'ko'; box._made = true;
      save(); redo();
      const o = document.getElementById('pp-out'); if (o) o.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      try { await api('/api/poster', { prompt: PS.out.ko, promptEn: PS.out.en, topic: F.topic, sentence: F.sentence, opts: F }); } catch (e) { /* 저장하지 못해도 프롬프트는 쓸 수 있다 */ }
    } }, formOnly ? '프롬프트 만들기 →' : '프롬프트 만들기');
    kids.push(h('div', { class: 'actions' }, make,
      h('button', { class: 'btn', type: 'button', onclick: () => { Object.assign(F, P.defaults(), { topic: F.topic, sentence: F.sentence }); PS.out = null; save(); redo(); } }, '선택 처음으로')));

    if (PS.out && !formOnly) {
      const lang = PS.lang === 'en' ? 'en' : 'ko';
      const ta = h('textarea', { id: 'pp-ta', rows: '14', readonly: true, 'aria-label': '만들어진 프롬프트', style: 'font-size:.95rem;line-height:1.55' });
      ta.value = PS.out[lang];
      const tabBtn = (code, name) => h('button', { type: 'button', class: 'chip' + (lang === code ? ' on' : ''), 'aria-pressed': String(lang === code), onclick: () => { PS.lang = code; save(); redo(); } }, name);
      const msg = h('span', { class: 'muted small', role: 'status' });
      const hasRoom = !!(S.padlet && S.padlet.link);
      const room = hasRoom ? h('a', { id: 'pp-room', class: 'btn', href: S.padlet.link, target: '_blank', rel: 'noopener' }, S.padlet.board ? '패들렛 보드 열기 →' : '내 패들렛 방 열기 →') : null;
      const copyBtn = h('button', { class: 'btn primary', type: 'button' }, '① 복사하기');
      copyBtn.addEventListener('click', async () => {
        const ok = await copyText(ta.value, ta);
        msg.textContent = ok ? (hasRoom ? '복사했어요! 이미지 AI에서 그림을 만든 뒤, ② 버튼으로 내 패들렛 방에 가서 올려요.' : '복사했어요! 이미지 AI에 붙여 넣으세요.') : '복사가 안 돼요. 글 위를 길게 눌러 직접 복사해 주세요.';
        if (ok && room) { copyBtn.classList.remove('primary'); room.classList.add('primary'); }
      });
      if (room) room.prepend('② ');
      // ③ 포스터 업로드 완료: 누르면 숨겨 둔 [다른 친구들 포스터 보러가기] 링크가 나타난다(반별 전체 링크가 설정된 경우만)
      const allUrl = (S.padlet && S.padlet.all) || '';
      const allLink = allUrl ? h('div', { id: 'pp-all', class: 'actions', style: 'margin-top:8px', hidden: !PS.done },
        h('a', { class: 'btn primary', href: allUrl, target: '_blank', rel: 'noopener' }, '다른 친구들 포스터 보러가기 →')) : null;
      const doneBtn = allUrl ? h('button', { class: 'btn small', type: 'button', style: 'margin-left:auto', 'aria-expanded': String(!!PS.done), onclick: () => {
        PS.done = true; save(); const a = document.getElementById('pp-all'); if (a) a.hidden = false; doneBtn.setAttribute('aria-expanded', 'true');
      } }, '③ 포스터 업로드 완료') : null;
      kids.push(h('div', { id: 'pp-out', class: 'block', style: 'margin-top:14px' },
        h('div', { class: 'ttl' }, '완성된 프롬프트'),
        h('div', { class: 'chips', style: 'margin:6px 0' }, tabBtn('ko', '한국어'), tabBtn('en', 'English')),
        ta,
        h('div', { class: 'actions', style: 'align-items:center' }, copyBtn, room, doneBtn, msg),
        !hasRoom ? h('p', { class: 'muted small' }, '내 패들렛 방 주소가 아직 등록되지 않았어요. 선생님이 안내한 패들렛 방으로 직접 이동해 주세요.') : null,
        h('p', { class: 'muted small' }, '복사한 글을 선생님이 안내한 이미지 만들기 도구에 붙여 넣어 보세요. 마음에 안 들면 위의 선택을 바꾸고 [프롬프트 만들기]를 다시 눌러요.'),
        allLink));
    }
    box.replaceChildren(...kids.flat());
  }

  function posterCard() {
    const box = h('section', { class: 'card', id: 'posterbox' });
    drawPoster(box);
    return box;
  }


  // ---------- 패들렛 글 만들기 ----------
  function eligibleSentences() {
    if (S.group) return groupSentences();
    const seen = new Set(), out = [];
    const add = (id, sentence, topic, comp, struct, verdict) => {
      const key = sentence + '|' + topic;
      if (!sentence || seen.has(key)) return;
      seen.add(key); out.push({ id, sentence, topic: topic || '', comp: comp || '', struct: struct || '', verdict });
    };
    if (S.last && S.last.sentence && S.last.verdict !== 'incorrect' && S.challenge) {
      const c = S.challenge.conditions;
      add(S.last.id, S.last.sentence, S.last.topic || c.topic.label, c.comp.label, c.struct.label, S.last.verdict);
    }
    for (const it of S.history) if (it.verdict !== 'incorrect') add(it.id, it.sentence, it.topic, it.comp, it.struct, it.verdict);
    return out;
  }

  function drawPadlet(box) {
    const sents = eligibleSentences();
    const kids = [h('h2', null, '패들렛에 올리기'),
      h('p', { class: 'muted', style: 'margin-bottom:12px' }, S.padlet.post ? '광고문구, 문법 조건, 주제를 내 패들렛 방에 바로 올려요. 올린 뒤에는 이어서 포스터 프롬프트를 만들어요.' : '광고문구, 문법 조건, 주제를 양식에 맞게 한 번에 복사해요. 패들렛에서 새 글을 만들고 붙여 넣은 뒤, 포스터 그림을 함께 올려 주세요.')];
    if (!sents.length) {
      kids.push(h('div', { class: 'notice warn' }, '먼저 조건에 맞는 문장을 완성해 보세요. 문법 조건을 맞힌 문장(선생님이 확인 중인 문장 포함)으로 만들 수 있어요.'));
      box.replaceChildren(...kids); return;
    }
    let cur = sents.findIndex((x) => x.id === S.padPick);
    if (cur < 0) cur = 0;
    const item = sents[cur];
    S.padPick = item.id;
    const sel = h('select', { id: 'pad-sent', 'aria-label': '광고문구 고르기' });
    sents.forEach((x, i) => sel.append(h('option', { value: String(i) }, `${x.sentence}${x.topic ? '  (' + x.topic + ')' : ''}`)));
    sel.value = String(cur);
    sel.addEventListener('change', () => { S.padPick = sents[parseInt(sel.value, 10)].id; drawPadlet(box); });
    const st = S.student;
    const text = window.Poster.fillTemplate(S.padletTemplate, {
      '이름': st.name, '학번': st.sid, '반': st.cls, '광고문구': item.sentence, '성분조건': item.comp, '짜임조건': item.struct, '주제': item.topic,
    });
    const ta = h('textarea', { id: 'pad-ta', rows: '6', readonly: true, 'aria-label': '패들렛에 올릴 글', style: 'font-size:.98rem;line-height:1.6' });
    ta.value = text;
    const msg = h('span', { class: 'muted small', role: 'status' });
    kids.push(h('div', { class: 'wrap', style: 'max-width:none' },
      h('label', { class: 'field', for: 'pad-sent' }, '어떤 광고문구를 올릴까요?', sel),
      h('label', { class: 'field', for: 'pad-ta' }, '이렇게 복사돼요', ta),
      h('div', { class: 'actions' },
        h('button', { class: S.padlet.post ? 'btn' : 'btn primary', type: 'button', onclick: async () => { msg.textContent = (await copyText(ta.value, ta)) ? '복사했어요! 패들렛에 붙여 넣으세요.' : '복사가 안 돼요. 위 글을 길게 눌러 직접 복사해 주세요.'; } }, '한 번에 복사하기'), msg)));
    // 패들렛 내 방에 바로 올리기 (선생님이 연결해 둔 경우)
    const postedAt = S.group ? (item.padletAt || 0) : ((S.last && S.last.id === item.id && S.last.padletAt) || (S.history.find((x) => x.id === item.id) || {}).padletAt || 0);
    const roomLink = S.padlet.link ? h('a', { class: 'btn' + (S.padlet.post ? '' : ' primary'), href: S.padlet.link, target: '_blank', rel: 'noopener' }, S.padlet.board ? '패들렛 보드 열기' : '내 패들렛 방 열기') : null;
    if (S.padlet.post) {
      const pmsg = h('div', { class: 'notice' + (postedAt ? ' ok' : ''), role: 'status', hidden: !postedAt }, postedAt ? '이 문장은 이미 내 패들렛 방에 올렸어요.' : '');
      const go = h('button', { class: 'btn primary', type: 'button' }, postedAt ? '다시 올리기' : '패들렛에 올리기');
      go.addEventListener('click', async () => {
        if (postedAt && !confirm('이미 올린 글이에요. 한 번 더 올리면 같은 글이 하나 더 생겨요. 올릴까요?')) return;
        go.disabled = true; pmsg.hidden = false; pmsg.className = 'notice'; pmsg.textContent = '올리는 중…';
        try {
          const o = await api('/api/padlet/post', { id: item.id, again: !!postedAt });
          if (S.last && S.last.id === item.id) S.last.padletAt = o.at || Date.now();
          const h0 = S.history.find((x) => x.id === item.id); if (h0) h0.padletAt = o.at || Date.now();
          save(); drawPadlet(box);
          const m2 = document.getElementById('pad-pmsg'); if (m2) { m2.hidden = false; m2.className = 'notice ok'; m2.textContent = '내 패들렛 방에 올렸어요!'; }
        } catch (e) { pmsg.className = 'notice bad'; pmsg.textContent = e.message; go.disabled = false; }
      });
      pmsg.id = 'pad-pmsg';
      kids.push(h('div', { class: 'wrap', style: 'max-width:none;margin-top:14px;padding-top:14px;border-top:1px solid var(--line)' },
        h('p', { class: 'muted small' }, '위 글을 내 패들렛 방에 바로 올려요. 제목에는 내 번호와 이름이 자동으로 들어가요. 문장이 맞는지 확인하고 눌러 주세요.'),
        h('div', { class: 'actions' }, go, postedAt && !S.posterOn ? roomLink : null), pmsg));
      if (postedAt) kids.push(nextStep(item, roomLink));
    } else if (roomLink) {
      kids.push(h('div', { class: 'actions' }, roomLink, h('span', { class: 'muted small' }, '복사한 글을 내 방에 붙여 넣고 포스터를 올려 주세요.')));
    }
    box.replaceChildren(...kids);
  }

  // 올린 뒤 이어지는 안내: 포스터 프롬프트 만들기 -> 복사 -> 내 방으로
  function nextStep(item, roomLink) {
    if (!S.posterOn) return h('div', { class: 'notice ok' }, '다 올렸어요. 포스터 그림은 내 패들렛 방에서 이어서 올려 주세요.');
    return h('div', { class: 'notice ok', style: 'margin-top:12px' },
      h('strong', null, '다음 단계: '), '이 문장으로 포스터 프롬프트를 만들어요. 만든 프롬프트를 복사한 뒤 내 패들렛 방으로 가서 그림을 올려요.',
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'button', onclick: () => {
        const F = S.pstate.form; F.sentence = item.sentence; F.topic = item.topic || F.topic; S.pstate.out = null;
        S.showPadlet = false; S.showPoster = true; save(); render();
        const el = document.getElementById('posterbox'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } }, '포스터 프롬프트 만들기 →')));
  }

  function padletCard() {
    const box = h('section', { class: 'card', id: 'padletbox' });
    drawPadlet(box);
    return box;
  }


  // ---------- 성공 뒤 단계별 미션 안내 ----------
  // 한 번에 한 단계만 크게 보여 주고, 끝낸 단계는 ✓로 표시한다. 순서: 패들렛 올리기 → 프롬프트 만들기 → 복사 → 패들렛 방에서 포스터 올리기 → 친구들 포스터 보기
  function missionCard() {
    const sents = eligibleSentences();
    if (!sents.length) return null;
    if (!S.mission) S.mission = { itemId: '', copied: false, opened: false, others: false, view: '', pick: -1 };
    const M = S.mission, PS = S.pstate;
    // 모둠 활동에서는 모둠 목록에서 고른 문장 하나의 미션만 보여 준다
    const item = S.group ? sents.find((x) => x.slot === M.pick) : sents[0];
    if (!item) return null;
    if (M.itemId !== item.id) {
      Object.assign(M, { itemId: item.id, copied: false, opened: false, others: false, view: '', skipPost: false });
      PS.out = null; PS.done = false;
      const F = PS.form; F.sentence = item.sentence; F.topic = item.topic || F.topic; save();
    }
    const postedAt = ((S.last && S.last.id === item.id && S.last.padletAt) || (S.history.find((x) => x.id === item.id) || {}).padletAt || 0);
    const hasAll = !!(S.padlet && S.padlet.all);
    const steps = [];
    if (S.padlet.post) steps.push({ id: 'post', title: S.group ? '모둠 패들렛 방에 광고문구 올리기' : '내 패들렛에 광고문구 올리기', done: !!postedAt || !!(S.group && !S.group.isLeader && M.skipPost) });
    if (S.posterOn) {
      steps.push({ id: 'make', title: '포스터 프롬프트 만들기', done: !!PS.out });
      steps.push({ id: 'copy', title: '프롬프트 복사하기', done: !!M.copied });
    }
    steps.push({ id: 'room', title: S.posterOn ? '패들렛 방에서 포스터 만들어 올리기' : '내 패들렛 방으로 가기', done: !!PS.done });
    if (hasAll) steps.push({ id: 'others', title: '다른 친구들 포스터 보기', done: !!M.others });
    const firstTodo = steps.find((x) => !x.done);
    const openId = (M.view && steps.some((x) => x.id === M.view)) ? M.view : (firstTodo ? firstTodo.id : '');
    const doneN = steps.filter((x) => x.done).length;

    const card = h('section', { class: 'card mission', id: 'mission' });
    const redraw = () => { const n = missionCard(); if (n) card.replaceWith(n); };
    const go = (id) => { M.view = id; save(); redraw(); const el = document.getElementById('mission'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); };
    const next = () => { M.view = ''; save(); redraw(); const el = document.getElementById('mission'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); };

    const body = (id) => {
      if (id === 'post' && S.group && !S.group.isLeader) {
        return [h('p', { class: 'mhelp' }, `내 패들렛 방에는 모둠장(${(S.group.leader && S.group.leader.name) || ''})이 글을 올려요. 아래 문장을 확인하고 다음 단계로 가세요.`), h('div', { class: 'msent' }, item.sentence), h('div', { class: 'actions' }, h('button', { class: 'btn primary big', type: 'button', onclick: () => { M.skipPost = true; next(); } }, '다음 단계로 →'))];
      }
      if (id === 'post') {
        const msg = h('div', { class: 'notice', role: 'status', hidden: true });
        const btn = h('button', { class: 'btn primary big', type: 'button' }, postedAt ? '다시 올리기' : '패들렛에 올리기');
        btn.addEventListener('click', async () => {
          if (postedAt && !confirm('이미 올린 글이에요. 한 번 더 올리면 같은 글이 하나 더 생겨요. 올릴까요?')) return;
          btn.disabled = true; msg.hidden = false; msg.className = 'notice'; msg.textContent = '올리는 중…';
          try {
            const o = await api('/api/padlet/post', { id: item.id, again: !!postedAt });
            if (S.last && S.last.id === item.id) S.last.padletAt = o.at || Date.now();
            const h0 = S.history.find((x) => x.id === item.id); if (h0) h0.padletAt = o.at || Date.now();
            if (S.group) { const sl = S.group.slots.find((x) => x.i === item.slot); if (sl) sl.padletAt = o.at || Date.now(); }
            next();
          } catch (e) { msg.className = 'notice bad'; msg.textContent = e.message; btn.disabled = false; }
        });
        return [h('p', { class: 'mhelp' }, '내가 만든 문장을 내 패들렛 방에 글로 올려요. 제목에는 내 번호와 이름이 자동으로 들어가요.'),
          h('div', { class: 'msent' }, item.sentence), postedAt ? h('div', { class: 'notice ok' }, '이미 올렸어요. 다음 단계로 가세요.') : null,
          h('div', { class: 'actions' }, btn, postedAt ? h('button', { class: 'btn big', type: 'button', onclick: next }, '다음 단계로 →') : null), msg];
      }
      if (id === 'make') {
        const box = h('div', { class: 'pbox' });
        box._formOnly = true;
        box._redraw = () => { if (box._made && PS.out) { M.copied = false; M.view = ''; save(); redraw(); const el = document.getElementById('mission'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } else drawPoster(box); };
        drawPoster(box);
        return [h('p', { class: 'mhelp' }, '이미지를 만들어 주는 AI에게 줄 "그림 주문서(프롬프트)"를 만들어요. 내 문장은 포스터에 그대로 들어가요.'), box];
      }
      if (id === 'copy') {
        if (!PS.out) return [h('div', { class: 'notice warn' }, '먼저 앞 단계에서 프롬프트를 만들어 주세요.'), h('div', { class: 'actions' }, h('button', { class: 'btn primary big', type: 'button', onclick: () => go('make') }, '← 프롬프트 만들러 가기'))];
        const lang = PS.lang === 'en' ? 'en' : 'ko';
        const ta = h('textarea', { rows: '6', readonly: true, 'aria-label': '만들어진 프롬프트', style: 'font-size:.95rem;line-height:1.55' });
        ta.value = PS.out[lang];
        const tabBtn = (code, name) => h('button', { type: 'button', class: 'chip' + (lang === code ? ' on' : ''), 'aria-pressed': String(lang === code), onclick: () => { PS.lang = code; save(); redraw(); } }, name);
        const msg = h('div', { class: 'notice', role: 'status', hidden: true });
        const btn = h('button', { class: 'btn primary big', type: 'button' }, '프롬프트 복사하기');
        btn.addEventListener('click', async () => {
          const ok = await copyText(ta.value, ta);
          msg.hidden = false;
          if (ok) { M.copied = true; save(); msg.className = 'notice ok'; msg.textContent = '복사했어요! 이제 다음 단계로 가세요.'; btn.textContent = '다시 복사하기'; btn.classList.remove('primary'); nextBtn.classList.add('primary'); nextBtn.hidden = false; }
          else { msg.className = 'notice bad'; msg.textContent = '복사가 안 돼요. 위 글을 길게 눌러 직접 복사해 주세요.'; nextBtn.hidden = false; }
        });
        const nextBtn = h('button', { class: 'btn big', type: 'button', hidden: !M.copied, onclick: next }, '다음 단계로 →');
        return [h('p', { class: 'mhelp' }, '아래 [프롬프트 복사하기]를 누르면 위 글이 통째로 복사돼요. 패들렛에서 붙여 넣을 거예요.'),
          h('div', { class: 'chips', style: 'margin:6px 0' }, tabBtn('ko', '한국어'), tabBtn('en', 'English')), ta,
          h('div', { class: 'actions' }, btn, nextBtn, h('button', { class: 'btn sm', type: 'button', onclick: () => go('make') }, '프롬프트 다시 만들기')), msg];
      }
      if (id === 'room') {
        const link = S.padlet.link ? h('a', { class: 'btn primary big', href: S.padlet.link, target: '_blank', rel: 'noopener', onclick: () => { M.opened = true; save(); } }, S.padlet.board ? '패들렛 보드 열기 →' : '내 패들렛 방 열기 →') : null;
        const guide = [
          ['오른쪽 아래 주황색 ', '[+ 게시]', ' 버튼을 눌러요.'],
          ['초록색으로 보이는 세 번째 버튼 ', '[AI 이미지]', '를 눌러요.'],
          ['"그리려는 내용 입력하기" 칸에 복사한 프롬프트를 붙여 넣고(Ctrl+V) ', '오른쪽 화살표(→)', '를 눌러요.'],
          ['만들어진 그림 중 마음에 드는 포스터를 골라 ', '올려요.', ''],
        ];
        const needCopy = S.posterOn && !M.copied && PS.out;
        const reCopy = needCopy ? h('div', { class: 'notice warn' }, '프롬프트를 아직 복사하지 않았어요. ', h('button', { class: 'btn sm', type: 'button', onclick: async () => { const ok = await copyText(PS.out[PS.lang === 'en' ? 'en' : 'ko'], document.createElement('textarea')); if (ok) { M.copied = true; save(); redraw(); } } }, '지금 복사하기')) : null;
        const adTa = !S.padlet.post ? (() => {
          const st = S.student;
          return window.Poster.fillTemplate(S.padletTemplate, { '이름': st.name, '학번': st.sid, '반': st.cls, '광고문구': item.sentence, '성분조건': item.comp, '짜임조건': item.struct, '주제': item.topic });
        })() : '';
        const adBtn = !S.padlet.post ? h('div', { class: 'notice' }, '글에 광고문구도 함께 적고 싶다면 ', h('button', { class: 'btn sm', type: 'button', onclick: async (ev) => { const ok = await copyText(adTa, document.createElement('textarea')); ev.target.textContent = ok ? '복사했어요 (본문에 붙여 넣기)' : '복사가 안 돼요'; } }, '광고 글 복사하기'), ' 를 누르고 본문에 붙여 넣으세요. (프롬프트를 붙여 넣은 뒤에 하세요)') : null;
        return [reCopy, link || h('div', { class: 'notice warn' }, '내 패들렛 방 주소가 아직 등록되지 않았어요. 선생님이 안내한 패들렛 방으로 직접 이동해 주세요.'),
          h('ol', { class: 'mguide' }, guide.map((g) => h('li', null, g[0], h('b', null, g[1]), g[2]))), adBtn,
          h('div', { class: 'actions' }, h('button', { class: 'btn big' + (M.opened || !link ? ' primary' : ''), type: 'button', onclick: () => { PS.done = true; save(); next(); } }, '포스터를 올렸어요 ✓'))];
      }
      if (id === 'others') {
        return [h('p', { class: 'mhelp' }, '우리 반 친구들이 올린 포스터를 구경해 보세요.'),
          h('div', { class: 'actions' }, h('a', { class: 'btn primary big', href: S.padlet.all, target: '_blank', rel: 'noopener', onclick: () => { M.others = true; save(); setTimeout(redraw, 0); } }, '다른 친구들 포스터 보러가기 →'))];
      }
      return [];
    };

    const list = h('ol', { class: 'msteps' });
    steps.forEach((st, i) => {
      const open = st.id === openId;
      const head = h('button', { type: 'button', class: 'mhead', 'aria-expanded': String(open), onclick: () => { if (st.id === openId && M.view) { M.view = ''; } else M.view = st.id; save(); redraw(); } },
        h('span', { class: 'mnum' + (st.done ? ' done' : '') }, st.done ? '✓' : String(i + 1)),
        h('span', { class: 'mtitle' }, st.title),
        st.done ? h('span', { class: 'mtag' }, '완료') : (st === firstTodo ? h('span', { class: 'mtag now' }, '지금 할 일') : null));
      list.append(h('li', { class: 'mstep' + (open ? ' open' : '') + (st.done ? ' done' : '') }, head, open ? h('div', { class: 'mbody' }, body(st.id)) : null));
    });
    const finished = !firstTodo;
    card.append(...[h('h2', null, S.group ? `문장 ${item.slot + 1} 포스터 만들어 올리기` : '다음 미션: 포스터 만들어 올리기'),
      S.group ? h('div', { class: 'actions', style: 'margin:-4px 0 6px' }, h('button', { class: 'btn sm', type: 'button', onclick: () => { M.pick = -1; save(); render(); const el = document.getElementById('group'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, '← 모둠 문장 목록으로')) : null,
      h('div', { class: 'mprog', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(steps.length), 'aria-valuenow': String(doneN) },
        h('div', { class: 'mbar', style: `width:${Math.round(doneN / steps.length * 100)}%` })),
      h('p', { class: 'muted small', style: 'margin:6px 0 10px' }, `${doneN} / ${steps.length} 단계 완료 · 위에서부터 차례대로 하나씩 하면 돼요`),
      ...(finished ? [h('div', { class: 'notice ok' }, h('b', null, '모든 단계를 마쳤어요! '), S.group ? '수고했어요. 위의 [모둠 문장 목록으로]를 눌러 다른 문장 포스터도 만들어 보세요.' : '수고했어요. 위 단계를 눌러 다시 볼 수도 있어요.')] : []), list].filter(Boolean));
    return card;
  }

  // ---------- 모둠 활동 ----------
  const GSTATUS = { done: ['완성', 'ok'], pending: ['선생님 확인 중', 'warn'], todo: ['아직', 'gray'] };

  async function startSlot(i) {
    if (S.busy) return;
    S.busy = true; render();
    try {
      const c = await api('/api/challenge', { slot: i });
      c.slot = i;
      S.challenge = c; S.attempts = 0; S.last = null; S.draft = ''; S.topicText = ''; S.flagged = false; S.notice = '';
    } catch (e) { S.notice = e.message; }
    S.busy = false; save(); render();
    const el = document.getElementById('conds'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function backToList() {
    S.challenge = null; S.last = null; S.draft = ''; S.topicText = ''; S.flagged = false; S.notice = ''; save(); render();
    const el = document.getElementById('group'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function refreshGroup() {
    try { const r = await api('/api/group'); S.group = r.group; } catch (e) { /* 다음 번에 */ }
  }

  function groupCard() {
    const G = S.group;
    const card = h('section', { class: 'card', id: 'group' });
    card.append(h('h2', null, `${G.no}모둠`),
      h('p', { class: 'muted small', style: 'margin:-4px 0 8px' }, '모둠원: ' + (G.members.map((m) => m.name + (m.leader ? ' ★모둠장' : '') + (m.me ? '(나)' : '')).join(', ') || '나')),
      G.isLeader ? h('div', { class: 'notice ok' }, h('b', null, '내가 모둠장이에요. '), '모둠원과 의논한 뒤 문장을 입력하고 제출하는 사람은 나예요.') : h('div', { class: 'notice' }, h('b', null, '우리 모둠 모둠장: ' + ((G.leader && G.leader.name) || '') + '. '), '문장은 모둠장만 입력해요. 이 화면을 함께 보면서 의견을 나눠 주세요. 문장이 완성되면 여기에 자동으로 나타나요.'),
      h('div', { class: 'mprog', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(G.total), 'aria-valuenow': String(G.done) },
        h('div', { class: 'mbar', style: `width:${G.total ? Math.round(G.done / G.total * 100) : 0}%` })),
      h('p', { class: 'muted small', style: 'margin:6px 0 10px' }, G.total ? `우리 모둠 문장 ${G.done} / ${G.total}개 완성 · 모둠원과 의논해서 한 문장씩 만들어요. 한 사람이 쓰고 제출하면 돼요.` : '선생님이 아직 문장 종류와 개수를 정하지 않았어요. 잠시 기다려 주세요.'));
    const list = h('ol', { class: 'gslots' });
    for (const sl of G.slots) {
      const st = GSTATUS[sl.status] || GSTATUS.todo;
      const cur = S.challenge && S.challenge.slot === sl.i && sl.status === 'todo';
      const c = sl.conds;
      const mine = S.group && S.mission && S.mission.pick === sl.i;
      list.append(h('li', { class: 'gslot ' + sl.status + (cur ? ' cur' : '') },
        h('div', { class: 'ghead' }, h('b', null, `문장 ${sl.i + 1}`), h('span', { class: 'pill ' + st[1] }, st[0]), cur ? h('span', { class: 'pill gray' }, '지금 쓰는 중') : null),
        c ? h('div', { class: 'gconds small' }, h('span', null, c.comp.label), ' · ', h('span', null, c.struct.label), ' · ', h('span', null, '주제: ' + c.topic.label)) : null,
        sl.status === 'todo' && !G.isLeader ? h('div', { class: 'muted small' }, sl.tries ? `모둠이 ${sl.tries}번 도전했어요 · 모둠장이 입력하는 중이에요` : '모둠장이 입력할 차례를 기다려요') : sl.status === 'todo' ? h('div', { class: 'actions' }, h('button', { class: 'btn' + (cur ? '' : ' primary'), type: 'button', disabled: S.busy || cur, onclick: () => startSlot(sl.i) }, cur ? '아래에서 쓰는 중' : (sl.tries ? '이어서 도전하기' : '이 문장 쓰기 →')),
          sl.tries ? h('span', { class: 'muted small' }, `모둠이 ${sl.tries}번 도전했어요`) : null) : h('div', null,
          h('div', { class: 'msent' }, sl.sentence), h('div', { class: 'muted small' }, `제출: ${sl.by}`),
          h('div', { class: 'actions' }, h('button', { class: 'btn' + (mine ? '' : ' primary'), type: 'button', onclick: () => { S.mission.pick = sl.i; save(); render(); const el = document.getElementById('mission'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, mine ? '미션 진행 중 ↓' : '이 문장으로 포스터 만들기 →'),
            sl.status === 'done' && G.isLeader ? h('button', { class: 'btn sm', type: 'button', disabled: S.busy || cur, onclick: () => startSlot(sl.i) }, '다시 써 보기') : null))));
    }
    card.append(list);
    return card;
  }

  function renderGroupPick(top) {
    const G = S.group;
    const msg = h('div', { class: 'notice bad', role: 'alert', hidden: true });
    const grid = h('div', { class: 'gpick' });
    for (let n = 1; n <= G.count; n++) {
      grid.append(h('button', { class: 'btn big', type: 'button', onclick: async (ev) => {
        if (!confirm(`${n}모둠이 맞나요?\n잘못 골랐다면 선생님께 말씀드려서 옮겨야 해요.`)) return;
        grid.querySelectorAll('button').forEach((b) => { b.disabled = true; });
        try { const r = await api('/api/group/join', { no: n }); S.group = r.group; save(); render(); } catch (e) { msg.textContent = e.message; msg.hidden = false; grid.querySelectorAll('button').forEach((b) => { b.disabled = false; }); }
      } }, `${n}모둠`));
    }
    app.replaceChildren(top, h('section', { class: 'card' }, h('h2', null, '우리 모둠을 골라요'),
      h('p', { class: 'muted' }, '선생님이 정해 준 우리 모둠 번호를 눌러 주세요. 한 번 고르면 바꿀 수 없어요.'), grid, msg));
  }

  // 모둠원이 제출한 결과를 모둠 화면에 가볍게 반영한다(입력 중인 칸은 건드리지 않는다)
  let gSig = '';
  async function pollGroup() {
    if (!S.token || !S.group || document.hidden || S.busy) return;
    await refreshGroup();
    if (!S.group) { render(); return; }
    if (S.group.no && !S.group.isLeader && S.challenge) { S.challenge = null; S.last = null; S.draft = ''; save(); gSig = ''; render(); }
    const sig = JSON.stringify([S.group.no, S.group.isLeader, S.group.members, S.group.slots.map((x) => [x.status, x.sentence, x.padletAt, x.tries])]);
    if (sig === gSig) return;
    gSig = sig;
    const el = document.getElementById('group');
    if (el && S.group.no) el.replaceWith(groupCard()); else if (!S.group.no || !el) { const t = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName); if (!t) render(); }
  }
  setInterval(pollGroup, 5000);

  // ---------- 메인 화면 ----------
  function condRow(kind, c, cls) {
    return h('div', { class: 'cond ' + (cls || '') },
      h('div', { class: 'kind' }, kind),
      h('div', null,
        h('div', { class: 'name' }, c.label),
        c.short ? h('div', { class: 'how' }, c.short) : null,
        c.example ? h('details', null, h('summary', null, '보기'), h('div', { class: 'ex' }, c.example)) : null));
  }

  // 주제 줄: 선생님이 허용하면 기존 주제 목록에서 다른 주제를 고를 수 있다(직접 입력은 없다).
  function topicRow(c) {
    const base = c.conditions.topic;
    if (!c.topicChoice || S.last) return condRow('공익광고 주제', S.topicText ? { label: S.topicText } : base, 'topic');
    const nameEl = h('div', { class: 'name' }, S.topicText || base.label);
    const tag = h('span', { class: 'pill gray', style: 'margin-left:8px' }, '내가 고른 주제');
    const sync = () => { nameEl.textContent = S.topicText || base.label; tag.style.display = S.topicText ? '' : 'none'; };
    const sel = h('select', { id: 'tsel', 'aria-label': '다른 주제 고르기' }, h('option', { value: '' }, `처음 주제: ${base.label}`));
    for (const t of c.topicList || []) if (t !== base.label) sel.append(h('option', { value: t }, t));
    sel.value = S.topicText && (c.topicList || []).includes(S.topicText) ? S.topicText : '';
    sel.addEventListener('change', () => { S.topicText = sel.value; sync(); save(); });
    sync();
    return h('div', { class: 'cond topic' },
      h('div', { class: 'kind' }, '공익광고 주제'),
      h('div', null, h('div', { style: 'display:flex;align-items:center;flex-wrap:wrap' }, nameEl, tag),
        h('details', { open: S.topicText ? '' : null },
          h('summary', null, '다른 주제로 바꾸기'),
          h('div', { class: 'ex', style: 'display:grid;gap:6px;margin-top:6px' }, sel,
            h('div', { class: 'muted small' }, '주제는 AI가 채점하지 않고 선생님이 확인해요.')))));
  }

  function sentenceView(text, wheres) {
    const ranges = [];
    for (const w of wheres) {
      if (!w) continue;
      const i = text.indexOf(w);
      if (i >= 0) ranges.push([i, i + w.length]);
    }
    ranges.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const r of ranges) {
      const last = merged[merged.length - 1];
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else merged.push(r.slice());
    }
    const box = h('div', { class: 'sentence' });
    let pos = 0;
    for (const [a, b] of merged) {
      if (a > pos) box.append(text.slice(pos, a));
      box.append(h('mark', null, text.slice(a, b)));
      pos = b;
    }
    if (pos < text.length) box.append(text.slice(pos));
    return box;
  }

  const CHECK_NAMES = {
    component: '문장 성분 조건', structure: '문장의 짜임 조건', wellformed: '완결된 한 문장',
  };

  const TOPIC_MARK = {
    ok: ['적절', 'ok', '주제와 잘 어울리는 문장이에요.'],
    no: ['다시 생각해 보기', 'warn', '주제와 내용이 잘 이어지는지 선생님 피드백을 읽고 다시 생각해 보세요.'],
  };

  // 공익광고 주제는 AI가 아니라 선생님이 판단한다. 선생님이 남긴 판단과 피드백을 보여 준다.
  function teacherBits(r) {
    const box = [];
    const m = TOPIC_MARK[r.topicJudge];
    if (m) {
      box.push(h('li', { class: 'check ' + (r.topicJudge === 'ok' ? 'ok' : 'no') },
        h('div', { class: 'tag' }, m[0]),
        h('div', null, h('div', { class: 't' }, '공익광고 주제 (선생님 확인)'), h('div', { class: 'r' }, m[2]))));
    } else if (r.verdict === 'correct') {
      box.push(h('li', { class: 'check wait' },
        h('div', { class: 'tag' }, '확인 중'),
        h('div', null, h('div', { class: 't' }, '공익광고 주제'), h('div', { class: 'r' }, '주제와 어울리는지는 선생님이 직접 확인해 줄 거예요.'))));
    }
    const out = [];
    if (box.length) out.push(h('ul', { class: 'checks' }, box));
    if (r.tfeedback) out.push(h('div', { class: 'block tfb' }, h('div', { class: 'ttl' }, '선생님 피드백'), h('div', { style: 'white-space:pre-wrap' }, r.tfeedback)));
    return out;
  }

  function resultCard() {
    const r = S.last;
    if (S.busy) {
      return h('section', { class: 'card result' }, h('p', null, h('span', { class: 'spinner' }), ' 문장을 살펴보고 있어요. 잠시만 기다려 주세요.'));
    }
    if (!r) return null;
    const cls = r.verdict === 'correct' ? 'correct' : r.verdict === 'incorrect' ? 'incorrect' : 'pending';
    const manualWait = !!r.manual && r.verdict === 'pending';
    const title = manualWait ? '제출했어요!' : r.verdict === 'correct' ? '문법 조건을 모두 만족했어요!' : r.verdict === 'incorrect' ? '조금만 더 고쳐 볼까요?' : '선생님이 확인해 줄게요';
    const sub = r.verdict === 'correct'
      ? (r.attempt === 1 ? '한 번에 성공했어요.' : `${r.attempt}번째 도전에 성공했어요.`)
      : r.verdict === 'incorrect' ? (r.manual ? `선생님 피드백을 읽고 다시 써서 제출해 보세요. (${r.attempt}번째 도전)` : `고칠 부분을 확인하고 다시 제출해 보세요. (${r.attempt}번째 도전)`) : r.message;
    const wheres = r.checks ? Object.values(r.checks).filter((c) => !c.ok).map((c) => c.where) : [];
    const card = h('section', { class: 'card result ' + cls, tabindex: '-1', id: 'result' },
      h('div', { class: 'verdict-row' }, h('div', { class: 'verdict' }, title),
        h('span', { class: 'stampbox sm ' + (r.verdict === 'correct' ? 'free' : r.verdict === 'incorrect' ? 'bad' : 'warn') }, r.verdict === 'correct' ? '합격' : r.verdict === 'incorrect' ? '불합격' : '스승님 심사 중')),
      h('div', { class: 'sub' }, sub),
      sentenceView(r.sentence || '', wheres));

    if (r.checks) {
      const list = h('ul', { class: 'checks' });
      for (const k of ['component', 'structure', 'wellformed']) {
        const c = r.checks[k];
        if (!c) continue;
        const row = h('li', { class: 'check ' + (c.ok ? 'ok' : 'no') },
          h('div', { class: 'tag' }, c.ok ? '충족' : '고치기'),
          h('div', null,
            h('div', { class: 't' }, CHECK_NAMES[k]),
            h('div', { class: 'r' }, c.reason),
            !c.ok && (c.where || c.fix) ? h('div', { class: 'fixrow' },
              c.where ? h('div', null, h('b', null, '고칠 부분 '), h('q', null, c.where)) : null,
              c.fix ? h('div', null, h('b', null, '고치는 방향 '), c.fix) : null) : null));
        list.append(row);
      }
      card.append(list);
    }
    card.append(h('div', { id: 'tbits' }, teacherBits(r)));
    if (r.tip) card.append(h('div', { class: 'block' }, h('div', { class: 'ttl' }, '참고'), r.tip));
    if (r.analysis) card.append(h('details', { class: 'block' }, h('summary', null, '내 문장 분석 보기'), h('pre', null, r.analysis)));
    if (r.example) card.append(h('div', { class: 'block' }, h('div', { class: 'ttl' }, r.verdict === 'correct' ? '이런 문장도 가능해요' : '예시 문장'), h('span', { style: 'font-family:var(--serif)' }, r.example)));

    const canNext = S.group ? true : (r.verdict === 'correct' || r.verdict === 'pending' || r.attempt >= 3);
    const actions = h('div', { class: 'actions' });
    if (r.verdict === 'incorrect') actions.append(h('button', { class: 'btn primary', type: 'button', onclick: () => document.getElementById('pad').focus() }, '고쳐서 다시 쓰기'));
    if (S.group) actions.append(h('button', { class: 'btn' + (r.verdict === 'correct' ? ' primary' : ''), type: 'button', onclick: backToList }, '모둠 문장 목록으로'));
    else actions.append(h('button', { class: 'btn' + (r.verdict === 'correct' ? ' primary' : ''), type: 'button', disabled: !canNext, onclick: () => newChallenge(true) }, '새 조건 받기'));
    if (r.verdict !== 'pending' && !r.manual) {
      actions.append(S.flagged
        ? h('span', { class: 'muted small', style: 'align-self:center' }, '선생님께 전달했어요.')
        : h('button', { class: 'btn', type: 'button', onclick: flag }, '판정이 이상해요 (선생님께 알리기)'));
    }
    card.append(actions);
    if (!canNext && !S.group) card.append(h('p', { class: 'muted small', style: 'margin-top:8px' }, '3번 도전하거나 문법 조건을 맞히면 새 조건을 받을 수 있어요.'));
    return card;
  }

  async function flag() {
    if (!S.last || !S.last.id) return;
    try { await api('/api/flag', { id: S.last.id, note: '' }); S.flagged = true; save(); render(); } catch (e) { S.notice = e.message; render(); }
  }

  async function submit() {
    const text = S.draft.trim();
    if (!text || S.busy) return;
    S.busy = true; S.notice = ''; sentText = text; render();
    try {
      const r = await api('/api/submit', { token: S.challenge.token, sentence: text, topicText: S.topicText });
      r.sentence = text; r.topic = r.topic || S.topicText;
      S.last = r; S.attempts = r.attempt; S.flagged = false;
      S.stats.tries += 1;
      if (r.verdict === 'correct') S.stats.correct += 1;
      if (S.group) {
        await refreshGroup();
        if (r.verdict !== 'incorrect' && S.challenge && S.challenge.slot !== undefined) { S.mission.pick = S.challenge.slot; }
      }
    } catch (e) {
      S.notice = e.message;
      if (e.status === 410) { S.busy = false; if (S.group) { S.challenge = null; await refreshGroup(); } else await newChallenge(false); }
    }
    S.busy = false; save(); render();
    const el = document.getElementById('result');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function togglePadlet() {
    S.showPadlet = !S.showPadlet;
    if (S.showPadlet) { try { const me = await api('/api/me'); S.history = me.history; S.stats = me.stats; S.padletTemplate = me.padletTemplate || ''; S.padlet = me.padlet || { post: false, link: '' }; } catch (e) { /* 무시 */ } }
    render();
  }

  async function togglePoster() {
    S.showPoster = !S.showPoster;
    if (S.showPoster) { try { const me = await api('/api/me'); S.history = me.history; S.stats = me.stats; S.posterOn = !!me.poster; S.padlet = me.padlet || S.padlet; } catch (e) { /* 무시 */ } }
    save(); render();
  }

  async function toggleHist() {
    S.showHist = !S.showHist;
    if (S.showHist) { try { const me = await api('/api/me'); S.history = me.history; S.stats = me.stats; } catch (e) { /* 무시 */ } }
    render();
  }

  const VERDICT = { correct: ['문법 정답', 'ok'], incorrect: ['오답', 'bad'], pending: ['확인 중', 'warn'] };
  function histCard() {
    const list = h('div', { class: 'hist' });
    if (!S.history.length) list.append(h('p', { class: 'muted' }, '아직 제출한 문장이 없어요.'));
    for (const it of S.history) {
      const v = VERDICT[it.verdict] || ['', 'gray'];
      list.append(h('div', { class: 'it' },
        h('div', { class: 'meta' }, h('span', { class: 'pill ' + v[1] }, v[0]),
          new Date(it.ts).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
          it.comp + ' · ' + it.struct + ' · ' + it.topic),
        h('div', { class: 's' }, it.sentence),
        TOPIC_MARK[it.topicJudge] ? h('div', { class: 'meta' }, h('span', { class: 'pill ' + TOPIC_MARK[it.topicJudge][1] }, '주제 ' + TOPIC_MARK[it.topicJudge][0])) : (it.verdict === 'correct' ? h('div', { class: 'meta' }, h('span', { class: 'pill gray' }, '주제 확인 중')) : null),
        it.tfeedback ? h('div', { class: 'block tfb' }, h('div', { class: 'ttl' }, '선생님 피드백'), h('div', { style: 'white-space:pre-wrap' }, it.tfeedback)) : null));
    }
    const rate = S.stats.tries ? Math.round((S.stats.correct / S.stats.tries) * 100) : 0;
    return h('section', { class: 'card' },
      h('h2', null, '내 기록'),
      h('p', { class: 'muted', style: 'margin-bottom:10px' }, `지금까지 ${S.stats.tries}번 제출했고 문법 조건을 ${S.stats.correct}번 맞혔어요. (정답률 ${rate}%)`),
      list);
  }

  function renderMain() {
    const c = S.challenge;
    const pad = h('textarea', { id: 'pad', class: 'pad', rows: '4', maxlength: '200', 'aria-label': '내 문장', placeholder: '세 조건을 모두 만족하는 문장을 한 문장으로 써 보세요.' });
    pad.value = S.draft;
    const count = h('span', { class: 'muted small' }, `${S.draft.length} / 200자`);
    const btn = h('button', { class: 'btn primary', type: 'button', disabled: S.busy || !S.draft.trim(), onclick: submit }, S.busy ? '살펴보는 중…' : '제출하기');
    pad.addEventListener('input', () => {
      S.draft = pad.value; save();
      count.textContent = `${S.draft.length} / 200자`;
      if (!S.draft.trim()) pingTyping(false);
      btn.disabled = S.busy || !S.draft.trim();
    });
    pad.addEventListener('keydown', (ev) => { if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') { ev.preventDefault(); submit(); } });

    const st = S.student;
    const top = h('div', { class: 'top' },
      h('div', { class: 'brand' }, h('span', { class: 'stampbox sm' }, '제2막'), '문장 연습실', h('small', null, `문법광인의 서재 · 누적 ${S.stats.correct}/${S.stats.tries}`)),
      h('div', { class: 'chip' }, `${st.cls} ${st.name}`, h('button', { class: 'btn sm', type: 'button', onclick: () => { if (S.demo) { logout(false); location.href = 'observer.html'; } else logout(false); } }, S.demo ? '참관 화면으로' : '나가기')));

    if (S.group && !S.group.no) return renderGroupPick(top);
    const nodes = [top];
    if (S.demo) nodes.push(h('div', { class: 'notice ok', role: 'note' }, h('b', null, '참관 체험 중이에요. '), '여기서 제출한 문장과 기록은 저장되지 않고, 실제 수업(교사 화면·현황판·패들렛)에는 아무 영향이 없어요.'));
    const fbCount = S.history.filter((x) => x.tfeedback).length;
    nodes.push(h('div', { class: 'actions', style: 'margin-top:0' }, h('button', { class: 'btn', type: 'button', onclick: toggleHist }, S.showHist ? '내 기록 닫기' : '내 기록 보기' + (fbCount ? ` (선생님 피드백 ${fbCount})` : ''))));
    if (S.showHist) nodes.push(histCard());
    if (S.notice) nodes.push(h('div', { class: 'notice bad', role: 'alert' }, S.notice));
    if (S.group) nodes.push(groupCard());
    if (c) {
      nodes.push(h('section', { class: 'card', id: 'conds' },
        h('h2', null, S.group ? `문장 ${c.slot + 1}의 제작 조건 (모둠 공통)` : '이번 제작 조건'),
        h('div', { class: 'conds' },
          condRow('문장 성분', c.conditions.comp),
          condRow('문장의 짜임', c.conditions.struct),
          topicRow(c)),
        h('p', { class: 'muted small', style: 'margin-top:12px' }, '세 조건을 모두 만족하는 문장 한 개를 써서 제출하세요.'), h('p', { class: 'sig', style: 'text-align:right;margin-top:6px' }, '- A.N. -')));
      nodes.push(h('section', { class: 'card' },
        h('h2', null, '내 문장'), pad,
        h('div', { class: 'compose-foot' }, count, btn)));
    } else if (S.group) {
      // 모둠 목록에서 문장을 고르면 조건과 입력 칸이 나타난다
    } else {
      nodes.push(h('section', { class: 'card' }, h('p', null, '조건을 받지 못했어요.'),
        h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'button', onclick: () => newChallenge(true) }, '조건 받기'))));
    }
    const rc = resultCard();
    if (rc) nodes.push(rc);
    const mc = S.busy ? null : missionCard();
    if (mc) nodes.push(mc);
    app.replaceChildren(...nodes);
  }

  function render() {
    if (!S.token || !S.student) return renderLogin();
    document.body.classList.remove('is-gate'); app.classList.remove('gatewrap');
    renderMain();
  }

  // 선생님이 남긴 주제 판단·피드백을 입력 중인 화면을 건드리지 않고 가져온다.
  async function pollTeacher() {
    if (!S.token || document.hidden || S.busy) return;
    try {
      const me = await api('/api/me');
      if (!!me.group !== !!S.group && !(document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName))) { await enter(); return; }   // 선생님이 개인/모둠 활동을 바꾼 경우
      const prevCount = S.history.filter((x) => x.tfeedback).length;
      S.history = me.history; S.stats = me.stats; S.padletTemplate = me.padletTemplate || ''; S.padlet = me.padlet || { post: false, link: '' };
      // 선생님이 '주제 바꾸기'를 켜거나 끄면 이미 받은 조건 화면에도 바로 반영한다(켠 경우에는 주제 목록도 함께 받는다)
      if (S.challenge && me.topicChoice === false && S.challenge.topicChoice) {
        S.challenge.topicChoice = false; S.topicText = ''; save();
        const typing1 = document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName); if (!typing1) render();
      } else if (S.challenge && me.topicChoice === true && Array.isArray(me.topicList) && me.topicList.length && !S.challenge.topicChoice) {
        S.challenge.topicChoice = true; S.challenge.topicList = me.topicList; save();
        const typing1 = document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName); if (!typing1) render();
      }
      if (!!me.poster !== S.posterOn) { S.posterOn = !!me.poster; if (!S.posterOn) S.showPoster = false; const typing0 = document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName); if (!typing0) render(); }
      if (S.last && S.last.id) {
        const it = me.history.find((x) => x.id === S.last.id);
        if (it && S.last.manual && it.verdict !== S.last.verdict) {
          // 선생님이 직접 판정하는 방식: 선생님이 판정하면 결과 카드를 바꾼다.
          S.last.verdict = it.verdict; S.last.topicJudge = it.topicJudge; S.last.tfeedback = it.tfeedback;
          save();
          const typing = document.activeElement && document.activeElement.id === 'pad';
          if (!typing) render();
        } else if (it && (it.topicJudge !== (S.last.topicJudge || '') || it.tfeedback !== (S.last.tfeedback || ''))) {
          S.last.topicJudge = it.topicJudge; S.last.tfeedback = it.tfeedback;
          const el = document.getElementById('tbits');
          if (el) el.replaceChildren(...teacherBits(S.last));
          save();
        }
      }
      if (S.history.filter((x) => x.tfeedback).length !== prevCount) {
        const typing = document.activeElement && document.activeElement.id === 'pad';
        if (!typing) render();
      }
    } catch (e) { /* 다음 번에 다시 시도 */ }
  }
  setInterval(pollTeacher, 15000);

  // 선생님 현황판의 '입력 중' 표시용 신호: 글자 수만 보낸다(내용은 보내지 않는다).
  let sentN = 0, sentAt = 0;
  async function pingTyping(force) {
    if (!S.token || !S.challenge || S.busy || document.hidden) return;
    const n = S.draft.trim() === sentText ? 0 : S.draft.trim().length;  // 제출한 글을 그대로 둔 채로는 '입력 중'이 아니다
    const now = Date.now();
    if (!force && n === sentN && (n === 0 || now - sentAt < 6000)) return;
    if (!force && n === 0 && sentN === 0) return;
    sentN = n; sentAt = now;
    try { await api('/api/typing', { n }); } catch (e) { /* 다음 번에 다시 */ }
  }
  setInterval(() => pingTyping(false), 5000);
  document.addEventListener('input', (ev) => { if (ev.target && ev.target.id === 'pad' && sentN === 0) pingTyping(true); });

  load();
  if (S.last && S.last.sentence) sentText = String(S.last.sentence).trim();
  if (S.token) enter(); else render();
})();
