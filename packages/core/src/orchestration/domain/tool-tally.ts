/** 팀원 호출 하나가 쓴 도구의 이름별 횟수. 입력 내용·경로는 비밀이 섞일 수 있어 담지 않는다. */
export interface ToolCount {
  readonly name: string;
  readonly count: number;
}

export class ToolTally {
  private readonly counts = new Map<string, number>();

  private constructor() {}

  static empty(): ToolTally {
    return new ToolTally();
  }

  /** 도구를 한 번 썼다고 센다. 빈 이름은 무시한다. */
  record(name: string): void {
    if (name === '') return;
    this.counts.set(name, (this.counts.get(name) ?? 0) + 1);
  }

  /** 많이 쓴 순서, 같으면 처음 쓴 순서 */
  entries(): ToolCount[] {
    return [...this.counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  }

  /** 사람이 읽는 한 줄: "Grep 3 · Read 5". 쓴 도구가 없으면 빈 글. */
  static line(tools: readonly ToolCount[]): string {
    return tools.map((t) => `${t.name} ${t.count}`).join(' · ');
  }

  /** 화면에 보일 한 줄. 도구를 쓰지 않았거나 모으지 못했으면 없다(작은 말 대화에 "없음" 소음을 만들지 않는다). */
  static shownLine(tools: readonly ToolCount[] | undefined): string | undefined {
    const line = ToolTally.line(tools ?? []);
    return line === '' ? undefined : line;
  }
}
