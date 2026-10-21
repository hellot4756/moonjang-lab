'use strict';
// 고등학교 국어 '문장 성분과 문장의 짜임' 연습용 조건 풀 (쉬움~기본)
// rubric 은 AI 판정에만 쓰이고 학생에게는 보이지 않는다.
// 아래는 '기본값'이다. 선생님이 교사 화면의 [조건 관리]에서 고치면 data/conditions.json 에 저장되고, 그 파일이 우선한다.

const DEFAULT_COMPONENTS = [
  {
    id: 'obj', level: 'easy', label: '목적어가 있는 문장',
    short: '동작의 대상이 되는 말, 곧 목적어(~을/~를)를 넣어 쓰세요.',
    example: '나는 밥을 먹었다. (밥을 = 목적어)',
    rubric: '문장에 목적어(체언 + 을/를, 보조사가 덧붙은 형태 포함)가 하나 이상 있어야 한다. 서술어가 타동사로 쓰였는지 확인한다. 안긴 절 안의 목적어도 인정한다.',
  },
  {
    id: 'adnom', level: 'easy', label: '관형어가 있는 문장',
    short: '체언(명사·대명사·수사)을 꾸며 주는 말, 곧 관형어를 넣어 쓰세요.',
    example: '새 책을 샀다. (새 = 관형어)',
    rubric: '관형어가 하나 이상 있어야 한다. 관형사(새, 헌, 모든, 여러, 이, 그, 저 등), 체언 + 의, 용언의 관형사형(관형절 포함)을 모두 인정한다.',
  },
  {
    id: 'adv', level: 'easy', label: '부사어가 있는 문장',
    short: '서술어를 꾸며 주거나 장소·시간·방법 등을 나타내는 부사어를 넣어 쓰세요.',
    example: '그는 천천히 걸었다. (천천히 = 부사어)',
    rubric: '부사어가 하나 이상 있어야 한다. 부사(매우, 빨리 등), 체언 + 부사격 조사(에, 에서, 에게, (으)로, 와/과, 처럼 등), 용언의 부사형(부사절), 인용절(~라고/~다고)을 모두 부사어로 인정한다.',
  },
  {
    id: 'compl', level: 'easy', label: '보어가 있는 문장',
    short: "'되다'나 '아니다' 앞에서 문장을 완성해 주는 보어(~이/~가)를 넣어 쓰세요.",
    example: '물이 얼음이 되었다. (얼음이 = 보어)',
    rubric: "보어는 서술어 '되다', '아니다' 앞에 오는 '체언 + 이/가' 성분이다. 문장에 보어가 하나 이상 있어야 한다. 서술어가 '되다/아니다'가 아니면 보어가 없는 것으로 본다. 주어와 구별해서 판단한다.",
  },
  {
    id: 'indep', level: 'easy', label: '독립어가 있는 문장',
    short: '다른 성분과 따로 떨어져 쓰이는 독립어(감탄사, 부르는 말, 제시어 등)를 넣어 쓰세요.',
    example: '아, 비가 온다. / 지민아, 이리 와. (아, 지민아 = 독립어)',
    rubric: '독립어가 하나 이상 있어야 한다. 감탄사(아, 와, 어머), 부름말(체언 + 아/야/이여, 여러분 등), 제시어, 대답(네, 아니요)을 인정한다. 쉼표 등으로 문장의 다른 성분과 따로 떨어져 쓰인 형태여야 자연스럽다.',
  },
  {
    id: 'obj-adv', level: 'basic', label: '목적어와 부사어가 모두 있는 문장',
    short: '목적어(~을/~를)와 부사어를 둘 다 넣어 쓰세요.',
    example: '나는 도서관에서 책을 읽었다. (도서관에서 = 부사어, 책을 = 목적어)',
    rubric: '목적어가 하나 이상, 부사어가 하나 이상 모두 있어야 한다. 한쪽이라도 없으면 불충족이다. (목적어와 부사어의 인정 기준은 위 개별 조건과 같다: 부사어는 부사, 체언 + 부사격 조사, 부사형 절, 인용절을 인정)',
  },
  {
    id: 'req-adv', level: 'basic', label: '필수 부사어가 있는 문장',
    short: "'주다·넣다·삼다·두다·보내다'처럼 꼭 필요한 부사어(~에게, ~에, ~으로 등)를 요구하는 서술어를 쓰세요.",
    example: '나는 동생에게 선물을 주었다. (동생에게 = 필수 부사어)',
    rubric: "서술어가 필수 부사어를 요구하는 서술어(주다, 드리다, 넣다, 두다, 삼다, 보내다, 향하다, 같다 등)이고, 그 필수 부사어가 실제로 문장에 있어야 한다. 빼면 문장이 어색해지거나 불완전해지는 부사어만 필수 부사어이다. 자유로운 부사어(예: '학교에서 공부했다'의 '학교에서', '빨리')만 있으면 불충족이다.",
  },
  {
    id: 'main-sub', level: 'basic', label: '주어·목적어·서술어에 관형어와 부사어까지 갖춘 문장',
    short: '주어, 목적어, 서술어, 관형어, 부사어를 모두 넣어 쓰세요.',
    example: '어린 동생이 마당에서 공을 찼다. (어린 = 관형어, 마당에서 = 부사어)',
    rubric: '주어, 서술어, 목적어, 관형어, 부사어가 모두 하나 이상 있어야 한다. 하나라도 없으면 불충족이며, 없는 성분을 where/fix에서 알려 준다.',
  },
  {
    id: 'indep-obj', level: 'basic', label: '독립어와 목적어가 있는 문장',
    short: '독립어(감탄사, 부르는 말 등)와 목적어(~을/~를)를 둘 다 넣어 쓰세요.',
    example: '여러분, 쓰레기를 줄입시다. (여러분 = 독립어, 쓰레기를 = 목적어)',
    rubric: '독립어가 하나 이상, 목적어가 하나 이상 모두 있어야 한다. 한쪽이라도 없으면 불충족이다.',
  },
  {
    id: 'no-obj', level: 'basic', label: '목적어가 없는 문장',
    short: '목적어(~을/~를)가 하나도 나타나지 않는 문장을 쓰세요.',
    example: '하늘이 맑다. / 꽃이 피었다.',
    rubric: "문장 전체(안긴 절 포함)에 목적어가 하나도 없어야 한다. 목적어 구실을 하는 명사절(예: '~음을 알았다')이 있어도 목적어가 있는 것으로 본다. 목적어가 하나라도 있으면 불충족이며 그 부분을 where로 알려 준다. 주어·서술어만으로도 성립한다.",
  },
];

