/** 팀원 호출이 일을 다 마치지 못하고 멈춘 이유. SDK가 실제로 준 종료 이유와 거절 목록만 쓴다(추론 없음). */

const TURN_LIMIT = new Set(['error_max_turns', 'max_turns']);
const BUDGET_LIMIT = new Set(['error_max_budget_usd', 'budget_exhausted']);
const RETRY_LIMIT = new Set(['error_max_structured_output_retries', 'structured_output_retry_exhausted']);
/** 정상 종료, 그리고 우리 쪽 오류('error': 오류 문자열이 따로 간다)는 SDK가 준 멈춤 이유가 아니다. */
const NOT_A_STOP = new Set(['success', 'completed', 'error']);
const PARTIAL_CHARS = 1200;
const RESUME_HINT = "'이어서'라고 하면 앞에 한 일을 보고 계속해요.";

export interface MemberStopInput {
  /** SDK의 terminal_reason, 없으면 subtype */
  readonly endReason: string;
  /** "도구: 입력" 꼴의 거절 목록 */
  readonly denials: readonly string[];
  readonly turns: number;
}

export class MemberStop {
  private constructor(
    private readonly endReason: string,
    private readonly denied: ReadonlyMap<string, number>,
    private readonly turns: number,
  ) {}

  /** 한도·거절·SDK 오류로 멈췄으면 그 이유, 아니면 null */
  static of(input: MemberStopInput): MemberStop | null {
    const denied = new Map<string, number>();
    for (const d of input.denials) {
      const tool = d.split(':')[0]!.trim() || '도구';
      denied.set(tool, (denied.get(tool) ?? 0) + 1);
    }
    return NOT_A_STOP.has(input.endReason) && denied.size === 0 ? null : new MemberStop(input.endReason, denied, input.turns);
  }

  /** 사람이 읽는 한두 문장 */
  sentence(): string {
    const parts: string[] = [];
    if (TURN_LIMIT.has(this.endReason)) parts.push(`일을 ${this.turns}턴 하다가 턴 한도에 닿아 멈췄어요. ${RESUME_HINT}`);
    else if (BUDGET_LIMIT.has(this.endReason)) parts.push(`이번 호출에 정해 둔 사용량 한도에 닿아 멈췄어요. ${RESUME_HINT}`);
    else if (RETRY_LIMIT.has(this.endReason)) parts.push('결과를 정해진 형식으로 정리하지 못하고 멈췄어요.');
    else if (!NOT_A_STOP.has(this.endReason)) parts.push(`작업이 중간에 끝났어요(종료 이유: ${this.endReason}).`);
    if (this.denied.size > 0) parts.push(`${[...this.denied].map(([tool, n]) => `${tool} 호출 ${n}번`).join(', ')}이 허락되지 않아 거절됐어요.`);
    return parts.join(' ');
  }

  /** 사용자에게 보일 글: 멈춘 이유 + SDK가 준 부분 결과(있으면) */
  report(partial: string | null): string {
    const text = partial?.trim() ?? '';
    return text === '' ? this.sentence() : `${this.sentence()}\n\n그때까지 알아낸 것\n${text.slice(0, PARTIAL_CHARS)}`;
  }

  /** 다음 대화(<conversation>)에 남기는 글: '이어서'가 이유와 마지막 일을 볼 수 있게 */
  turnNote(partial: string | null): string {
    const text = partial?.trim() ?? '';
    return text === '' ? this.sentence() : `${this.sentence()} 마지막으로 한 일: ${text.slice(-PARTIAL_CHARS)}`;
  }
}
