import type { UsageBridge, UsageSnapshotView } from '../shared/usage-api.js';
import { ageText, isStale } from '../shared/usage-freshness.js';

declare global {
  interface Window {
    readonly rauhaUsage?: UsageBridge;
  }
}

/** 상태 줄·설정이 같이 쓰는 한도 값. main이 읽어 주는 값 하나를 받아 나눠 준다. */
export interface UsageFeed {
  current(): UsageSnapshotView | null;
  subscribe(fn: (view: UsageSnapshotView) => void): () => void;
  /** 규칙에 따라 새로 읽고(방금 읽었거나 읽는 중이면 합쳐진다) 값을 돌려준다 */
  refresh(reason: 'focus' | 'settings-open'): Promise<UsageSnapshotView | null>;
}

export function createUsageFeed(bridge: UsageBridge | undefined = window.rauhaUsage): UsageFeed {
  let last: UsageSnapshotView | null = null;
  const listeners = new Set<(view: UsageSnapshotView) => void>();
  const take = (view: UsageSnapshotView): UsageSnapshotView => {
    last = view;
    for (const l of [...listeners]) l(view);
    return view;
  };
  bridge?.onChanged(take);
  void bridge?.snapshot().then(take).catch(() => undefined);
  return {
    current: () => last,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async refresh(reason) {
      if (bridge === undefined) return null;
      try {
        return take(await bridge.snapshot(reason));
      } catch {
        return last;
      }
    },
  };
}

/** 툴팁 글: 읽은 시각과, 오래됐으면 그 사실 */
export function usageTooltip(view: UsageSnapshotView | null, now = Date.now()): string {
  const readAt = view?.readAt ?? null;
  const base = `한도를 읽은 시각: ${ageText(readAt, now)}`;
  return isStale(readAt, now) && readAt !== null ? `${base} (오래된 값일 수 있어요)` : base;
}