const DEFAULT_STRUCTURES = [
  {
    id: 'simple', level: 'easy', label: '홑문장',
    short: '주어와 서술어의 관계가 한 번만 나타나는 문장을 쓰세요.',
    example: '꽃이 핀다.',
    rubric: '문장 전체에 주어-서술어 관계가 한 번만 나타나야 한다. 안은문장(안긴 절)이나 이어진문장이 있으면 겹문장이므로 불충족이다. 서술절, 관형절, 부사절, 명사절, 인용절, 연결 어미로 이어진 절이 있는지 확인한다.',
  },
  {
    id: 'coord', level: 'easy', label: '대등하게 이어진문장',
    short: "'-고, -(으)며, -(으)나, -지만, -거나'로 두 문장을 대등하게 이어서 쓰세요.",
    example: '봄이 오고 꽃이 핀다.',
    rubric: "두 개 이상의 절이 대등적 연결 어미(나열 -고/-(으)며, 대조 -(으)나/-지만, 선택 -거나/-든지)로 이어진 문장이어야 한다. 두 절 모두 서술어가 있어야 한다. '-고'가 시간 순서의 나열이어도 대등으로 인정한다. 이유·조건·목적·배경 등을 나타내는 종속적 연결 어미(-아서, -(으)니까, -(으)면, -(으)려고, -는데 등)만 쓰였다면 불충족이다.",
  },
  {
    id: 'subord', level: 'easy', label: '종속적으로 이어진문장',
    short: "'-(으)면, -아서/어서, -(으)니까, -(으)려고, -(으)ㄹ수록'처럼 앞 절이 뒤 절에 매인 이어진문장을 쓰세요.",
    example: '비가 오면 소풍을 취소한다.',
    rubric: '두 개 이상의 절이 종속적 연결 어미(이유 -아서/-(으)니까, 조건 -(으)면, 양보 -아도/-지라도, 목적 -(으)려고/-러, 배경 -는데, 동시 -(으)면서, 전환 -다가, 정도 -(으)ㄹ수록)로 이어진 문장이어야 한다. 대등적 연결 어미(-고, -(으)며, -지만, -거나)로만 이어졌다면 불충족이다.',
  },
  {
    id: 'noun-clause', level: 'basic', label: '명사절을 안은문장',
    short: "문장 속에 '-(으)ㅁ'이나 '-기'로 끝나 명사 구실을 하는 절을 넣어 쓰세요.",
    example: '나는 철수가 일찍 왔음을 알았다. / 규칙을 지키기가 어렵다.',
    rubric: "안긴 절의 서술어에 명사형 어미 '-(으)ㅁ' 또는 '-기'가 붙어 절 전체가 명사 구실(주어, 목적어, 부사어 등)을 해야 한다. 이미 명사로 굳은 말(삶, 믿음, 웃음, 기쁨, 달리기, 마음 등)만 있으면 명사절이 아니므로 불충족이다. 안긴 절에 주어가 있거나 생략되어도 서술어가 있는 절이어야 한다.",
  },
  {
    id: 'adnominal', level: 'basic', label: '관형절을 안은문장',
    short: "문장 속에 '-(으)ㄴ, -는, -(으)ㄹ, -던'으로 끝나 체언을 꾸미는 절을 넣어 쓰세요.",
    example: '나는 친구가 빌려준 책을 읽었다.',
    rubric: "안긴 절의 서술어(동사·형용사·서술격 조사)에 관형사형 어미 '-(으)ㄴ, -는, -(으)ㄹ, -던'이 붙어 뒤의 체언을 꾸며야 한다. 관형사(새, 헌, 모든 등)나 '체언 + 의'만 있으면 절이 아니므로 불충족이다. 형용사의 관형사형(예: 맑은 하늘)도 서술어가 있는 관형절로 인정한다.",
  },
  {
    id: 'adverbial', level: 'basic', label: '부사절을 안은문장',
    short: "문장 속에 '-게, -도록, -듯이'나 '없이'처럼 서술어를 꾸미는 부사절을 넣어 쓰세요.",
    example: '꽃이 아름답게 피었다. / 그는 소리도 없이 사라졌다.',
    rubric: "안긴 절의 서술어에 부사형 어미(-게, -도록, -듯이 등)나 부사 파생 접사('없이' 등)가 붙어 절이 부사어 구실을 해야 한다. '빨리', '천천히'처럼 단어 하나인 부사만 있으면 부사절이 아니므로 불충족이다. 주어가 따로 있거나 서술어가 있는 절 구조여야 한다.",
  },
  {
    id: 'predicate-clause', level: 'basic', label: '서술절을 안은문장',
    short: '문장 전체의 주어 뒤에 [주어 + 서술어]로 된 절이 서술어 구실을 하는 문장을 쓰세요.',
    example: '코끼리는 코가 길다. (코가 길다 = 서술절)',
    rubric: "문장 전체의 주어(보통 '~은/는')가 있고, 그 서술어 자리에 [주어 + 서술어]로 이루어진 절이 와야 한다(예: 코끼리는 [코가 길다]). 서술절에는 따로 절을 나타내는 어미가 붙지 않는다. 주어가 하나뿐인 일반 홑문장이면 불충족이다.",
  },
  {
    id: 'quote', level: 'basic', label: '인용절을 안은문장',
    short: "남의 말이나 생각을 '-라고, -다고, -(으)라고, -자고, -냐고'로 인용하는 절을 넣어 쓰세요.",
    example: '선생님께서는 내일 시험을 본다고 말씀하셨다.',
    rubric: "다른 사람의 말이나 생각(또는 자신의 말·생각)을 인용 조사 '라고' 또는 '고'(-다고, -냐고, -자고, -(으)라고)로 안은 절이 있어야 한다. 직접 인용(\"…\"라고)과 간접 인용 모두 인정한다. 단순히 큰따옴표만 있고 인용 조사 없이 끝나면 불충족이다.",
  },
];

