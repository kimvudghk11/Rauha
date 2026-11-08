import type { IpcMain } from 'electron';
import type { TermEvent } from '../shared/terminal-api.js';
import { registerCodeIpc, type CodeShellDeps } from './code/code-ipc.js';
import { createSecretSource } from './code/secret-cache.js';
import { registerTerminalIpc } from './terminal/terminal-ipc.js';

export interface WorkbenchDeps extends CodeShellDeps {
  /** 작업 폴더(고르지 않았으면 null) */
  readonly workFolder: () => string | null;
  /** main → 화면 알림 */
  readonly send: (channel: string, event: TermEvent) => void;
  /** 앱이 꺼질 때 부를 정리 함수를 등록한다 */
  readonly onQuit: (cleanup: () => void) => void;
}

/** 코드 탭의 main 쪽: 파일 탐색·편집·git 표시·찾기(code:*)와 터미널(term:*). 둘이 같은 비밀 파일 규칙을 쓴다. */
export function registerWorkbench(ipc: Pick<IpcMain, 'handle'>, deps: WorkbenchDeps): void {
  const secrets = createSecretSource(deps.workFolder);
  registerCodeIpc(ipc, deps.workFolder, secrets, { trash: deps.trash, reveal: deps.reveal });
  const terminals = registerTerminalIpc(ipc, { workFolder: deps.workFolder, secrets, send: deps.send });
  deps.onQuit(() => terminals.disposeAll());
}
