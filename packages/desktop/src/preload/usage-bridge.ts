import { contextBridge, ipcRenderer } from 'electron';
import { USAGE_IPC, type UsageBridge, type UsageSnapshotView } from '../shared/usage-api.js';

/** 한도 값 받기. window.rauhaUsage로 열린다. */
export function exposeUsageBridge(): void {
  const bridge: UsageBridge = {
    snapshot: (reason) => ipcRenderer.invoke(USAGE_IPC.snapshot, reason),
    onChanged: (listener) => {
      ipcRenderer.on(USAGE_IPC.changed, (_e, view: UsageSnapshotView) => listener(view));
    },
  };
  contextBridge.exposeInMainWorld('rauhaUsage', bridge);
}
