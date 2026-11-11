/** 한글 글자 앞뒤 경계: "이어폰"·"아까운"처럼 다른 낱말의 일부는 지시어가 아니다. */
const START = '(?:^|[^가-힣A-Za-z])';
const PARTICLE = '(?:는|도|의|를|만|에|엔)?';
const END = '(?![가-힣])';
const CONTINUE_VERB = '(?:해|하|진행|작업|계속|마저|줘|주세요|부탁|가자|가줘)';

const PATTERNS: readonly RegExp[] = [
  new RegExp(`${START}(?:아까|방금|저번|지난번|조금 전|좀 전)${PARTICLE}${END}`),
  new RegExp(`${START}그거${PARTICLE}${END}`),
  new RegExp(String.raw`${START}이어서\s*(?:좀\s*)?(?:${CONTINUE_VERB}|$)`),
  new RegExp(String.raw`${START}이어\s*(?:서\s*)?(?:좀\s*)?(?:${CONTINUE_VERB})`),
  /(?:^|[^가-힣])마저\s*(?:해|하|진행|끝|완성|만들|고쳐|작업|줘|$)/,
  /하던\s*(?:거|것|작업|일)|하다\s*(?:만|말|가)\s*(?:거|것|작업|일)/,
  /계속\s*(?:해|하자|진행|이어)/,
  /\b(?:where we left off|pick up where|continue (?:with )?(?:that|it|the (?:previous|last|earlier))\b|keep going|carry on|finish (?:that|what we)|resume (?:that|it|the work)|as (?:we )?discussed (?:earlier|before)|from earlier)\b/i,
];

const NOTICE = '이어서 할 작업을 찾지 못했어요. 무엇을 이어서 할지 한 줄로 알려 주세요(예: 로그인 잠금 기능 마저 해줘).';

/**
 * "아까 그거 이어서 해줘"처럼 지난 작업·앞 대화를 가리키는 요청. 가리킬 대상이 하나도 없으면
 * 팀을 돌려 봐야 엉뚱한 곳을 고치거나 아무 변경 없이 끝나므로, 호출 없이 바로 되묻는다.
 */
export class PastReference {
  private constructor() {}

  /** 지시어("이어서", "아까", "그거", "where we left off" …)가 들어 있는지 */
  static in(text: string): boolean {
    return PATTERNS.some((p) => p.test(text));
  }

  /** 지난 일을 가리키는데(라우터 판정 또는 지시어) 앞 대화도 고를 지난 작업도 없는지 */
  static lacksTarget(input: { readonly text: string; readonly refersToPast: boolean; readonly hasConversation: boolean; readonly hasPastWork: boolean }): boolean {
    if (input.hasConversation || input.hasPastWork) return false;
    return input.refersToPast || PastReference.in(input.text);
  }

  static notice(): string {
    return NOTICE;
  }
}
