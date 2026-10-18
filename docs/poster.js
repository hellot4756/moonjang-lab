'use strict';
// 공익광고 포스터 프롬프트 만들기: 학생이 고른 선택지와 입력값을 이미지 생성 AI에 붙여 넣을 프롬프트로 조립한다.
// AI 호출 없이 이 파일의 규칙만으로 만든다. 선택지(OPTIONS)를 고치면 화면에도 그대로 나타난다.
(function (root) {
  // 각 선택지: [값, 화면에 보일 이름, 한국어 프롬프트 문구, 영어 프롬프트 문구]
  const OPTIONS = {
    format: {
      label: '포스터 모양', def: 'portrait',
      items: [
        ['portrait', '세로형 (3:4)', '세로형 포스터 (3:4 비율)', 'vertical poster, 3:4 aspect ratio'],
        ['landscape', '가로형 (16:9)', '가로형 포스터 (16:9 비율)', 'horizontal poster, 16:9 aspect ratio'],
        ['square', '정사각형 (1:1)', '정사각형 포스터 (1:1 비율)', 'square poster, 1:1 aspect ratio'],
      ],
    },
    style: {
      label: '그림 스타일', def: 'flat',
      items: [
        ['flat', '플랫 일러스트', '단순하고 깔끔한 플랫 일러스트', 'clean flat vector illustration'],
        ['watercolor', '수채화', '번지는 느낌의 수채화', 'soft watercolor painting'],
        ['3d', '3D 캐릭터', '귀여운 3D 캐릭터 렌더링', 'cute 3D character render with soft lighting'],
        ['photo', '실사 사진', '실제 사진처럼 사실적인 이미지', 'realistic photograph'],
        ['minimal', '미니멀 아이콘', '여백이 많은 미니멀 아이콘 디자인', 'minimalist icon design with generous white space'],
        ['retro', '레트로 포스터', '옛날 느낌의 레트로 빈티지 포스터', 'retro vintage poster style'],
        ['comic', '만화·웹툰', '만화·웹툰 스타일', 'comic / webtoon style'],
        ['crayon', '크레용·색연필', '크레용과 색연필로 그린 손그림', 'hand-drawn crayon and colored-pencil drawing'],
        ['papercut', '종이 오리기', '종이를 겹겹이 오려 붙인 페이퍼컷 공예', 'layered paper-cut craft art'],
        ['pixel', '픽셀 아트', '픽셀 아트', 'pixel art'],
      ],
    },
    mood: {
      label: '분위기', def: 'hopeful',
      items: [
        ['warm', '따뜻하고 포근한', '따뜻하고 포근한 분위기', 'warm and cozy mood'],
        ['hopeful', '희망차고 밝은', '희망차고 밝은 분위기', 'hopeful and bright mood'],
        ['serious', '진지하고 묵직한', '진지하고 묵직한 분위기', 'serious and weighty mood'],
        ['warning', '경각심을 주는', '경각심을 주는 긴박한 분위기', 'urgent, warning mood that raises awareness'],
        ['humor', '유쾌하고 재치 있는', '유쾌하고 재치 있는 분위기', 'playful and witty mood'],
        ['touching', '감동적이고 잔잔한', '감동적이고 잔잔한 분위기', 'touching and calm mood'],
      ],
    },
    color: {
      label: '색감', def: 'pastel', custom: true,
      items: [
        ['pastel', '파스텔 톤', '부드러운 파스텔 톤', 'soft pastel color palette'],
        ['vivid', '선명한 원색', '선명하고 강렬한 원색', 'vivid, saturated primary colors'],
        ['point', '흑백 + 포인트 색', '흑백에 한 가지 포인트 색만 쓴 색감', 'black-and-white with a single accent color'],
        ['green', '초록·자연 색감', '초록색 중심의 자연스러운 색감', 'natural green-centered palette'],
        ['blue', '시원한 파란색', '시원한 파란색 계열', 'cool blue palette'],
        ['warmtone', '따뜻한 주황·노랑', '따뜻한 주황·노랑 계열', 'warm orange and yellow palette'],
      ],
    },
    composition: {
      label: '구도', def: 'person',
      items: [
        ['person', '인물 중심', '인물이 중심에 있는 구도', 'composition centered on a person'],
        ['object', '상징 사물 크게', '메시지를 상징하는 사물을 크게 보여 주는 구도', 'a large symbolic object as the focal point'],
        ['landscape', '넓은 풍경', '넓은 풍경 속에 메시지를 담은 구도', 'a wide landscape that carries the message'],
        ['contrast', '전/후 대비', '잘못된 모습과 바른 모습을 나란히 비교하는 대비 구도', 'a before/after contrast composition'],
        ['icons', '작은 그림 반복', '작은 그림 여러 개를 규칙적으로 늘어놓은 구도', 'a repeated pattern of small illustrations'],
        ['closeup', '클로즈업', '한 장면을 가까이서 보여 주는 클로즈업 구도', 'a close-up of a single scene'],
      ],
    },
    audience: {
      label: '보는 사람', def: 'teen',
      items: [
        ['teen', '청소년', '청소년', 'teenagers'],
        ['all', '모든 연령', '모든 연령대의 사람들', 'people of all ages'],
        ['adult', '어른·학부모', '어른과 학부모', 'adults and parents'],
        ['kid', '어린이', '어린이', 'young children'],
      ],
    },
    textMode: {
      label: '포스터 안의 글자', def: 'in',
      items: [
        ['in', '내 문장을 글자로 넣기', '', ''],
        ['none', '글자 없이 그림만', '', ''],
      ],
    },
    font: {
      label: '글씨체', def: 'gothic',
      items: [
        ['gothic', '굵고 또렷한 고딕', '굵고 또렷한 고딕체', 'bold, clear sans-serif lettering'],
        ['hand', '손글씨', '손글씨 느낌', 'handwritten lettering'],
        ['serif', '단정한 명조', '단정한 명조체', 'neat serif lettering'],
        ['round', '둥글둥글한 글씨', '둥글둥글한 글씨', 'rounded friendly lettering'],
        ['brush', '붓글씨', '붓글씨 느낌', 'brush calligraphy lettering'],
      ],
    },
    textPos: {
      label: '글자 위치', def: 'top',
      items: [
        ['top', '위쪽', '포스터 위쪽', 'at the top of the poster'],
        ['center', '가운데', '포스터 가운데', 'in the center of the poster'],
        ['bottom', '아래쪽', '포스터 아래쪽', 'at the bottom of the poster'],
      ],
    },
  };

  const TEXT_FIELDS = ['topic', 'sentence', 'colorCustom', 'subject', 'scene', 'extra', 'avoid'];

  function defaults() {
    const v = {};
    for (const [k, o] of Object.entries(OPTIONS)) v[k] = o.def;
    for (const k of TEXT_FIELDS) v[k] = '';
    return v;
  }

  function pick(key, val) {
    const o = OPTIONS[key];
    return o.items.find((x) => x[0] === val) || o.items.find((x) => x[0] === o.def);
  }

  const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

  // lang: 'ko' | 'en'. 자유 입력(주제, 문장, 등장 대상 등)은 학생이 쓴 글 그대로 넣는다.
  function build(v, lang) {
    v = Object.assign(defaults(), v || {});
    const en = lang === 'en';
    const t = (key) => pick(key, v[key])[en ? 3 : 2];
    const topic = clean(v.topic), sentence = clean(v.sentence);
    const textIn = v.textMode !== 'none' && sentence;
    const colorKo = clean(v.colorCustom) || t('color');
    const L = [];

    if (en) {
      L.push('Create a public service announcement (PSA) poster for a school project.');
      if (topic) L.push(`Topic: ${topic}`);
      if (sentence) L.push(`Core message (written by the student, in Korean): "${sentence}"`);
      L.push(`Format: ${t('format')}`);
      L.push(`Art style: ${t('style')}`);
      L.push(`Mood: ${t('mood')}`);
      L.push(`Colors: ${colorKo}`);
      L.push(`Composition: ${t('composition')}`);
      if (clean(v.subject)) L.push(`Main subject(s): ${clean(v.subject)}`);
      if (clean(v.scene)) L.push(`Scene / background: ${clean(v.scene)}`);
      L.push(`Target audience: ${t('audience')}`);
      if (textIn) {
        L.push(`Text on the poster: write the Korean message "${sentence}" exactly as written, ${t('textPos')}, in ${t('font')}. Do not change or misspell any Korean characters.`);
      } else {
        L.push('Text on the poster: do not include any text or letters; image only.');
      }
      if (clean(v.extra)) L.push(`Extra requests: ${clean(v.extra)}`);
      const avoid = ['violent or sexual content', 'real people or celebrities', 'brand logos or trademarks'];
      if (clean(v.avoid)) avoid.unshift(clean(v.avoid));
      L.push(`Avoid: ${avoid.join('; ')}`);
      L.push('All text must be written in Korean.');
      L.push('Keep the design simple and easy to read so the message is clear at a glance, and make it suitable for students.');
      return L.join('\n');
    }

    L.push('학교 수업용 공익광고 포스터를 만들어 주세요.');
    L.push('');
    if (topic) L.push(`[주제] ${topic}`);
    if (sentence) L.push(`[핵심 메시지] ${sentence}`);
    L.push(`[포스터 모양] ${t('format')}`);
    L.push(`[그림 스타일] ${t('style')}`);
    L.push(`[분위기] ${t('mood')}`);
    L.push(`[색감] ${colorKo}`);
    L.push(`[구도] ${t('composition')}`);
    if (clean(v.subject)) L.push(`[등장 대상] ${clean(v.subject)}`);
    if (clean(v.scene)) L.push(`[장면·배경] ${clean(v.scene)}`);
    L.push(`[보는 사람] ${t('audience')}`);
    if (textIn) {
      L.push(`[포스터 안의 글자] "${sentence}" 문장을 ${t('textPos')}에 ${t('font')}로 크게 넣어 주세요. 한글 글자를 바꾸거나 틀리게 쓰지 말고 그대로 써 주세요.`);
    } else {
      L.push('[포스터 안의 글자] 글자는 넣지 말고 그림만 그려 주세요.');
    }
    if (clean(v.extra)) L.push(`[세부 요청] ${clean(v.extra)}`);
    const avoid = [];
    if (clean(v.avoid)) avoid.push(clean(v.avoid));
    avoid.push('폭력적이거나 선정적인 표현', '실제 인물이나 유명인', '상표나 로고');
    L.push(`[넣지 말아야 할 것] ${avoid.join(', ')}`);
    L.push('모든 텍스트는 한국어로 써주세요.');
    L.push('');
    L.push('메시지가 한눈에 들어오도록 단순하고 읽기 쉬운 디자인으로, 학생이 보기에 알맞은 표현만 사용해 주세요.');
    return L.join('\n');
  }

  // ---------- 패들렛에 올릴 글 양식 ----------
  // {이름} {광고문구} {문법조건} {성분조건} {짜임조건} {주제} {학번} {반} 자리에 학생의 내용이 들어간다.
  const DEFAULT_PADLET = '광고문구: {광고문구}\n문법 조건: {문법조건}\n주제: {주제}';
  const PADLET_TOKENS = ['이름', '광고문구', '문법조건', '성분조건', '짜임조건', '주제', '학번', '반'];

  function fillTemplate(tpl, vals) {
    const t = (typeof tpl === 'string' && tpl.trim()) ? tpl : DEFAULT_PADLET;
    const v = Object.assign({}, vals || {});
    if (v['문법조건'] == null) v['문법조건'] = [v['성분조건'], v['짜임조건']].filter(Boolean).join(' + ');
    return t.replace(/\{(이름|광고문구|문법조건|성분조건|짜임조건|주제|학번|반)\}/g, (m, k) => (v[k] == null ? '' : String(v[k]).replace(/\s+/g, ' ').trim()))
      .replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  }

  const api = { OPTIONS, TEXT_FIELDS, defaults, build, DEFAULT_PADLET, PADLET_TOKENS, fillTemplate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Poster = api;
})(typeof window !== 'undefined' ? window : globalThis);
