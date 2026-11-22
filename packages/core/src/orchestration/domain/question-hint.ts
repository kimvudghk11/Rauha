const ACTION = /(해\s?줘|해주세요|만들|고쳐|추가|수정|삭제|지워|바꿔|써\s?줘|작성|구현|리팩|정리해|돌려|실행|배포|생성|짜\s?줘|뽑아|지어)/;
const QUESTION = /(\?|？|뭐|왜|어떻게|어디|언제|누가|무엇|얼마|어떤|몇|차이|알려|설명|인가|일까|나요|까요|있어|없어|맞아)/;
/** 이 길이 이하의 짧은 말은 인사·맞장구로 본다 */
const SMALL_TALK_CHARS = 8;

/** 인사·맞장구처럼 저장소를 몰라도 답할 수 있는 짧은 말. 이런 말에는 저장소 지식(조사 팀원)을 읽지 않는다. */
export function isSmallTalk(input: string): boolean {
  const text = input.trim();
  return text.length <= SMALL_TALK_CHARS && !ACTION.test(text) && !QUESTION.test(text);
}

const HELLO = new Set(['ㅎㅇ', 'ㅎ2', '하2', '하이루', '방가','안녕', '안녕하세요', '안녕하십니까', '안뇽', '하이', '하잉', '헬로', '반가워', '반가워요', '반갑습니다', 'hi', 'hello', 'hey', 'helo', 'good morning']);
const THANKS = new Set(['고마워', '고마워요', '고맙습니다', '감사', '감사해', '감사해요', '감사합니다', 'ㄳ', 'ㄱㅅ', '땡큐', '땡스', 'thanks', 'thank you', 'thx', 'ty']);
const BYE = new Set(['잘자', '잘자요', '잘가', '잘가요', '바이', 'ㅂㅇ', 'ㅂㅂ', 'ㅃㅇ', 'ㅃㅃ', 'ㅂ2', '바2', '빠2','굿밤', '굿나잇', 'bye', 'good night', '수고', '수고해', '수고하세요', '수고했어', '수고했어요', '수고하셨습니다']);

/** 인사로 읽을 모양들: 그대로, 웃음 꼬리 뗀 것, "~용→~요", 존댓말 꼬리 "요" 뗀 것, 되풀이("ㅎㅇㅎㅇ"·"감사감사") 하나로, 영어 꼬리("there"·"u") 정리 */
function greetingForms(input: string): string[] {
  const plain = input.trim().toLowerCase().replace(/[!~.^?,]+/gu, '').replace(/\s+/g, ' ').trim();
  // "안녕ㅎㅎ", "고마워ㅋㅋ" 처럼 끝에 붙은 웃음은 뗀다("ㅎㅇ"는 ㅇ 으로 끝나 그대로다)
  const word = (plain.replace(/[ㅋㅎ]+$/u, '') || plain).replace(/ there$/, '').replace(/ u$/, ' you');
  const single = word.replace(/^(.+?)\1+$/u, '$1');
  return [...new Set([plain, word, single, word.replace(/용$/u, '요'), word.replace(/[요용]$/u, '')])];
}

/**
 * 정해 둔 인사·감사·작별 인사면 모델 없이 바로 할 답(2026-11-21 사용자: "ㅎㅇ만 보내도 세션을 1% 먹는다").
 * "응·ㅇㅇ·진행"처럼 앞 대화에 대한 대답일 수 있는 말이나, 인사에 다른 말이 붙은 것은 null(라우터가 판단한다).
 */
export function greetingReply(input: string): string | null {
  const forms = greetingForms(input);
  const is = (set: ReadonlySet<string>) => forms.some((form) => set.has(form));
  if (is(HELLO)) return '안녕하세요! 무엇을 도와드릴까요?';
  if (is(THANKS)) return '천만에요. 더 필요한 게 있으면 말씀해 주세요.';
  if (is(BYE)) return '수고하셨어요. 또 불러 주세요.';
  return null;
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
