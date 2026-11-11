import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { IpcMain } from 'electron';
import { API_IPC } from '../../shared/api-ipc.js';
import { sendPrepared } from './api-sender.js';
import { ApiService } from './api-service.js';
import { CollectionsStore, EnvironmentsStore, HistoryStore } from './api-store.js';

export interface ApiIpcDeps {
  /** 앱 데이터 폴더(컬렉션·환경·기록 JSON이 여기에 있다) */
  readonly dataDir: string;
  /** 저장 위치를 물어 파일로 쓴다. 취소하면 null */
  readonly saveFile: (fileName: string, text: string) => Promise<string | null>;
}

/** API 탭의 main 쪽: api:* 채널. 요청은 이 프로세스가 보낸다. */
export function registerApiIpc(ipc: Pick<IpcMain, 'handle'>, deps: ApiIpcDeps): ApiService {
  const service = new ApiService({
    collections: new CollectionsStore(join(deps.dataDir, 'api-collections.json')),
    envs: new EnvironmentsStore(join(deps.dataDir, 'api-environments.json')),
    history: new HistoryStore(join(deps.dataDir, 'api-history.json')),
    send: (prepared, signal) => sendPrepared(prepared, { signal }),
    newId: () => randomUUID(),
    now: () => new Date(),
    saveFile: deps.saveFile,
  });
  ipc.handle(API_IPC.send, (_e, req: unknown) => service.send(req));
  ipc.handle(API_IPC.cancel, (_e, key: unknown) => (typeof key === 'string' ? service.cancel(key) : false));
  ipc.handle(API_IPC.collectionsGet, () => service.getCollections());
  ipc.handle(API_IPC.collectionsApply, (_e, op: unknown) => service.applyCollection(op));
  ipc.handle(API_IPC.envGet, () => service.getEnvs());
  ipc.handle(API_IPC.envApply, (_e, op: unknown) => service.applyEnv(op));
  ipc.handle(API_IPC.historyGet, () => service.getHistory());
  ipc.handle(API_IPC.historyRemove, (_e, id: unknown) => service.removeHistory(typeof id === 'string' ? id : ''));
  ipc.handle(API_IPC.historyClear, () => service.clearHistory());
  ipc.handle(API_IPC.import, (_e, req: unknown) => service.importText(req));
  ipc.handle(API_IPC.export, (_e, req: unknown, save: unknown) => service.exportItem(req, save === true));
  return service;
}
