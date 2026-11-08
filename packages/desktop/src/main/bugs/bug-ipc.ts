import { homedir, release, userInfo } from 'node:os';
import type { IpcMain } from 'electron';
import { BUG_IPC, type BugStateJson } from '../../shared/bug-api.js';
import { usableRepoNames, type RedactContext } from '../../shared/blog-redact.js';
import type { AwsInput } from '../../shared/bug-sync.js';
import { AwsTarget } from '../../shared/bug-sync.js';
import { BugService } from './bug-service.js';
import type { BugStorePort } from './bug-store.js';
import type { S3Port } from './s3-port.js';

export interface BugIpcDeps {
  readonly store: BugStorePort;
  readonly newId: () => string;
  readonly appVersion: () => string;
  /** 설정의 AWS 네 칸 */
  readonly aws: () => AwsInput;
  readonly folderNames: () => readonly string[];
  readonly companyNames: () => readonly string[];
  readonly connect: (target: AwsTarget) => S3Port;
  readonly platform: NodeJS.Platform;
  readonly onChange: (state: BugStateJson) => void;
}

/**
 * 답답한 점 IPC. 좁은 채널 다섯 개뿐이고, AWS 자격은 이 안(main)에서만 쓰이며 화면으로는 메모·결과 글만 오간다.
 * 가림에 쓸 이름(회사·레포·사용자·홈 경로)은 main이 모아 준다.
 */
export function registerBugIpc(ipc: Pick<IpcMain, 'handle'>, deps: BugIpcDeps): BugService {
  const service = new BugService({
    store: deps.store,
    newId: deps.newId,
    now: () => new Date().toISOString(),
    env: () => ({ appVersion: deps.appVersion(), os: `${deps.platform} ${release()}` }),
    aws: deps.aws,
    redactContext: (): RedactContext => {
      let userName = '';
      try {
        userName = userInfo().username;
      } catch {
        userName = '';
      }
      return { repoNames: usableRepoNames(deps.folderNames()), companyNames: deps.companyNames(), userName, homePath: homedir() };
    },
    connect: deps.connect,
    onChange: deps.onChange,
  });
  ipc.handle(BUG_IPC.get, () => service.get());
  ipc.handle(BUG_IPC.apply, (_e, op: unknown) => service.apply(op));
  ipc.handle(BUG_IPC.preview, () => service.preview());
  ipc.handle(BUG_IPC.upload, (_e, digest: unknown) => service.upload(typeof digest === 'string' ? digest : ''));
  ipc.handle(BUG_IPC.download, () => service.download());
  return service;
}