const DEFAULT_TOPICS = [
  '플라스틱 사용 줄이기', '분리배출 실천', '음식물 쓰레기 줄이기', '에너지 절약', '물 절약',
  '금연', '음주운전 예방', '횡단보도 교통안전', '안전벨트 착용', '학교폭력 예방',
  '악성 댓글(사이버 폭력) 예방', '개인정보 보호', '스마트폰 과의존 예방', '걸으면서 스마트폰 보지 않기',
  '전동 킥보드 안전수칙', '장애인 인식 개선', '다문화 가정 존중', '어르신 공경', '헌혈 참여',
  '장기 기증', '독서 생활화', '나눔과 자원봉사', '층간소음 배려', '대중교통 자리 양보',
  '청소년 도박 예방', '기후위기 대응', '산불 예방', '유기동물 보호', '어린이 보호구역 안전',
].map((label, i) => ({ id: 't' + (i + 1), label }));

// 문장 성분 7가지. 'p:subj+obj' 처럼 id 를 이어 붙여 "이 성분이 모두 들어간 문장" 조건을 즉석에서 만든다.
const PARTS = [
  { id: 'subj', name: '주어', tag: '주어(~이/가, ~은/는)', example: '꽃이 핀다. (꽃이)',
    rubric: '주어가 하나 이상 있어야 한다(체언 + 이/가, 은/는, 께서 등. 안긴 절 안의 주어도 인정). 주어가 생략된 문장은 불충족이다.' },
  { id: 'pred', name: '서술어', tag: '서술어', example: '꽃이 핀다. (핀다)',
    rubric: '서술어가 있어야 한다. 문장이 서술어로 끝나는 완결된 문장이면 충족이다.' },
  { id: 'obj', name: '목적어', tag: '목적어(~을/~를)', example: '나는 밥을 먹었다. (밥을)',
    rubric: '목적어(체언 + 을/를, 보조사가 덧붙은 형태 포함)가 하나 이상 있어야 한다. 서술어가 타동사로 쓰였는지 확인한다. 안긴 절 안의 목적어도 인정한다.' },
  { id: 'compl', name: '보어', tag: "보어('되다·아니다' 앞의 ~이/가)", example: '물이 얼음이 되었다. (얼음이)',
    rubric: "보어는 서술어 '되다', '아니다' 앞에 오는 '체언 + 이/가' 성분이다. 보어가 하나 이상 있어야 한다. 서술어가 '되다/아니다'가 아니면 보어가 없는 것으로 본다. 주어와 구별해서 판단한다." },
  { id: 'adnom', name: '관형어', tag: '관형어(체언을 꾸미는 말)', example: '새 책을 샀다. (새)',
    rubric: '관형어가 하나 이상 있어야 한다. 관형사(새, 헌, 모든, 여러, 이, 그, 저 등), 체언 + 의, 용언의 관형사형(관형절 포함)을 모두 인정한다.' },
  { id: 'adv', name: '부사어', tag: '부사어(서술어를 꾸미는 말)', example: '그는 천천히 걸었다. (천천히)',
    rubric: '부사어가 하나 이상 있어야 한다. 부사(매우, 빨리 등), 체언 + 부사격 조사(에, 에서, 에게, (으)로, 와/과, 처럼 등), 용언의 부사형(부사절), 인용절(~라고/~다고)을 모두 부사어로 인정한다.' },
  { id: 'indep', name: '독립어', tag: '독립어(감탄사·부르는 말)', example: '아, 비가 온다. (아,)',
    rubric: '독립어가 하나 이상 있어야 한다. 감탄사(아, 와, 어머), 부름말(체언 + 아/야/이여, 여러분 등), 제시어, 대답(네, 아니요)을 인정한다. 쉼표 등으로 다른 성분과 따로 떨어져 쓰인 형태여야 자연스럽다.' },
];
const PART_IDS = PARTS.map((x) => x.id);
const DEFAULT_SEVEN = { mode: 'seven', pool: PART_IDS.slice(), min: 2, max: 3 };

