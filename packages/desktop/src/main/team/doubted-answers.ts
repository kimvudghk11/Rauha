type Turn = { readonly input: string; readonly result: string };

/** 답이 "찾지 못함"류로 끝났음을 알리는 말 */
const NOT_FOUND = /찾지 못|찾을 수 없|못 찾|찾아지지 않|존재하지 않/;
/** 사용자가 앞 답이 틀렸다고 지적하는 말 */
const REFUTED = /틀렸|틀려|잘못 알|잘못됐|그게 아니/;

export const NOT_FOUND_MARK = '(이전에 찾지 못함: 다시 확인할 것)';
export const REFUTED_MARK = '(사용자가 틀렸다고 지적함: 다시 확인할 것)';

/**
 * 앞 대화를 다음 업무에 싣기 전에, 믿으면 안 되는 답을 걸러 내는 규칙.
 * 찾지 못했다고 끝난 답이나 사용자가 바로 다음 말에서 틀렸다고 한 답은 사실로 이어 가지 않고 "다시 확인할 것"으로만 남긴다.
 * 질문(input)과 턴 수·순서는 그대로다. 저장된 파일은 바꾸지 않는다(싣는 순간에만 적용).
 */
export class DoubtedAnswers {
  static mark<T extends Turn>(turns: readonly T[]): T[] {
    return turns.map((turn, i) => {
      if (NOT_FOUND.test(turn.result)) return { ...turn, result: NOT_FOUND_MARK };
      const next = turns[i + 1];
      if (next !== undefined && REFUTED.test(next.input)) return { ...turn, result: REFUTED_MARK };
      return turn;
    });
  }
}
