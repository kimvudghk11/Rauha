/** 한도 읽기 서비스와 화면 사이의 약속. 돈(달러)은 없고 %와 읽은 시각만 오간다. */
import type { UsageView } from './ipc.js';
import type { ReadReason } from './usage-freshness.js';

export const USAGE_IPC = {
  /** 화면 → main: 지금 값을 달라(필요하면 새로 읽는다) */
  snapshot: 'usage:snapshot',
  /** main → 화면: 새 값이 읽혔다 */
  changed: 'usage:changed',
} as const;

/** 화면이 요청할 수 있는 이유(평소 간격과 일의 끝은 main이 정한다) */
export type RendererReadReason = Extract<ReadReason, 'focus' | 'settings-open'>;

/** 한도 값과 읽은 시각(epoch ms, 못 읽었으면 null) */
export interface UsageSnapshotView extends UsageView {
  readonly readAt: number | null;
}

export interface UsageBridge {
  /** reason을 주면 규칙에 따라 새로 읽고, 안 주면 저장된 값을 그대로 받는다 */
  snapshot(reason?: RendererReadReason): Promise<UsageSnapshotView>;
  onChanged(listener: (view: UsageSnapshotView) => void): void;
}

export const isRendererReason = (value: unknown): value is RendererReadReason => value === 'focus' || value === 'settings-open';
