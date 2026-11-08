import type { PlanUsage } from '@rauha/core';
import { decideRead, type ReadReason } from '../../shared/usage-freshness.js';

/** 한도 값과 그것을 읽은 시각(epoch ms). 아직 못 읽었으면 둘 다 null. */
export interface UsageSnapshot {
  readonly plan: PlanUsage | null;
  readonly readAt: number | null;
}

export interface UsageServiceDeps {
  /** 실제로 한도를 읽는 호출(실패하면 null) */
  readonly read: () => Promise<PlanUsage | null>;
  readonly now: () => number;
  /** 새 값이 읽힐 때마다 */
  readonly onChange: (snapshot: UsageSnapshot) => void;
}

/**
 * 구독 한도를 읽는 유일한 곳. 상태 줄·설정·한도 막대·새 작업 시작 판단이 모두 이 값을 받는다.
 * 읽는 중에 온 요청은 합치고, 방금 읽었으면 다시 부르지 않는다. 읽기에 실패하면 예전 값과 시각을 그대로 둔다.
 */
export class UsageService {
  private snapshot: UsageSnapshot = { plan: null, readAt: null };
  private inFlight: Promise<UsageSnapshot> | null = null;
  private failure: string | null = null;

  constructor(private readonly deps: UsageServiceDeps) {}

  current(): UsageSnapshot {
    return this.snapshot;
  }

  refresh(reason: ReadReason): Promise<UsageSnapshot> {
    const decision = decideRead({ reason, lastReadAt: this.snapshot.readAt, inFlight: this.inFlight !== null, now: this.deps.now() });
    switch (decision) {
      case 'skip':
        return Promise.resolve(this.snapshot);
      case 'join':
        return this.inFlight!;
      case 'after':
        return this.inFlight!.then(() => this.start());
      case 'read':
        return this.start();
    }
  }

  /** 진단용: 마지막 성공 시각(epoch ms)과, 마지막 읽기가 실패였다면 그 이유 */
  health(): { readonly readAt: number | null; readonly failure: string | null } {
    return { readAt: this.snapshot.readAt, failure: this.failure };
  }

  private start(): Promise<UsageSnapshot> {
    if (this.inFlight !== null) return this.inFlight;
    let thrown: string | null = null;
    const run = this.deps
      .read()
      .catch((error: unknown) => {
        thrown = error instanceof Error ? error.message : String(error);
        return null;
      })
      .then((plan) => {
        this.failure = plan !== null ? null : (thrown ?? '값을 받지 못했어요(시간 초과이거나 로그인·실행 파일 문제일 수 있어요)');
        if (plan !== null) {
          this.snapshot = { plan, readAt: this.deps.now() };
          this.deps.onChange(this.snapshot);
        }
        return this.snapshot;
      })
      .finally(() => {
        this.inFlight = null;
      });
    this.inFlight = run;
    return run;
  }
}