// 'p:subj+obj' 형태의 id 로 조건 객체를 만든다. 올바르지 않으면 null.
function partCondition(id) {
  if (typeof id !== 'string' || !id.startsWith('p:')) return null;
  const codes = id.slice(2).split('+');
  if (!codes.length || codes.some((c) => !PART_IDS.includes(c)) || new Set(codes).size !== codes.length) return null;
  const parts = PARTS.filter((x) => codes.includes(x.id)); // 항상 정해진 순서
  const names = parts.map((x) => x.name);
  return {
    id: 'p:' + parts.map((x) => x.id).join('+'),
    level: parts.length <= 2 ? 'easy' : 'basic',
    label: names.join('·') + '가 모두 있는 문장',
    short: '다음 문장 성분을 모두 넣어 쓰세요: ' + parts.map((x) => x.tag).join(', '),
    example: parts.map((x) => `${x.name}: ${x.example}`).join(' / '),
    rubric: `다음 ${parts.length}개 성분이 모두 하나 이상 있어야 충족이다. 하나라도 없으면 불충족이며, 없는 성분이 무엇인지 reason·fix에서 알려 준다.\n` +
      parts.map((x, i) => `(${i + 1}) ${x.name}: ${x.rubric}`).join('\n'),
  };
}

// 함께 뽑히면 판단이 모호하거나 모순되는 조합 (기본 조건 id 기준)
const CONFLICTS = [
  ['no-obj', 'noun-clause'],
];

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LEVELS = ['easy', 'basic'];
const MAX = { comps: 60, structs: 60, topics: 300 };
const clone = (x) => JSON.parse(JSON.stringify(x));
const defaults = () => ({ comps: clone(DEFAULT_COMPONENTS), structs: clone(DEFAULT_STRUCTURES), topics: clone(DEFAULT_TOPICS), seven: clone(DEFAULT_SEVEN) });

