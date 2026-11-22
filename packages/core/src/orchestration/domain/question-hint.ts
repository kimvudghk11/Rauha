const ACTION = /(해\s?줘|해주세요|만들|고쳐|추가|수정|삭제|지워|바꿔|써\s?줘|작성|구현|리팩|정리해|돌려|실행|배포|생성|짜\s?줘|뽑아|지어)/;
const QUESTION = /(\?|？|뭐|왜|어떻게|어디|언제|누가|무엇|얼마|어떤|몇|차이|알려|설명|인가|일까|나요|까요|있어|없어|맞아)/;
/** 이 길이 이하의 짧은 말은 인사·맞장구로 본다 */
const SMALL_TALK_CHARS = 8;

/** 인사·맞장구처럼 저장소를 몰라도 답할 수 있는 짧은 말. 이런 말에는 저장소 지식(조사 팀원)을 읽지 않는다. */
export function isSmallTalk(input: string): boolean {
  const text = input.trim();
  return text.length <= SMALL_TALK_CHARS && !ACTION.test(text) && !QUESTION.test(text);
}

type Greeting = 'hello' | 'thanks' | 'bye';

/** 인사 말 목록. 변형(늘인 말·말끝·숫자 줄임·되풀이·띄어쓰기)은 canonGreeting 이 같은 모양으로 맞춰 주므로 기본형만 둔다. */
const GREETING_WORDS: Record<Greeting, readonly string[]> = {
  hello: [
    'ㅎㅇ', 'ㅎㅇ염', '안녕', '안녕하세요', '안녕하십니까', '안뇽', '안냥', '하이', '하잉', '하이루', '헬로', '헬로우', '방가', '반가워', '반갑다', '반갑습니다', '반가워요',
    '좋은 아침', '좋은아침이에요', '굿모닝', '굿모닝요', '좋은 저녁', '좋은 오후', '오랜만', '오랜만이야', '오랜만이에요', '오랜만입니다', '왔어', '나 왔어', '다녀왔어', '다녀왔습니다', '출근했어', '출근', '일어났어',
    'hi', 'hello', 'hey', 'helo', 'hiya', 'howdy', 'yo', 'sup', 'hey there', 'hi there', 'hello there', 'good morning', 'morning', 'good afternoon', 'good evening', 'gm',
  ],
  thanks: [
    '고마워', '고마워요', '고맙다', '고맙습니다', '고마웡', '감사', '감사해', '감사해요', '감사합니다', '감사링', '감사드립니다', '감사드려요', '정말 고마워', '진짜 고마워', '너무 고마워', '정말 감사합니다', '진짜 감사', '덕분에', '덕분이야', '덕분이에요',
    'ㄳ', 'ㄱㅅ', 'ㄱㅅㅇ', 'ㄳㅇ', '땡큐', '땡스', '쌩큐', '쌩유', '떙큐',
    'thanks', 'thank you', 'thank u', 'thx', 'ty', 'tysm', 'thanks a lot', 'thank you so much', 'thanks so much', 'many thanks', 'cheers', 'appreciate it',
  ],
  bye: [
    '안녕히 가세요', '안녕히 계세요', '안녕히 주무세요', '잘자', '잘 자','잘자요', '잘 자요', '잘가', '잘 가', '잘가요', '잘 있어', '잘있어', '바이', '바이바이', '빠이', 'ㅂㅇ', 'ㅂㅂ', 'ㅃㅇ', 'ㅃㅃ', '굿밤', '굿나잇', '굿나잇요',
    '수고', '수고해', '수고하세요', '수고했어', '수고했어요', '수고하셨습니다', '수고하셨어요', '수고 많았어', '수고 많았어요', '수고 많으셨습니다', '고생했어', '고생했어요', '고생하셨습니다', '고생 많았어',
    '다음에 봐', '또 봐', '내일 봐', '나중에 봐', '이따 봐', '퇴근', '퇴근할게', '퇴근합니다', '들어갈게', '먼저 갈게', '잘게', '자러 갈게', '이만', '이만 갈게',
    'bye', 'bye bye', 'goodbye', 'good night', 'gn', 'see you', 'see ya', 'cya', 'later', 'see you later', 'good bye',
  ],
};

/** 인사 앞뒤에 붙는 부르는 말("델피야 안녕", "안녕 여러분") — 떼고 본다 */
const ADDRESS = /^(델피|라우하|rauha|delfi|팀장|클로드|claude|여러분|다들|모두|님|형|누나|언니|오빠|선배|친구)(야|아|님|씨|들)?$/u;

