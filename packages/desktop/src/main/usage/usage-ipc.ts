import type { IpcMain } from 'electron';
import { isRendererReason, USAGE_IPC, type UsageSnapshotView } from '../../shared/usage-api.js';
import { UsageService, type UsageSnapshot } from './usage-service.js';

export const toUsageView = (snap: UsageSnapshot): UsageSnapshotView => ({ session: snap.plan?.session ?? null, weekly: snap.plan?.weekly ?? null, readAt: snap.readAt });

/** 화면이 값을 달라고 하는 길. 알 수 없는 이유는 저장된 값만 돌려준다. */
export function registerUsageIpc(ipc: IpcMain, service: UsageService): void {
  ipc.handle(USAGE_IPC.snapshot, async (_e, reason: unknown) => toUsageView(isRendererReason(reason) ? await service.refresh(reason) : service.current()));
}
