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
    posterOn: false, showPoster: false, showPadlet: false, padPick: '', padletTemplate: '', padlet: { post: false, link: '' }, pstate: { form: window.Poster.defaults(), out: null, lang: 'ko' },
  };

  function save() {
    try {
      sessionStorage.setItem(KEY, JSON.stringify({
        token: S.token, student: S.student, challenge: S.challenge, attempts: S.attempts,
        last: S.last, draft: S.draft, topicText: S.topicText, flagged: S.flagged, pstate: S.pstate, showPoster: S.showPoster,
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
    Object.assign(S, { topicText: '', token: '', student: null, challenge: null, attempts: 0, last: null, draft: '', flagged: false, showHist: false, history: [], showPoster: false, pstate: { form: window.Poster.defaults(), out: null, lang: 'ko' } });
    S.notice = expired ? '다시 입장해 주세요.' : '';
    render();
  }

  async function api(path, body) {
    const opt = { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json' } };
    if (S.token) opt.headers.Authorization = 'Bearer ' + S.token;
    if (body !== undefined) opt.body = JSON.stringify(body);
    let res;
    try { res = await fetch((window.ML_API || '') + path, opt); } catch (e) { throw new Error('서버에 연결할 수 없어요. 와이파이 연결을 확인해 주세요.'); }
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
      S.student = me.student; S.stats = me.stats; S.history = me.history; S.posterOn = !!me.poster; S.padletTemplate = me.padletTemplate || ''; S.padlet = me.padlet || { post: false, link: '' };
    } catch (e) { render(); return; }
    if (!S.challenge) await newChallenge(false);
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

  function posterSentences() {
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
    const PS = S.pstate;
    const F = PS.form;
    const sents = posterSentences();
    const kids = [h('h2', null, '공익광고 포스터 프롬프트 만들기'),
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
    sel.addEventListener('change', () => { const x = sents[parseInt(sel.value, 10)]; F.sentence = x.sentence; F.topic = x.topic; PS.out = null; save(); drawPoster(box); });
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
          save(); drawPoster(box);
        } }, name));
      }
      return h('div', { class: 'field' }, h('span', null, o.label), wrap, extra || null);
    };
    const colorCustom = h('input', { type: 'text', maxlength: '40', placeholder: '직접 쓰기 (예: 연한 하늘색과 흰색)' });
    colorCustom.value = F.colorCustom || '';
    colorCustom.addEventListener('input', () => { F.colorCustom = colorCustom.value; save(); });
    colorCustom.addEventListener('change', () => drawPoster(box));

    kids.push(h('div', { class: 'wrap pform', style: 'max-width:none' },
      h('label', { class: 'field', for: 'pp-sent' }, '어떤 문장으로 만들까요?', sel),
      text('topic', '공익광고 주제 (바꿀 수 있어요)', '예: 플라스틱 사용 줄이기'),
      chips('textMode'),
      F.textMode === 'none' ? h('p', { class: 'muted small' }, '문장은 [핵심 메시지]로만 전달되고, 포스터에는 글자가 들어가지 않아요. 문구는 그림을 만든 뒤 직접 얹을 수 있어요.')
        : [text('sentence', '포스터에 넣을 문장 (고칠 수 있어요)', '', 2), chips('font'), chips('textPos'),
          h('p', { class: 'muted small' }, '참고: 이미지 AI는 한글 글씨를 틀리게 그릴 때가 있어요. 글자가 깨지면 \'글자 없이 그림만\'으로 만든 뒤 직접 문구를 넣어 보세요.')],
      chips('format'), chips('style'), chips('mood'), chips('color', colorCustom), chips('composition'), chips('audience'),
      text('subject', '누가·무엇이 나오나요?', '예: 교복을 입은 학생들, 북극곰, 페트병'),
      text('scene', '어디에서 어떤 장면인가요?', '예: 쓰레기가 가득한 바다, 깨끗한 학교 운동장'),
      text('extra', '더 원하는 것 (세부 요청)', '예: 밝은 햇빛, 큰 글씨, 아이콘 몇 개 넣기', 2),
      text('avoid', '넣지 않았으면 하는 것', '예: 어두운 배경, 너무 많은 글자')));

    const make = h('button', { class: 'btn primary', type: 'button', onclick: async () => {
      F.colorCustom = (F.colorCustom || '').trim();
      PS.out = { ko: P.build(F, 'ko'), en: P.build(F, 'en') };
      PS.lang = PS.lang || 'ko';
      save(); drawPoster(box);
      const o = document.getElementById('pp-out'); if (o) o.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      try { await api('/api/poster', { prompt: PS.out.ko, promptEn: PS.out.en, topic: F.topic, sentence: F.sentence, opts: F }); } catch (e) { /* 저장하지 못해도 프롬프트는 쓸 수 있다 */ }
    } }, '프롬프트 만들기');
    kids.push(h('div', { class: 'actions' }, make,
      h('button', { class: 'btn', type: 'button', onclick: () => { Object.assign(F, P.defaults(), { topic: F.topic, sentence: F.sentence }); PS.out = null; save(); drawPoster(box); } }, '선택 처음으로')));

    if (PS.out) {
      const lang = PS.lang === 'en' ? 'en' : 'ko';
      const ta = h('textarea', { id: 'pp-ta', rows: '14', readonly: true, 'aria-label': '만들어진 프롬프트', style: 'font-size:.95rem;line-height:1.55' });
      ta.value = PS.out[lang];
      const tabBtn = (code, name) => h('button', { type: 'button', class: 'chip' + (lang === code ? ' on' : ''), 'aria-pressed': String(lang === code), onclick: () => { PS.lang = code; save(); drawPoster(box); } }, name);
      const msg = h('span', { class: 'muted small', role: 'status' });
      const room = S.padlet && S.padlet.link ? h('a', { id: 'pp-room', class: 'btn', href: S.padlet.link, target: '_blank', rel: 'noopener' }, '내 패들렛 방 열기 →') : null;
      kids.push(h('div', { id: 'pp-out', class: 'block', style: 'margin-top:14px' },
        h('div', { class: 'ttl' }, '완성된 프롬프트'),
        h('div', { class: 'chips', style: 'margin:6px 0' }, tabBtn('ko', '한국어'), tabBtn('en', 'English')),
        ta,
        h('div', { class: 'actions' },
          h('button', { class: 'btn primary', type: 'button', onclick: async () => { const ok = await copyText(ta.value, ta); msg.textContent = ok ? (room ? '복사했어요! 이미지 AI에서 그림을 만든 뒤, 내 패들렛 방에 올려요.' : '복사했어요! 이미지 AI에 붙여 넣으세요.') : '복사가 안 돼요. 글 위를 길게 눌러 직접 복사해 주세요.'; if (ok && room) room.classList.add('primary'); } }, '복사하기'), room, msg),
        h('p', { class: 'muted small' }, '복사한 글을 선생님이 안내한 이미지 만들기 도구에 붙여 넣어 보세요. 마음에 안 들면 위의 선택을 바꾸고 [프롬프트 만들기]를 다시 눌러요.')));
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
    const postedAt = ((S.last && S.last.id === item.id && S.last.padletAt) || (S.history.find((x) => x.id === item.id) || {}).padletAt || 0);
    const roomLink = S.padlet.link ? h('a', { class: 'btn' + (S.padlet.post ? '' : ' primary'), href: S.padlet.link, target: '_blank', rel: 'noopener' }, '내 패들렛 방 열기') : null;
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

    const canNext = r.verdict === 'correct' || r.verdict === 'pending' || r.attempt >= 3;
    const actions = h('div', { class: 'actions' });
    if (r.verdict === 'incorrect') actions.append(h('button', { class: 'btn primary', type: 'button', onclick: () => document.getElementById('pad').focus() }, '고쳐서 다시 쓰기'));
    actions.append(h('button', { class: 'btn' + (r.verdict === 'correct' ? ' primary' : ''), type: 'button', disabled: !canNext, onclick: () => newChallenge(true) }, '새 조건 받기'));
    if (r.verdict !== 'pending' && !r.manual) {
      actions.append(S.flagged
        ? h('span', { class: 'muted small', style: 'align-self:center' }, '선생님께 전달했어요.')
        : h('button', { class: 'btn', type: 'button', onclick: flag }, '판정이 이상해요 (선생님께 알리기)'));
    }
    card.append(actions);
    if (!canNext) card.append(h('p', { class: 'muted small', style: 'margin-top:8px' }, '3번 도전하거나 문법 조건을 맞히면 새 조건을 받을 수 있어요.'));
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
    } catch (e) {
      S.notice = e.message;
      if (e.status === 410) { S.busy = false; await newChallenge(false); }
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
      h('div', { class: 'chip' }, `${st.cls} ${st.name}`, h('button', { class: 'btn sm', type: 'button', onclick: () => logout(false) }, '나가기')));

    const nodes = [top];
    if (S.notice) nodes.push(h('div', { class: 'notice bad', role: 'alert' }, S.notice));
    if (c) {
      nodes.push(h('section', { class: 'card' },
        h('h2', null, '이번 제작 조건'),
        h('div', { class: 'conds' },
          condRow('문장 성분', c.conditions.comp),
          condRow('문장의 짜임', c.conditions.struct),
          topicRow(c)),
        h('p', { class: 'muted small', style: 'margin-top:12px' }, '세 조건을 모두 만족하는 문장 한 개를 써서 제출하세요.'), h('p', { class: 'sig', style: 'text-align:right;margin-top:6px' }, '- A.N. -')));
      nodes.push(h('section', { class: 'card' },
        h('h2', null, '내 문장'), pad,
        h('div', { class: 'compose-foot' }, count, btn)));
    } else {
      nodes.push(h('section', { class: 'card' }, h('p', null, '조건을 받지 못했어요.'),
        h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'button', onclick: () => newChallenge(true) }, '조건 받기'))));
    }
    const rc = resultCard();
    if (rc) nodes.push(rc);
    const fbCount = S.history.filter((x) => x.tfeedback).length;
    nodes.push(h('div', { class: 'actions', style: 'margin-top:0' }, h('button', { class: 'btn', type: 'button', onclick: toggleHist }, S.showHist ? '내 기록 닫기' : '내 기록 보기' + (fbCount ? ` (선생님 피드백 ${fbCount})` : ''))));
    if (S.showHist) nodes.push(histCard());
    nodes.push(h('div', { class: 'actions', style: 'margin-top:0' }, h('button', { class: 'btn', type: 'button', onclick: togglePadlet }, S.showPadlet ? '패들렛 닫기' : '패들렛에 올리기')));
    if (S.showPadlet) nodes.push(padletCard());
    if (S.posterOn) {
      nodes.push(h('div', { class: 'actions', style: 'margin-top:0' }, h('button', { class: 'btn', type: 'button', onclick: togglePoster }, S.showPoster ? '포스터 프롬프트 닫기' : '포스터 프롬프트 만들기')));
      if (S.showPoster) nodes.push(posterCard());
    }
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
      const prevCount = S.history.filter((x) => x.tfeedback).length;
      S.history = me.history; S.stats = me.stats; S.padletTemplate = me.padletTemplate || ''; S.padlet = me.padlet || { post: false, link: '' };
      if (S.challenge && S.challenge.topicChoice && me.topicChoice === false) {
        S.challenge.topicChoice = false; S.topicText = ''; save();
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