/**
 * 인사 말 하나를 비교용 기본형으로: 소문자·띄어쓰기 없앰 → 숫자 줄임(ㅎ2→ㅎㅇ, 하2→하이) →
 * 말끝(여·염·욤·용→요, 당→다, 웡→워) → 같은 글자 늘임(하이이이·ㅎㅇㅇ·hiii) 하나로 → 되풀이(ㅎㅇㅎㅇ·감사감사) 하나로.
 */
function canonGreeting(word: string): string {
  const flat = word.toLowerCase().replace(/\s+/g, '').replace(/(.)\1+/gu, '$1');
  const digits = flat.replace(/([ㄱ-ㅎ])2/gu, '$1ㅇ').replace(/([가-힣])2/gu, '$1이');
  const endings = digits.replace(/(여|염|욤|용)$/u, '요').replace(/당$/u, '다').replace(/웡$/u, '워');
  const stretched = endings.replace(/(.)\1+/gu, '$1');
  return stretched.replace(/^(.+?)\1+$/u, '$1');
}

const GREETING_KIND = new Map<string, Greeting>();
for (const kind of ['bye', 'thanks', 'hello'] as const) {
  for (const word of GREETING_WORDS[kind]) {
    GREETING_KIND.set(canonGreeting(word), kind);
    // "~요" 존댓말 꼬리는 있어도 없어도 같은 인사다
    if (!/요$/u.test(word) && /[가-힣ㄱ-ㅎ]$/u.test(word))GREETING_KIND.set(canonGreeting(`${word}요`), kind);
  }
}