let FILE = '';
let HOOK = null;     // 파일 대신 다른 저장소(데이터베이스)를 쓸 때: { save(state|null) }
let customized = false;
let state = defaults();

function fail(msg) { const e = new Error(msg); e.userMessage = msg; throw e; }

function oneLine(s, n) {
  s = typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '';
  return s.length > n ? s.slice(0, n) : s;
}
function multiLine(s, n) {
  s = typeof s === 'string' ? s.replace(/\r/g, '').trim() : '';
  return s.length > n ? s.slice(0, n) : s;
}

function newId(used) {
  let id;
  do { id = 'u' + crypto.randomBytes(3).toString('hex'); } while (used.has(id));
  return id;
}

// 입력을 검사·정리해서 { comps, structs, topics } 로 돌려준다. 문제가 있으면 userMessage 가 있는 오류를 던진다.
function sanitize(input) {
  if (!input || typeof input !== 'object') fail('조건 목록이 올바르지 않아요.');
  const out = {};
  const KIND = { comps: '문장 성분 조건', structs: '문장의 짜임 조건', topics: '공익광고 주제' };
  for (const kind of ['comps', 'structs', 'topics']) {
    const list = Array.isArray(input[kind]) ? input[kind] : [];
    if (list.length > MAX[kind]) fail(`${KIND[kind]}: ${MAX[kind]}개까지 만들 수 있어요.`);
    const used = new Set();
    const seenLabel = new Set();
    const items = [];
    for (const raw of list) {
      if (!raw || typeof raw !== 'object') continue;
      const label = oneLine(raw.label, kind === 'topics' ? 40 : 60);
      if (!label) fail(`${KIND[kind]} 중에 이름이 비어 있는 항목이 있어요. 이름을 쓰거나 그 항목을 지워 주세요.`);
      if (seenLabel.has(label)) { if (kind === 'topics') continue; fail(`${KIND[kind]}에 같은 이름('${label}')이 두 개 있어요.`); }
      seenLabel.add(label);
      let id = typeof raw.id === 'string' && /^[A-Za-z0-9_-]{1,24}$/.test(raw.id) && !used.has(raw.id) ? raw.id : '';
      if (!id) id = newId(used);
      used.add(id);
      if (kind === 'topics') {
        const it = { id, label };
        if (raw.off) it.off = true;
        items.push(it);
        continue;
      }
      const short = oneLine(raw.short, 200);
      if (!short) fail(`'${label}' 조건에 학생에게 보여 줄 안내 문장을 써 주세요.`);
      const it = {
        id, level: LEVELS.includes(raw.level) ? raw.level : 'easy', label, short,
        example: oneLine(raw.example, 200),
        rubric: multiLine(raw.rubric, 1000) || `조건: ${label}. ${short} 이 조건을 만족하는지 학교문법 기준으로 판단한다.`,
      };
      if (raw.off) it.off = true;
      items.push(it);
    }
    const needActive = kind !== 'comps' || ((input.seven && input.seven.mode) === 'preset');
    if (needActive && !items.some((x) => !x.off)) fail(`${KIND[kind]}: 켜 둔 항목이 최소 1개는 있어야 해요.`);
    out[kind] = items;
  }
  const sv = input.seven && typeof input.seven === 'object' ? input.seven : DEFAULT_SEVEN;
  const pool = PART_IDS.filter((id) => Array.isArray(sv.pool) && sv.pool.includes(id));
  if (!pool.length) fail('문장 성분: 출제할 성분을 하나 이상 골라 주세요.');
  let mn = parseInt(sv.min, 10), mx = parseInt(sv.max, 10);
  if (!(mn >= 1)) mn = 1; if (!(mx >= 1)) mx = mn;
  mn = Math.min(mn, pool.length); mx = Math.min(mx, pool.length);
  if (mn > mx) [mn, mx] = [mx, mn];
  out.seven = { mode: sv.mode === 'preset' ? 'preset' : 'seven', pool, min: mn, max: mx };
  return out;
}

