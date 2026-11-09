import type { ChatSnapshot } from '@rauha/core';

/** 레포 하나에 이어 두는 앞 대화 턴 수 상한(라우터는 최근 몇 턴만 본다) */
export const MAX_KEPT_TURNS = 30;

/**
 * 같은 레포에서 업무마다 따로 돈 세션의 대화를 한 줄로 합치는 규칙.
 * 업무가 시작할 때 본 대화(base)를 기억해 두었다가, 끝났을 때 "새로 생긴 것"만 저장된 대화 뒤에 붙인다.
 * 그래서 동시에 돈 업무들이 서로의 대화를 덮어쓰지 않고, 끝난 순서대로 쌓인다.
 */
export class ConversationMerge {
  private constructor(
    private readonly baseTurns: number,
    private readonly baseCarried: ReadonlySet<string>,
  ) {}

  /** 초기화한 레포에 남기는 빈 저장본(대화·이어 일할 파일 없음) */
  static blank(savedAt: string): ChatSnapshot {
    return { version: 1, turns: [], carried: [], lastTitle: null, savedAt };
  }

  /** 이어 받을 대화도 파일도 없는 저장본이면 true */
  static isBlank(snapshot: ChatSnapshot): boolean {
    return snapshot.turns.length === 0 && snapshot.carried.length === 0;
  }

  /**
   * 같은 작업 공간의 다른 레포 대화를 이 레포 대화와 한 흐름으로 본 대화(없으면 null).
   * - 턴: 저장 시각이 이른 대화부터 통째로 잇고(같으면 이 레포가 뒤), 다른 레포 턴은 질문 앞에 `[레포 이름]`을 붙인다. 최근 MAX_KEPT_TURNS개
   * - 이어 일할 파일: 파일 경로는 레포 기준이라 이 레포 것만 쓴다
   */
  static alongside(own: ChatSnapshot | null, others: readonly { readonly name: string; readonly snapshot: ChatSnapshot }[]): ChatSnapshot | null {
    const parts = [
      ...others.map(({ name, snapshot }) => ({ snapshot, label: name as string | null })),
      ...(own !== null ? [{ snapshot: own, label: null as string | null }] : []),
    ].sort((a, b) => a.snapshot.savedAt.localeCompare(b.snapshot.savedAt));
    const turns = parts.flatMap(({ snapshot, label }) => snapshot.turns.map((t) => (label === null ? t : { input: `[${label}] ${t.input}`, result: t.result })));
    const carried = own?.carried ?? [];
    if (turns.length === 0 && carried.length === 0) return null;
    return { version: 1, turns: turns.slice(-MAX_KEPT_TURNS), carried, lastTitle: own?.lastTitle ?? null, savedAt: own?.savedAt ?? parts[parts.length - 1]?.snapshot.savedAt ?? '' };
  }

  /** 업무가 시작할 때 읽은 대화(없으면 null)로 규칙을 연다. */
  static startingFrom(base: ChatSnapshot | null): ConversationMerge {
    return new ConversationMerge(base?.turns.length ?? 0, new Set((base?.carried ?? []).map(([path]) => path)));
  }

  /**
   * 끝난 세션의 대화(final)를 지금 저장된 대화(stored, 없으면 null)에 합친 새 저장본.
   * - 턴: stored 뒤에 이 업무가 새로 만든 턴만, 최근 MAX_KEPT_TURNS개
   * - 파일: stored의 것에 final의 것을 얹는다(같은 파일이면 나중에 끝난 쪽). 이 업무가 시작할 때 있었는데 끝났을 때 없는 파일(지운 것)은 뺀다.
   */
  finishedWith(stored: ChatSnapshot | null, final: ChatSnapshot): ChatSnapshot {
    const added = final.turns.slice(this.baseTurns);
    const finalPaths = new Set(final.carried.map(([path]) => path));
    const removed = new Set([...this.baseCarried].filter((path) => !finalPaths.has(path)));
    const carried = new Map((stored?.carried ?? []).filter(([path]) => !removed.has(path)));
    for (const [path, value] of final.carried) carried.set(path, value);
    return {
      version: 1,
      turns: [...(stored?.turns ?? []), ...added].slice(-MAX_KEPT_TURNS),
      carried: [...carried],
      lastTitle: final.lastTitle ?? stored?.lastTitle ?? null,
      savedAt: final.savedAt,
    };
  }
}
