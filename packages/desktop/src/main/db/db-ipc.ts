import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { IpcMain } from 'electron';
import { DB_IPC } from '../../shared/db-api.js';
import { checkSqliteFile } from './db-file.js';
import { DbService } from './db-service.js';
import { ConnectionsStore } from './db-store.js';
import { mysqlDriver, postgresDriver } from './server-drivers.js';
import { ServerEngine } from './server-engine.js';
import { safeStorageBox, type SafeStorageLike } from './server-passwords.js';
import { ProcessRunner } from './sqlite-runner.js';

declare const __DB_CHILD_SOURCE__: string | undefined;

export interface DbIpcDeps {
  /** 앱 데이터 폴더(저장한 파일 목록 JSON 이 여기에 있다) */
  readonly dataDir: string;
  /** 파일 고르기 창. 취소하면 null */
  readonly pickFile: () => Promise<string | null>;
  /** 저장 창을 열어 CSV 를 쓴다. 취소하면 null */
  readonly saveCsv: (fileName: string, text: string) => Promise<string | null>;
  readonly onQuit: (cleanup: () => void) => void;
  /** Electron safeStorage: 서버 비밀번호를 운영체제 암호화로 저장한다(못 쓰면 저장하지 않고 접속 때마다 묻는다) */
  readonly safeStorage: SafeStorageLike;
}

/** 자식 프로세스 코드: 빌드(scripts/build.mjs)가 sqlite-child 를 묶어 이 이름으로 넣어 준다 */
function childSource(): string {
  if (typeof __DB_CHILD_SOURCE__ === 'string') return __DB_CHILD_SOURCE__;
  throw new Error('The SQLite helper was not bundled into this build.');
}

/** DB 탭의 main 쪽: db:* 채널. SQLite 는 요청마다 따로 띄운 자식 프로세스에서 돌아가고, 시간이 지나면 프로세스째 멈춘다. MySQL·PostgreSQL 은 main 에서 드라이버로 접속하고, 시간이 지나면 연결째 끊는다. */
export function registerDbIpc(ipc: Pick<IpcMain, 'handle'>, deps: DbIpcDeps): DbService {
  const runner = new ProcessRunner({ execPath: process.execPath, childSource });
  const service = new DbService({
    store: new ConnectionsStore(join(deps.dataDir, 'db-connections.json')),
    runner,
    servers: new ServerEngine({ mysql: mysqlDriver, postgres: postgresDriver }),
    secrets: safeStorageBox(deps.safeStorage),
    checkFile: checkSqliteFile,
    pickFile: deps.pickFile,
    saveCsv: deps.saveCsv,
    newId: () => randomUUID(),
    now: () => Date.now(),
  });
  deps.onQuit(() => service.stopAll());
  ipc.handle(DB_IPC.list, () => service.list());
  ipc.handle(DB_IPC.addPath, (_e, req: unknown) => service.addPath(req));
  ipc.handle(DB_IPC.pick, () => service.pick());
  ipc.handle(DB_IPC.addServer, (_e, req: unknown) => service.addServer(req));
  ipc.handle(DB_IPC.editServer, (_e, req: unknown) => service.editServer(req));
  ipc.handle(DB_IPC.testServer, (_e, req: unknown) => service.testServer(req));
  ipc.handle(DB_IPC.unlock, (_e, req: unknown) => service.unlock(req));
  ipc.handle(DB_IPC.remove, (_e, id: unknown) => service.remove(id));
  ipc.handle(DB_IPC.tables, (_e, id: unknown) => service.tables(id));
  ipc.handle(DB_IPC.detail, (_e, req: unknown) => service.detail(req));
  ipc.handle(DB_IPC.graph, (_e, id: unknown) => service.graph(id));
  ipc.handle(DB_IPC.rows, (_e, req: unknown) => service.rows(req));
  ipc.handle(DB_IPC.query, (_e, req: unknown) => service.query(req));
  ipc.handle(DB_IPC.cancel, (_e, key: unknown) => service.cancel(key));
  ipc.handle(DB_IPC.exportCsv, (_e, req: unknown) => service.exportCsv(req));
  return service;
}