function persist() {
  if (HOOK) { customized = true; HOOK.save(clone(state)); return; }
  if (!FILE) return;
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, FILE);
}

function init(file) {
  FILE = file;
  state = defaults();
  if (!FILE || !fs.existsSync(FILE)) return;
  try { state = sanitize(JSON.parse(fs.readFileSync(FILE, 'utf8'))); }
  catch (e) { console.warn('[조건] conditions.json 을 읽지 못해 기본 조건을 사용합니다:', e.userMessage || e.message); state = defaults(); }
}

// 저장소가 바뀌었을 때(다른 접속에서 고친 경우) 저장된 조건을 불러온다. null 이면 기본 조건.
function setHook(h) { HOOK = h; }
function load(obj) {
  customized = !!obj;
  if (!obj) { state = defaults(); return; }
  try { state = sanitize(obj); } catch (e) { state = defaults(); customized = false; }
}

function replace(input) { state = sanitize(input); persist(); return snapshot(); }
function reset() { state = defaults(); if (HOOK) { customized = false; HOOK.save(null); return snapshot(); } if (FILE && fs.existsSync(FILE)) fs.unlinkSync(FILE); return snapshot(); }
function snapshot() { return clone(state); }
function counts() {
  const n = (l) => l.filter((x) => !x.off).length;
  return { comps: n(state.comps), structs: n(state.structs), topics: n(state.topics), mode: state.seven.mode, sevenMin: state.seven.min, sevenMax: state.seven.max, sevenPool: state.seven.pool.length };
}
function isCustomized() { if (HOOK) return customized; return !!FILE && fs.existsSync(FILE); }

