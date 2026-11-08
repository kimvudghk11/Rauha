import { DomainError } from '../../shared/domain-error.js';

export type Reversibility = 'easy' | 'medium' | 'hard';
const REVERSIBILITIES: readonly Reversibility[] = ['easy', 'medium', 'hard'];

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 4;
const CUSTOM_LIMIT = 400;
const REASON_LIMIT = 200;

export interface DirectionOptionInput {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly pros: readonly string[];
  readonly cons: readonly string[];
  readonly risk: string;
  readonly reversibility: Reversibility;
  /** 손댈 곳(파일이나 영역) */
  readonly touches: readonly string[];
}

export type DirectionOption = DirectionOptionInput;

/** 카드에서 사용자가 한 선택. goOn: 방향 비교까지만 하기로 했던 분석을 설계·계획까지 이어 가 달라는 뜻 */
export type DirectionAnswer =
  | { readonly kind: 'pick'; readonly id: string; readonly reason?: string; readonly goOn?: boolean }
  | { readonly kind: 'custom'; readonly text: string; readonly reason?: string; readonly goOn?: boolean };

const clean = (text: string | undefined): string | null => {
  const t = (text ?? '').trim().replace(/\s+/g, ' ');
  return t === '' ? null : t.slice(0, REASON_LIMIT);
};

/**
 * 사용자의 방향 선택: AI가 추천한 것, 사용자가 고른 것, 이유. 기록 탭의 "방향 비교"가 이것을 그대로 쓴다.
 * 이유는 사용자가 적은 것이다. 추천을 그대로 골랐고 이유를 안 적었으면 AI의 추천 이유를 쓴다.
 */
export class DirectionChoice {
  private constructor(
    readonly recommended: string,
    readonly chosen: string,
    readonly custom: boolean,
    readonly reason: string | null,
    /** 사용자가 설계·계획까지 이어 가 달라고 했는지 */
    readonly goOn: boolean,
  ) {}

  static of(p: { recommended: string; chosen: string; custom: boolean; reason: string | null; goOn: boolean }): DirectionChoice {
    return new DirectionChoice(p.recommended, p.chosen, p.custom, p.reason, p.goOn);
  }

  divergedFromAi(): boolean {
    return this.custom || this.recommended !== this.chosen;
  }
}

function checked(input: DirectionOptionInput): DirectionOption {
  const id = input.id.trim();
  const title = input.title.trim();
  if (id === '' || title === '') throw new DomainError('INVALID_INPUT', '방향에는 번호와 이름이 있어야 합니다.');
  if (!REVERSIBILITIES.includes(input.reversibility)) throw new DomainError('INVALID_INPUT', `${title}: 되돌리기 쉬움은 ${REVERSIBILITIES.join('·')} 중 하나여야 합니다.`);
  return {
    id,
    title,
    summary: input.summary.trim(),
    pros: input.pros.map((p) => p.trim()).filter((p) => p !== ''),
    cons: input.cons.map((c) => c.trim()).filter((c) => c !== ''),
    risk: input.risk.trim(),
    reversibility: input.reversibility,
    touches: input.touches.map((t) => t.trim()).filter((t) => t !== ''),
  };
}

/** 사용자에게 보여 줄 방향 2~4개와 AI 추천 하나 */
export class DirectionSet {
  private constructor(
    readonly options: readonly DirectionOption[],
    readonly recommendedId: string,
    readonly recommendedReason: string,
  ) {}

  static of(options: readonly DirectionOptionInput[], recommendedId: string, recommendedReason: string): DirectionSet {
    if (options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) throw new DomainError('INVALID_INPUT', `방향은 ${MIN_OPTIONS}개에서 ${MAX_OPTIONS}개까지 비교해야 합니다.`);
    const list = options.map(checked);
    if (new Set(list.map((o) => o.id)).size !== list.length) throw new DomainError('INVALID_INPUT', '방향 번호가 겹칩니다.');
    const id = recommendedId.trim();
    if (!list.some((o) => o.id === id)) throw new DomainError('INVALID_INPUT', '추천은 보여 주는 방향 중 하나여야 합니다.');
    const reason = recommendedReason.trim();
    if (reason === '') throw new DomainError('INVALID_INPUT', '추천 이유가 비어 있습니다.');
    return new DirectionSet(list, id, reason);
  }

  recommended(): DirectionOption {
    return this.options.find((o) => o.id === this.recommendedId)!;
  }

  /** 사용자의 답을 선택으로 바꾼다. 보여 주지 않은 방향이나 비어 있는 직접 쓴 방향은 거절한다. */
  choose(answer: DirectionAnswer): DirectionChoice {
    const recommended = this.recommended();
    const goOn = answer.goOn === true;
    const mine = clean(answer.reason);
    if (answer.kind === 'custom') {
      const text = answer.text.trim().replace(/\s+/g, ' ');
      if (text === '') throw new DomainError('INVALID_INPUT', '직접 쓴 방향이 비어 있습니다.');
      if (text.length > CUSTOM_LIMIT) throw new DomainError('INVALID_INPUT', `직접 쓴 방향은 ${CUSTOM_LIMIT}자까지입니다.`);
      return DirectionChoice.of({ recommended: recommended.title, chosen: text, custom: true, reason: mine, goOn });
    }
    const picked = this.options.find((o) => o.id === answer.id);
    if (picked === undefined) throw new DomainError('INVALID_INPUT', '보여 주지 않은 방향을 골랐습니다.');
    const same = picked.id === recommended.id;
    return DirectionChoice.of({ recommended: recommended.title, chosen: picked.title, custom: false, reason: mine ?? (same ? this.recommendedReason.slice(0, REASON_LIMIT) : null), goOn });
  }
}
