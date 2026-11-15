import type { LimitWindow } from './notice-text.js';

/** 한도가 풀린 뒤 조금 기다렸다 맡긴다(풀리는 시각 바로는 아직 막힐 수 있다) */
const MARGIN_MS = 60_000;

/** 한도·사용량 때문에 멈춘 작업인지(코어·SDK 가 남기는 멈춘 이유로 판단) */
export function isLimitStop(reason: string | null): boolean {
  return /limit|한도|rate.?limit|quota|usage/i.test(reason ?? '');
}

/**
 * 다시 맡길 시각. 다 쓴(100%) 한도가 있으면 그중 가장 늦게 풀리는 때 + 1분,
 * 다 쓴 한도가 없으면 지금(이미 풀렸다), 다 썼는데 풀리는 때를 모르면 null.
 */
export function retryTime(u: { session: LimitWindow | null; weekly: LimitWindow | null } | null, now: Date): Date | null {
  if (u === null) return null;
  const full = [u.session, u.weekly].filter((w): w is LimitWindow => w !== null && w.percent >= 100);
  if (full.length === 0) return now;
  const times = full.map((w) => (w.resetsAt === null ? NaN : Date.parse(w.resetsAt)));
  if (times.some((t) => !Number.isFinite(t))) return null;
  return new Date(Math.max(...times) + MARGIN_MS);
}

export interface LimitRetry {
  readonly jobId: string;
  readonly request: string;
  readonly at: Date;
}

/** 한도가 풀리면 다시 맡길 작업들(불변). 작업마다 하나 */
export class LimitRetries {
  private constructor(private readonly items: readonly LimitRetry[]) {}

  static empty(): LimitRetries {
    return new LimitRetries([]);
  }

  schedule(jobId: string, request: string, at: Date): LimitRetries {
    return new LimitRetries([...this.items.filter((i) => i.jobId !== jobId), { jobId, request, at }]);
  }

  cancel(jobId: string): LimitRetries {
    return new LimitRetries(this.items.filter((i) => i.jobId !== jobId));
  }

  /** 때가 된 것과 남은 것 */
  due(now: Date): { readonly due: readonly LimitRetry[]; readonly rest: LimitRetries } {
    return { due: this.items.filter((i) => i.at.getTime() <= now.getTime()), rest: new LimitRetries(this.items.filter((i) => i.at.getTime() > now.getTime())) };
  }

  get size(): number {
    return this.items.length;
  }

  /** 화면에 보낼 모양: 작업 id → 다시 맡길 시각(ISO) */
  view(): Readonly<Record<string, string>> {
    return Object.fromEntries(this.items.map((i) => [i.jobId, i.at.toISOString()]));
  }
}
