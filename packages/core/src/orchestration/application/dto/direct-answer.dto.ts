/** 메인 채팅 Claude(원문 그대로)의 결과. 모양이 틀렸거나 빈 글이면 null(그때는 멈춘 이유·부분 결과를 보인다) */
export class DirectAnswerDto {
  private constructor() {}

  static read(output: unknown): string | null {
    if (typeof output !== 'object' || output === null) return null;
    const answer = (output as Record<string, unknown>)['answer'];
    return typeof answer === 'string' && answer.trim() !== '' ? answer.trim() : null;
  }
}
