'use strict';
// 시연판 가짜 서버: 이 브라우저 안에서만 동작한다. 서버·AI·패들렛에 아무것도 보내지 않고, 아무것도 저장하지 않는다.
// 판정은 AI가 아니라 미리 준비한 예시 문장에 대해서만 한다.
(function () {
  const ORIG = window.fetch.bind(window);
  const MAX = 2;
  const STU = { sid: '90101', name: '시연 학생', cls: '시연반', no: 1 };
  const RD = { id: 'r-demo', no: 1, name: '시연', openedAt: Date.now(), closedAt: 0, groupMode: false, split: false, phase: 2 };
  const view = (c, s, t, tl) => ({ comp: c, struct: s, topic: { id: t, label: tl } });
  // 조건 보기(실제 문장 연습실의 조건 문구와 같다)
  const COMP = {
    adv: { id: 'adv', level: 'easy', label: '부사어가 있는 문장', short: '용언(서술어)이나 다른 말을 꾸며 주는 부사어를 넣어 쓰세요.', example: '꽃이 활짝 핀다. (활짝 = 부사어)' },
    obj: { id: 'obj', level: 'easy', label: '목적어가 있는 문장', short: '동작의 대상이 되는 말, 곧 목적어(~을/~를)를 넣어 쓰세요.', example: '나는 밥을 먹었다. (밥을 = 목적어)' },
    adnom: { id: 'adnom', level: 'easy', label: '관형어가 있는 문장', short: '체언(명사·대명사·수사)을 꾸며 주는 말, 곧 관형어를 넣어 쓰세요.', example: '새 책을 샀다. (새 = 관형어)' },
  };
  const STRUCT = {
    coord: { id: 'coord', level: 'easy', label: '대등하게 이어진문장', short: "'-고, -(으)며, -(으)나, -지만, -거나'로 두 문장을 대등하게 이어서 쓰세요.", example: '봄이 오고 꽃이 핀다.' },
    simple: { id: 'simple', level: 'easy', label: '홑문장', short: '주어와 서술어의 관계가 한 번만 나타나는 문장을 쓰세요.', example: '꽃이 핀다.' },
    subord: { id: 'subord', level: 'easy', label: '종속적으로 이어진문장', short: "'-(으)면, -아서, -(으)니까, -려고' 같은 연결 어미로 앞 절이 뒤 절에 종속되게 이어서 쓰세요.", example: '비가 오면 우산을 쓴다.' },
  };
  const ok = (reason) => ({ ok: true, reason, where: '', fix: '' });
  const no = (reason, where, fix) => ({ ok: false, reason, where, fix });
  const CH = [
    { v: view(COMP.adv, STRUCT.coord, 't8', '횡단보도 교통안전'),
      good: ['어린이도 천천히 걷고 차도 천천히 가요.'], bad: '어린이도 걷고 차도 가요.',
      goodRes: { checks: { component: ok("'천천히'가 '걷고'와 '가요'를 꾸며 주는 부사어예요."), structure: ok("'걷고'의 '-고'가 두 절을 대등하게 이어 주어요."), wellformed: ok('주어와 서술어를 갖춘 완결된 한 문장이에요.') },
        analysis: "[어린이도 천천히 걷고] + [차도 천천히 가요]\n앞 절: 주어 어린이도 / 부사어 천천히 / 서술어 걷고\n뒤 절: 주어 차도 / 부사어 천천히 / 서술어 가요", tip: '대등하게 이어진문장은 앞뒤 절의 순서를 바꿔도 뜻이 크게 달라지지 않아요.', example: '봄에는 꽃이 활짝 피고 나비가 천천히 날아요.' },
      badRes: { checks: { component: no('서술어를 꾸며 주는 부사어가 보이지 않아요.', '걷고', "'천천히'처럼 서술어를 꾸며 주는 말을 넣어 보세요."), structure: ok("'-고'로 두 절이 대등하게 이어졌어요."), wellformed: ok('완결된 한 문장이에요.') },
        analysis: '[어린이도 걷고] + [차도 가요]\n앞 절: 주어 어린이도 / 서술어 걷고\n뒤 절: 주어 차도 / 서술어 가요', tip: '부사어는 빼도 문장이 성립하지만, 이 조건에서는 꼭 하나 넣어야 해요.', example: '' } },
    { v: view(COMP.obj, STRUCT.simple, 't2', '분리배출 실천'),
      good: ['우리는 분리배출을 실천합니다.'], bad: '플라스틱이 바다로 흘러가요.',
      goodRes: { checks: { component: ok("'분리배출을'이 서술어 '실천합니다'의 대상이 되는 목적어예요."), structure: ok('주어(우리는)와 서술어(실천합니다)의 관계가 한 번만 나타나요.'), wellformed: ok('주어와 서술어를 갖춘 완결된 한 문장이에요.') },
        analysis: '우리는(주어) / 분리배출을(목적어) / 실천합니다(서술어)', tip: "목적어는 '을/를'이 붙은 말이 대표적이에요. 보조사가 붙으면 모양이 달라질 수 있어요.", example: '친구들이 쓰레기를 줍습니다.' },
      badRes: { checks: { component: no("동작의 대상이 되는 '을/를' 말이 없어요.", '흘러가요', "'무엇을' 하는지 나타내는 말(예: 플라스틱을 줄여요)을 넣어 보세요."), structure: ok('주어와 서술어의 관계가 한 번만 나타나는 홑문장이에요.'), wellformed: ok('완결된 한 문장이에요.') },
        analysis: '플라스틱이(주어) / 바다로(부사어) / 흘러가요(서술어)', tip: "'흘러가다'는 목적어 없이 쓰는 서술어라서 이 조건에는 맞지 않아요.", example: '' } },
    { v: view(COMP.adnom, STRUCT.subord, 't4', '에너지 절약'),
      good: ['불필요한 전등을 끄면 에너지를 아낄 수 있어요.'], bad: '전등을 끄고 에너지를 아껴요.',
      goodRes: { checks: { component: ok("'불필요한'이 체언 '전등'을 꾸며 주는 관형어예요."), structure: ok("'끄면'의 '-(으)면'이 앞 절을 뒤 절에 종속적으로 이어 주어요."), wellformed: ok('주어(생략)와 서술어를 갖춘 완결된 한 문장이에요.') },
        analysis: '[불필요한 전등을 끄면] + [에너지를 아낄 수 있어요]\n앞 절(종속절): 관형어 불필요한 / 목적어 전등을 / 서술어 끄면\n뒤 절: 목적어 에너지를 / 서술어 아낄 수 있어요', tip: '종속적 연결 어미는 앞 절이 뒤 절의 조건·이유·목적 같은 의미 관계를 만들어요.', example: '비가 오는 날에는 우산을 챙기면 좋아요.' },
      badRes: { checks: { component: no('체언을 꾸며 주는 관형어가 보이지 않아요.', '전등을', "'불필요한 전등', '모든 전등'처럼 체언 앞에 꾸미는 말을 넣어 보세요."), structure: no("'-고'는 두 절을 대등하게 잇는 어미라서 종속적 이어짐이 아니에요.", '끄고', "'-(으)면'이나 '-아서'처럼 종속적으로 잇는 어미로 바꿔 보세요."), wellformed: ok('완결된 한 문장이에요.') },
        analysis: '[전등을 끄고] + [에너지를 아껴요]\n앞 절: 목적어 전등을 / 서술어 끄고\n뒤 절: 목적어 에너지를 / 서술어 아껴요', tip: "'-고'는 대등한 이어짐, '-(으)면'은 종속적 이어짐이에요.", example: '' } },
  ];
  const norm = (t) => String(t || '').replace(/[\s.!?,]/g, '');
  const TOPICS = ['플라스틱 사용 줄이기', '분리배출 실천', '음식물 쓰레기 줄이기', '에너지 절약', '물 절약', '횡단보도 교통안전', '안전벨트 착용', '학교폭력 예방'];
  const st = { next: 0, cur: 0, tries: {}, hist: [], n: 0 };
  const j = (body, status) => new Response(JSON.stringify(body), { status: status || 200, headers: { 'content-type': 'application/json' } });
  const recOf = (id) => st.hist.find((x) => x.id === id);
  const publicHist = () => st.hist.slice().reverse();
  function notify() { try { window.dispatchEvent(new CustomEvent('demo:challenge', { detail: { good: CH[st.cur].good[0], bad: CH[st.cur].bad } })); } catch (e) { /* 무시 */ } }

  async function handle(path, body) {
    switch (path) {
      case '/api/login': return j({ token: 'demo', student: STU });
      case '/api/me': return j({
        student: STU, stats: { tries: st.hist.length, correct: st.hist.filter((x) => x.verdict === 'correct').length }, history: publicHist(),
        round: RD, open: true, poster: true, imageGen: true, imageMax: MAX, topicChoice: true, topicList: TOPICS, padletTemplate: '',
        padlet: { post: true, link: '', board: false }, group: null, demo: false });
      case '/api/challenge': {
        st.cur = st.next % CH.length; st.next++; notify();
        return j({ token: 'c' + st.cur, conditions: CH[st.cur].v, topicChoice: true, topicList: TOPICS });
      }
      case '/api/typing': case '/api/flag': return j({ ok: true });
      case '/api/submit': {
        const idx = parseInt(String(body.token || 'c0').slice(1), 10) || 0; const c = CH[idx % CH.length];
        const sentence = String(body.sentence || '').replace(/\s+/g, ' ').trim();
        if (sentence.length < 2) return j({ error: '문장을 입력해 주세요.' }, 400);
        const a = (st.tries[idx] = (st.tries[idx] || 0) + 1);
        const isGood = c.good.some((g) => norm(g) === norm(sentence)); const isBad = norm(c.bad) === norm(sentence);
        if (!isGood && !isBad) {
          return j({ id: 'demo-p' + (++st.n), attempt: a, topic: body.topicText || c.v.topic.label, verdict: 'pending', checks: null, analysis: '', tip: '', example: '', manual: false,
            message: '시연판에서는 AI 판정을 하지 않아요. 아래 [정답 예시 넣기]·[오답 예시 넣기]를 눌러 판정 화면을 체험해 보세요.' });
        }
        const r = isGood ? c.goodRes : c.badRes; const id = 'demo-' + (++st.n);
        if (isGood) st.hist.push({ id, ts: Date.now(), attempt: a, sentence, rd: RD.id, rdName: RD.name, verdict: 'correct', flagged: false, by: '', gno: 0, tfeedback: '', tfeedbackAt: 0, padletAt: 0, poster: null, imgN: 0, posterImg: null, comp: c.v.comp.label, struct: c.v.struct.label, topic: body.topicText || c.v.topic.label });
        return j({ id, attempt: a, topic: body.topicText || c.v.topic.label, verdict: isGood ? 'correct' : 'incorrect', checks: r.checks, analysis: r.analysis, tip: r.tip, example: isGood || a >= 3 ? r.example : '', manual: false, message: '' });
      }
      case '/api/poster': return j({ id: 'demo' });
      case '/api/poster/image': {
        const r = recOf(body.id); if (!r) return j({ error: '문장을 찾지 못했어요.' }, 404);
        if (r.imgN >= MAX) return j({ error: `이 문장은 이미지를 ${MAX}번 모두 만들었어요.` }, 429);
        await new Promise((res) => setTimeout(res, 1800));   // 만드는 중 화면을 잠깐 보여 준다
        r.imgN++; r.posterImg = { url: 'demo-poster.jpg', at: Date.now(), by: STU.name, prompt: String(body.prompt || '').slice(0, 200), posted: false };
        return j({ ok: true, url: 'demo-poster.jpg', left: MAX - r.imgN });
      }
      case '/api/poster/image/post': {
        const r = recOf(body.id); if (!r || !r.posterImg) return j({ error: '올릴 그림이 아직 없어요.' }, 400);
        await new Promise((res) => setTimeout(res, 600));
        r.posterImg.posted = true; r.padletAt = Date.now();
        return j({ ok: true, posted: true, link: '' });
      }
      case '/api/padlet/post': { const r = recOf(body.id); if (r) r.padletAt = Date.now(); return j({ ok: true, at: Date.now(), link: '' }); }
      default: return j({ error: '시연판에서는 쓰지 않는 기능이에요.' }, 404);
    }
  }
  window.fetch = function (url, opt) {
    const u = String(url);
    const i = u.indexOf('/__demo');
    if (i < 0) return ORIG(url, opt);
    const path = u.slice(i + 7).split('?')[0];
    let body = {}; try { body = opt && opt.body ? JSON.parse(opt.body) : {}; } catch (e) { /* 무시 */ }
    return handle(path, body);
  };
  window.__demoExamples = () => ({ good: CH[st.cur].good[0], bad: CH[st.cur].bad });
})();
