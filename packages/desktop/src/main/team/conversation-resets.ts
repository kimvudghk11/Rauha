/** 레포 하나에서 업무가 시작한 뒤 대화가 초기화됐는지 알려 주는 표식 */
export class ResetMark {
  constructor(
    private readonly count: () => number,
    private readonly seen: number,
  ) {}

  /** 업무가 시작한 뒤 초기화가 있었으면 true */
  isStale(): boolean {
    return this.count() !== this.seen;
  }

  /** 초기화 뒤에 늦게 끝난 업무는 옛 대화를 되살리지 않도록 건너뛴다. 아니면 run을 돈다. */
  async ifCurrent(run: () => Promise<void>): Promise<void> {
    if (!this.isStale()) await run();
  }
}

/**
 * 레포별 "대화 초기화" 횟수. 시각 대신 횟수를 세어, 같은 밀리초에 일어난 초기화와 업무 시작도 순서가 갈린다.
 * 업무는 시작할 때 watch()로 표식을 받고, 끝날 때 표식이 낡았으면(초기화가 있었으면) 결과를 합치지 않는다.
 */
export class ConversationResets {
  private readonly counts = new Map<string, number>();

  private static keyOf(root: string): string {
    return root.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  }

  reset(root: string): void {
    const key = ConversationResets.keyOf(root);
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
  }

  watch(root: string): ResetMark {
    const key = ConversationResets.keyOf(root);
    return new ResetMark(() => this.counts.get(key) ?? 0, this.counts.get(key) ?? 0);
  }
}
