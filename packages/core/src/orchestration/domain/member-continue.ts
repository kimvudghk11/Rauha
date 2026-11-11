/**
 * 팀원 호출이 결과 없이 끝났을 때 같은 대화를 이어서 다시 부를지.
 * 턴 한도에 닿았거나 결과 형식만 못 맞춘 호출은 한 일이 대화에 남아 있으므로, 버리고 멈추는 대신 이어서 끝내게 한다.
 * SDK가 실제로 준 종료 이유만 본다(추론 없음).
 */

const TURN_LIMIT = new Set(['error_max_turns', 'max_turns']);
const FORMAT_FAILED = new Set(['success', 'completed', 'error_max_structured_output_retries', 'structured_output_retry_exhausted']);
/** 이어 하기는 호출 하나에 이만큼까지만(끝없이 돌지 않게) */
const MAX_CONTINUES = 2;

export interface MemberContinueInput {
  /** SDK의 terminal_reason, 없으면 subtype */
  readonly endReason: string;
  /** 정해진 형식의 결과를 받았는지 */
  readonly hasOutput: boolean;
  /** 이 호출에서 이미 이어 한 횟수 */
  readonly done: number;
}

export class MemberContinue {
  private constructor(
    readonly kind: 'resume-work' | 'format-only',
    /** 이어 부를 때 보내는 말 */
    readonly prompt: string,
  ) {}

  /** 이어 부를 일이 있으면 그 방법, 아니면 null */
  static after(input: MemberContinueInput): MemberContinue | null {
    if (input.hasOutput || input.done >= MAX_CONTINUES) return null;
    if (TURN_LIMIT.has(input.endReason)) {
      return new MemberContinue('resume-work', '턴 한도에 닿아 잠시 끊겼습니다. 이미 한 일은 다시 하지 말고, 남은 일을 이어서 끝낸 뒤 결과를 정해진 형식으로 내세요.');
    }
    if (FORMAT_FAILED.has(input.endReason)) {
      return new MemberContinue('format-only', '일은 끝났지만 결과가 정해진 형식으로 오지 않았습니다. 파일은 더 고치지 말고, 지금까지 한 일을 정해진 형식의 결과로만 정리해 내세요.');
    }
    return null;
  }
}
