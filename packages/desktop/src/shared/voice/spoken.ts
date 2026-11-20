/**
 * 받아쓰기 모델(Whisper)이 내놓은 글을 다듬는다: 이름 부름 떼기, 조용할 때 지어내는 말 거르기, 취소 말 알아듣기.
 * "델피"는 흔한 낱말이 아니라 받아쓰기가 "테일피아"·"델비"처럼 적기도 해서 비슷한 표기를 넓게 받는다.
 */
const FILLER = '(?:(?:야|저기|헤이|어이|hey|오케이|ok)[\\s,~!.]*)?';
const NAME = '(?:델\\s*피|델\\s*삐|댈\\s*피|델\\s*비|텔\\s*피|테일\\s*피|데일\\s*피|델\\s*프|델\\s*파이|델\\s*휘|delfi|delphi|delpi|delfy)';
const CALL = new RegExp(`^\\s*${FILLER}${NAME}(?:야|아|씨|님|이)?(?=$|[\\s,~!.?…])[\\s,~!.?…]*`, 'i');

const HALLUCINATIONS: readonly RegExp[] = [
  /^(시청해\s*주셔서\s*)?감사합니다[.!]*$/,
  /구독.*좋아요|좋아요.*구독/,
  /MBC\s*뉴스|KBS\s*뉴스|SBS\s*뉴스/i,
  /자막\s*(제공|제작)/,
  /다음\s*(영상|시간)에서\s*만나요/,
];

const CANCEL_WORDS = new Set(['취소', '취소해', '그만', '됐어', '됐어요', '아니야', '아냐', '아니', '괜찮아', '아무것도', '없어']);

export class SpokenText {
  private constructor(private readonly text: string) {}

  static of(text: string): SpokenText {
    return new SpokenText(text.replace(/\s+/g, ' ').trim());
  }

  /** 말할 거리가 없는 말(빈 말·점만·받아쓰기 모델이 지어낸 말) */
  get isEmpty(): boolean {
    if (/^[\s.,!?…~\-]*$/.test(this.text)) return true;
    return HALLUCINATIONS.some((r) => r.test(this.text));
  }

  /** "취소", "아니야 됐어" 처럼 부른 것을 물리는 말 */
  get isCancel(): boolean {
    const words = this.text.replace(/[.,!?…~]/g, ' ').split(' ').filter((w) => w !== '');
    return words.length > 0 && words.every((w) => CANCEL_WORDS.has(w));
  }

  /** 앞에서 이름을 불렀는지, 불렀다면 이름 뒤의 말 */
  afterName(): { readonly called: boolean; readonly rest: string } {
    const m = CALL.exec(this.text);
    if (m === null) return { called: false, rest: this.text };
    return { called: true, rest: this.text.slice(m[0].length).trim() };
  }

  /** 팀에 맡길 글: 앞뒤 공백과 끝 마침표 하나만 정리한다 */
  forTask(): string {
    return this.text.replace(/\.$/, '').trim();
  }
}
