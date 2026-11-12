/** git 팀원(publisher) 보고 → 답. 끝냈다고 분명히 말하지 않은 보고는 끝내지 못한 것으로 본다. */
export class PublishReportDto {
  private constructor(
    readonly answer: string,
    readonly commands: readonly string[],
    /** 시킨 커밋·push·PR을 모두 마쳤는지. 막혔거나 일부만 했으면 false */
    readonly finished: boolean,
  ) {}

  static read(input: unknown): PublishReportDto {
    const o = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
    const text = typeof o['answer'] === 'string' ? o['answer'].trim() : '';
    if (text === '') return new PublishReportDto('git 팀원의 보고를 읽지 못했어요. `git status`와 `git log -1`로 커밋됐는지 확인해 주세요.', [], false);
    const commands = Array.isArray(o['commands']) ? o['commands'].filter((c): c is string => typeof c === 'string' && c.trim() !== '').map((c) => c.trim()) : [];
    return new PublishReportDto(text, commands, o['finished'] === true);
  }

  /** 보고와, 실행한 명령 목록(무엇이 돌았는지 사용자가 볼 수 있게). */
  toAnswer(): string {
    return this.commands.length === 0 ? this.answer : `${this.answer}\n\n■ 실행한 명령\n${this.commands.map((c) => `- ${c}`).join('\n')}`;
  }
}
