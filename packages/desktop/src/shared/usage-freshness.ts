/** 구독 한도를 언제 다시 읽을지, 읽은 지 얼마나 됐는지에 대한 순수 규칙. 시간은 모두 밀리초(epoch). */

/** 한도를 읽는 이유. interval은 평소 간격, 나머지는 사용자 동작이나 일의 끝. */
export type ReadReason = 'interval' | 'focus' | 'settings-open' | 'job-over';

/** 평소 읽는 간격(20~30초). 읽는 호출이 모델을 부르지 않아서 짧게 잡아도 된다. */
export const READ_EVERY_MS = 25_000;
/** 초점 같은 흔한 이벤트가 몰려도 이보다 자주 읽지 않는다. */
export const MIN_GAP_MS = 5_000;
/** 이보다 오래된 값은 "오래됨"으로 보인다(평소 간격의 세 배 남짓: 두 번 연속 못 읽은 셈). */
export const STALE_AFTER_MS = 75_000;

/** read: 지금 읽는다 / join: 이미 읽는 중이니 그 결과를 같이 받는다 / after: 읽는 중이 끝나면 한 번 더 읽는다 / skip: 읽지 않는다 */
export type ReadDecision = 'read' | 'join' | 'after' | 'skip';

export interface ReadContext {
  readonly reason: ReadReason;
  readonly lastReadAt: number | null;
  readonly inFlight: boolean;
  readonly now: number;
}

export function decideRead(ctx: ReadContext): ReadDecision {
  if (ctx.inFlight) return ctx.reason === 'job-over' ? 'after' : 'join';
  if (ctx.lastReadAt === null) return 'read';
  if (ctx.reason === 'settings-open' || ctx.reason === 'job-over') return 'read';
  const gap = ctx.reason === 'interval' ? READ_EVERY_MS : MIN_GAP_MS;
  return ctx.now - ctx.lastReadAt >= gap ? 'read' : 'skip';
}

/** 읽은 시각 → "방금 / n초 전 / n분 전 / n시간 전". 못 읽었으면 그렇게 말한다. */
export function ageText(readAt: number | null, now: number): string {
  if (readAt === null) return 'Not read yet';
  const seconds = Math.floor(Math.max(0, now - readAt) / 1000);
  if (seconds < 1) return 'Just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

export function isStale(readAt: number | null, now: number): boolean {
  return readAt === null || now - readAt > STALE_AFTER_MS;
}
