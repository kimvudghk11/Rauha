const ACTION = /(해\s?줘|해주세요|만들|고쳐|추가|수정|삭제|지워|바꿔|써\s?줘|작성|구현|리팩|정리해|돌려|실행|배포|생성|짜\s?줘|뽑아|지어)/;
const QUESTION = /(\?|？|뭐|왜|어떻게|어디|언제|누가|무엇|얼마|어떤|몇|차이|알려|설명|인가|일까|나요|까요|있어|없어|맞아)/;
/** 이 길이 이하의 짧은 말은 인사·맞장구로 본다 */
const SMALL_TALK_CHARS = 8;

/** 인사·맞장구처럼 저장소를 몰라도 답할 수 있는 짧은 말. 이런 말에는 저장소 지식(조사 팀원)을 읽지 않는다. */
export function isSmallTalk(input: string): boolean {
  const text = input.trim();
  return text.length <= SMALL_TALK_CHARS && !ACTION.test(text) && !QUESTION.test(text);
}

const REPO_WORDS = /폴더|디렉터리|디렉토리|구조|레포|저장소|파일|경로|\b(repo|repository|folder|directory|files?|path)\b|\w\.(ts|tsx|js|jsx|mjs|cjs|py|java|kt|go|rs|rb|php|cs|swift|sql|sh|css|scss|html|json|ya?ml|toml|md|mdx|txt)\b|\w\/\w|어디\s?(에|서|있|쯤)/i;

/** 요청이 이 저장소의 파일·폴더·구조를 가리키는지. 가리키면 지도 없이 가볍게 답하면 안 되고 직접 훑어야 한다. */
export function pointsAtRepository(input: string): boolean {
  return REPO_WORDS.test(input);
}

/** 질문에 얼마나 깊이 답할지. 저장소를 가리키는 말은 라우터가 light라 해도 deep, 인사는 가볍게, 그 밖에는 라우터 판정을 따른다. */
export function answerDepthOf(routed: 'light' | 'deep', input: string): 'light' | 'deep' {
  if (pointsAtRepository(input)) return 'deep';
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
