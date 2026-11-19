/** 작업 상태(작업판과 같은 값) */
export type BadgeJobStatus = 'queued' | 'running' | 'waiting' | 'done' | 'stopped';

const FINISHED: ReadonlySet<BadgeJobStatus> = new Set(['done', 'stopped']);
const MAX_SHOWN = 99;

/**
 * 카톡처럼 "안 본 것" 빨간 배지. 사용자가 창을 보고 있지 않을 때 끝난(완료·멈춤) 작업을 안 본 것으로 세고,
 * 기다리는 허락은 늘 센다. 창을 보면(초점) 끝난 작업은 본 것이 된다. 값은 불변이고, 바꾸는 메서드는 새 값을 돌려준다.
 */
export class UnreadBadge {
  private constructor(
    private readonly last: ReadonlyMap<string, BadgeJobStatus>,
    private readonly unseen: ReadonlySet<string>,
  ) {}

  static empty(): UnreadBadge {
    return new UnreadBadge(new Map(), new Set());
  }

  /** 작업판이 바뀌었다. focused: 지금 사용자가 창을 보고 있는지. 처음 보는 작업이 이미 끝나 있으면(앱을 다시 켬) 세지 않는다. */
  observe(jobs: readonly { readonly id: string; readonly status: BadgeJobStatus }[], focused: boolean): UnreadBadge {
    const unseen = new Set([...this.unseen].filter((id) => jobs.some((j) => j.id === id)));
    for (const j of jobs) {
      const before = this.last.get(j.id);
      const justFinished = FINISHED.has(j.status) && before !== undefined && !FINISHED.has(before);
      if (justFinished && !focused) unseen.add(j.id);
      if (!FINISHED.has(j.status)) unseen.delete(j.id);
    }
    return new UnreadBadge(new Map(jobs.map((j) => [j.id, j.status])), unseen);
  }

  /** 사용자가 창을 봤다: 끝난 작업은 모두 본 것 */
  seen(): UnreadBadge {
    return this.unseen.size === 0 ? this : new UnreadBadge(this.last, new Set());
  }

  /** 배지 숫자: 안 본 끝난 작업 + 기다리는 허락 */
  count(pending: number): number {
    return this.unseen.size + Math.max(0, pending);
  }

  /** 배지 글자: 없으면 빈 글, 99 넘으면 "99+" */
  static label(count: number): string {
    if (count <= 0) return '';
    return count > MAX_SHOWN ? `${MAX_SHOWN}+` : String(count);
  }

  /** 메뉴 막대 아이콘에 카톡처럼 빨간 N 을 얹을지: 안 본 것이 있거나 일이 도는(진행·기다림·대기) 동안 */
  static trayMarked(count: number, jobs: readonly { readonly status: BadgeJobStatus }[]): boolean {
    return count > 0 || jobs.some((j) => !FINISHED.has(j.status));
  }
}