function byId(list, id) { return list.find((x) => x.id === id) || null; }

function isConflict(a, b) {
  return CONFLICTS.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

// level: 'easy' | 'basic' | 'mixed' . 꺼진 조건은 뽑지 않는다. 해당 난이도가 비어 있으면 켜진 전체에서 뽑는다.
function poolFor(list, level, rnd) {
  const act = list.filter((x) => !x.off);
  let pool;
  if (level === 'easy' || level === 'basic') pool = act.filter((x) => x.level === level);
  else pool = act.filter((x) => x.level === (rnd() < 0.5 ? 'easy' : 'basic'));
  return pool.length ? pool : act;
}

// rnd: () => [0,1) ; recent: { comps:[ids], structs:[ids], topics:[ids] } 최근에 나온 조건은 피한다
// bias: 'min'(쉽게: 성분 개수를 가장 적게) | 'max'(어렵게: 가장 많게) | 그 밖에는 설정한 범위에서 무작위
function drawParts(rnd, tries, bias) {
  const sv = state.seven;
  const n = bias === 'min' ? sv.min : bias === 'max' ? sv.max : sv.min + Math.floor(rnd() * (sv.max - sv.min + 1));
  const pool = sv.pool.slice();
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  let pick = pool.slice(0, Math.min(n, pool.length));
  // 보어는 '되다/아니다'의 성분이라 목적어와 한 문장에 넣기 어렵다. 가능하면 함께 뽑지 않는다.
  if (tries < 25 && pick.includes('compl') && pick.includes('obj')) return null;
  return 'p:' + PART_IDS.filter((x) => pick.includes(x)).join('+');
}

function draw(level, rnd, recent, bias, forcedStruct) {
  recent = recent || {};
  const topics = state.topics.filter((x) => !x.off);
  const seven = state.seven.mode === 'seven';
  for (let tries = 0; tries < 30; tries++) {
    const ss = poolFor(state.structs, level, rnd);
    const struct = (forcedStruct && byId(state.structs, forcedStruct)) || ss[Math.floor(rnd() * ss.length)];
    let comp;
    if (seven) {
      const pid = drawParts(rnd, tries, bias);
      if (!pid) continue;
      comp = { id: pid };
    } else {
      const cs = poolFor(state.comps, level, rnd);
      comp = cs[Math.floor(rnd() * cs.length)];
    }
    const topic = topics[Math.floor(rnd() * topics.length)];
    if (!seven && isConflict(comp.id, struct.id)) continue;
    if (tries < 20) {
      if ((recent.comps || []).includes(comp.id)) continue;
      if ((recent.structs || []).includes(struct.id)) continue;
      if ((recent.topics || []).includes(topic.id)) continue;
    }
    return { comp: comp.id, struct: struct.id, topic: topic.id };
  }
  const struct = (forcedStruct && byId(state.structs, forcedStruct)) || state.structs.find((x) => !x.off), topic = topics[0];
  const comp = seven ? { id: 'p:' + state.seven.pool[0] } : state.comps.find((x) => !x.off);
  return { comp: comp.id, struct: struct.id, topic: topic.id };
}

// 꺼 두거나 지워진 뒤에도, 이미 발급된 조건과 기록은 켜진 것과 똑같이 찾아 준다(지워진 것은 null).
function resolve(ids) {
  const comp = partCondition(ids.comp) || byId(state.comps, ids.comp);
  const struct = byId(state.structs, ids.struct);
  const topic = byId(state.topics, ids.topic);
  if (!comp || !struct || !topic) return null;
  return { comp, struct, topic };
}

// 학생에게 보여 줄 수 있는 형태 (rubric 제외)
function publicView(r) {
  const pick = (o) => ({ id: o.id, level: o.level, label: o.label, short: o.short, example: o.example });
  return {
    comp: pick(r.comp),
    struct: pick(r.struct),
    topic: { id: r.topic.id, label: r.topic.label },
  };
}

module.exports = { PARTS, init, setHook, load, snapshot, replace, reset, counts, isCustomized, draw, resolve, publicView, byId };
