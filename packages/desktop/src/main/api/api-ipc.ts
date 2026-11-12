import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { join } from 'node:path';
import type { IpcMain } from 'electron';
import { API_IPC } from '../../shared/api-ipc.js';
import { LocalTarget } from '../../shared/api-test.js';
import { sendPrepared } from './api-sender.js';
import { ApiService } from './api-service.js';
import { ApiProjectsStore, CollectionsStore, EnvironmentsStore, HistoryStore } from './api-store.js';
import { ApiTestService } from './api-test-service.js';
import { FsProjectReader } from './project-reader.js';

/** AI 시험에 쓰는 시간 제한(로컬 서버라 짧게) */
const TEST_TIMEOUT_MS = 15_000;

export interface ApiIpcDeps {
  /** 앱 데이터 폴더(컬렉션·환경·기록 JSON이 여기에 있다) */
  readonly dataDir: string;
  /** 저장 위치를 물어 파일로 쓴다. 취소하면 null */
  readonly saveFile: (fileName: string, text: string) => Promise<string | null>;
  /** 작업 폴더에서 찾은 프로젝트들(API 탭의 프로젝트 고르기 목록). 이 목록에 있는 경로만 읽는다 */
  readonly listProjects: () => Promise<readonly { readonly root: string; readonly name: string; readonly relative: string }[]>;
  /** AI 시험의 모델 호출(케이스 만들기, 수정 제안). 모델 출력 JSON 을 그대로 돌려준다 */
  readonly testModel: { readonly plan: (prompt: string) => Promise<unknown>; readonly fixes: (prompt: string) => Promise<unknown> };
  /** 시험 리포트(.md)를 저장 위치를 물어 쓴다. 취소하면 null */
  readonly saveReport: (fileName: string, text: string) => Promise<string | null>;
}

/** API 탭의 main 쪽: api:* 채널. 요청은 이 프로세스가 보낸다. */
export function registerApiIpc(ipc: Pick<IpcMain, 'handle'>, deps: ApiIpcDeps): ApiService {
  const collections = new CollectionsStore(join(deps.dataDir, 'api-collections.json'));
  const envs = new EnvironmentsStore(join(deps.dataDir, 'api-environments.json'));
  const reader = new FsProjectReader();
  const resolve = async (host: string): Promise<string[]> => (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);
  const service = new ApiService({
    collections,
    envs,
    history: new HistoryStore(join(deps.dataDir, 'api-history.json')),
    send: (prepared, signal) => sendPrepared(prepared, { signal, resolve }),
    newId: () => randomUUID(),
    now: () => new Date(),
    saveFile: deps.saveFile,
    projects: new ApiProjectsStore(join(deps.dataDir, 'api-projects.json')),
    reader,
    listProjects: deps.listProjects,
  });
  const tests = new ApiTestService({
    collections,
    envs,
    reader,
    // 같은 보내기(시간 제한·크기 상한)를 쓰되 이 컴퓨터 주소로만(리다이렉트 포함)
    send: (prepared, signal) => sendPrepared(prepared, { signal, resolve, timeoutMs: TEST_TIMEOUT_MS, stayOn: (url) => LocalTarget.isLocal(url) }),
    plan: deps.testModel.plan,
    fixes: deps.testModel.fixes,
    newId: () => randomUUID().slice(0, 8),
    now: () => new Date(),
    saveFile: deps.saveReport,
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
  ipc.handle(API_IPC.projectsList, () => service.listProjects());
  ipc.handle(API_IPC.projectsSync, (_e, req: unknown) => service.syncProject(req));
  ipc.handle(API_IPC.testsPlan, (_e, req: unknown) => tests.plan(req));
  ipc.handle(API_IPC.testsRun, (_e, req: unknown) => tests.run(req));
  ipc.handle(API_IPC.testsSave, (_e, planId: unknown) => tests.save(planId));
  return service;
}