/** 인사 문장을 말 조각으로: 이모지·이모티콘(^^ :) ㅠㅠ)·문장 부호를 걷어 내고, 웃음(ㅋㅋ·ㅎㅎ)만 있는 조각과 부르는 말을 뺀다 */
function greetingTokens(input: string): string[] {
  const bare = input
    .toLowerCase()
    .replace(/[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}️‍]/gu, ' ')
    .replace(/[:;]-?[)(dp]|\^[_.-]?\^|[ㅠㅜ]+|<3/gu, ' ')
    .replace(/[!~.?,;:'"`()[\]{}…·*+=_\-^|/\\]+/gu, ' ');
  return bare
    .split(/\s+/)
    .filter((token) => token.length > 0 && !/^[ㅋㅎ]{2,}$/u.test(token))
    // "안녕ㅎㅎ", "고마워ㅋㅋ" 처럼 끝에 붙은 웃음은 뗀다("ㅎㅇ"·"ㅎ2"는 ㅇ·2 로 끝나 그대로다)
    .map((token) => token.replace(/(?<=.)[ㅋㅎ]{2,}$|(?<=[가-힣a-z])[ㅋㅎ]+$/u, ''))
    .filter((token) => !/^[ㅋㅎ]{2,}$/u.test(token) && !ADDRESS.test(token))
    .map((token) => token.replace(/^(델피|라우하)(야|아|님)?(?=.)/u, ''));
}

/** 말 조각들을 앞에서부터 인사 말(한 조각 또는 이어진 여러 조각)로 남김없이 나눌 수 있으면 그 인사들, 아니면 null */
function splitGreetings(tokens: readonly string[]): Greeting[] | null {
  if (tokens.length === 0) return [];
  for (let take = Math.min(tokens.length, 4); take >= 1; take -= 1) {
    const kind = GREETING_KIND.get(canonGreeting(tokens.slice(0, take).join('')));
    if (!kind) continue;
    const rest = splitGreetings(tokens.slice(take));
    if (rest) return [kind, ...rest];
  }
  return null;
}

/**
 * 인사·감사·작별 인사로만 된 말이면 모델 없이 바로 할 답(2026-11-21 사용자: "ㅎㅇ만 보내도 세션을 1% 먹는다",
 * 11-22 "ㅎ2는 못 읽는구만 — 이런 걸 제대로 다 체크해야지"). 변형은 규칙(canonGreeting)으로 맞추고,
 * "ㅎㅇ 반가워"·"고마워 수고했어"처럼 인사끼리 이어진 것도 받는다.
 * "응·ㅇㅇ·진행"처럼 앞 대화에 대한 대답일 수 있는 말이나, 인사에 다른 말(물음·시킴)이 붙은 것은 null(라우터가 판단한다).
 */
export function greetingReply(input: string): string | null {
  const tokens = greetingTokens(input);
  if (tokens.length === 0 || tokens.length > 8) return null;
  const kinds = splitGreetings(tokens);
  if (!kinds || kinds.length === 0) return null;
  if (kinds.includes('bye')) return '수고하셨어요. 또 불러 주세요.';
  if (kinds.includes('thanks')) return '천만에요. 더 필요한 게 있으면 말씀해 주세요.';
  return '안녕하세요! 무엇을 도와드릴까요?';
}

const REPO_WORDS = /폴더|디렉터리|디렉토리|구조|레포|저장소|파일|경로|\b(repo|repository|folder|directory|files?|path)\b|\w\.(ts|tsx|js|jsx|mjs|cjs|py|java|kt|go|rs|rb|php|cs|swift|sql|sh|css|scss|html|json|ya?ml|toml|md|mdx|txt)\b|\w\/\w|어디\s?(에|서|있|쯤)/i;

/** 레포 방식을 가리키는 일반 개념(모노레포·멀티레포·폴리레포). 이 말 속의 "레포"는 이 저장소가 아니다. */
const REPO_CONCEPTS = /(모노|멀티|폴리)\s?레포|\b(mono|multi|poly)-?repos?\b/gi;

/** 요청이 이 저장소의 파일·폴더·구조를 가리키는지. 가리키면 지도 없이 가볍게 답하면 안 되고 직접 훑어야 한다. */
export function pointsAtRepository(input: string): boolean {
  return REPO_WORDS.test(input.replace(REPO_CONCEPTS, ' '));
}

const ARCHITECTURE = /구성|구조|설계|아키텍[처쳐]|모노\s?레포|멀티\s?레포|폴리\s?레포|(레포|저장소|서비스|모듈|프로젝트|패키지|앱).{0,12}(합치|합칠|통합|나누|나눌|쪼개|분리)|(합치|합칠|통합|나누|나눌|쪼개|분리).{0,12}(레포|저장소|서비스|모듈|프로젝트|패키지|앱)|마이크로\s?서비스|전환할|마이그레이션|도입할|확장성|트레이드\s?오프|\bvs\.?\b|\b(architect\w*|monorepo|polyrepo|microservices?|trade-?offs?|scalability)\b/i;

/**
 * 구성·설계·합치기·나누기·전환·비교 같은 아키텍처 질문인지. 이런 질문은 갈라진 저장소를 합치는지, 새로 짜는지, 어떤 스택·배포 환경인지에 따라
 * 답이 달라서(2026-11-21 사용자: "무조건 모노는 아니야, 찢어진 걸 모노로 만들 수도 있고 다양한 환경에서") 일반론으로 가볍게 답하지 않는다.
 */
export function asksArchitecture(input: string): boolean {
  return ARCHITECTURE.test(input);
}

/**
 * 질문에 얼마나 깊이 답할지. 이 저장소를 가리키거나 아키텍처 질문이면 깊게, 인사는 가볍게, 나머지는 라우터 판단을 따른다.
 * (2026-11-21 사용자: 간단한 질문까지 깊게 돌려 세션을 크게 쓰지 말고, 일마다 알맞게 나눠 툭툭 끝낼 것)
 */
export function answerDepthOf(routed: 'light' | 'deep', input: string): 'light' | 'deep' {
  if (pointsAtRepository(input) || asksArchitecture(input)) return 'deep';
  return isSmallTalk(input) ? 'light' : routed;
}

const PROCEED = /^\s*(그래도|그냥)\s*(진행|해\s?줘|해|할게|실행)/;

/** 한도 때문에 미뤄 둔 요청을 "그래도 진행"이라고 해서 되살리는 말인지 */
export function wantsToProceed(input: string): boolean {
  return PROCEED.test(input);
}

/** 같은 질문인지 가르는 열쇠. 공백과 대소문자 차이는 무시한다. */
export function sameQuestionKey(input: string): string {
  return input.trim().replace(/\s+/g, ' ').toLowerCase();
}

const DOC_WORDS = /\.(md|mdx|txt|rst)\b|readme|changelog|license|\bdocs\/|문서|포트폴리오|이력서/i;
const CODE_WORDS = /\.(ts|tsx|js|jsx|mjs|cjs|py|java|kt|go|rs|rb|php|c|cpp|cs|swift|sql|sh|css|scss|html|json|ya?ml|toml)\b|함수|클래스|메서드|테스트|코드|버그|컴포넌트|\b(function|class|method|bug|test|code)\b|[A-Za-z]\w*\.[a-z]\w*\(?\s*[가-힣]*(가|이)\s/i;

/** 요청이 문서(마크다운 등)만 가리키고 코드는 가리키지 않는지. 문서와 코드를 함께 말하면 false. */
export function onlyDocuments(input: string): boolean {
  return DOC_WORDS.test(input) && !CODE_WORDS.test(input);
}
