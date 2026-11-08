import type { IpcMain } from 'electron';
import { loadSecretPolicy, type SecretPolicy } from '@rauha/core';
import { CODE_IPC } from '../../shared/code-api.js';
import { CodeFiles } from './code-files.js';

/** 비밀 파일 규칙(.rauhaignore 포함)은 git을 불러 읽으므로 잠깐 기억해 둔다 */
const POLICY_TTL_MS = 10_000;

/** 코드 탭 IPC. 작업 폴더 밖·비밀 파일 판정은 core의 SecretPolicy를 그대로 쓴다. */
export function registerCodeIpc(ipc: Pick<IpcMain, 'handle'>, workFolder: () => string | null): CodeFiles {
  let cached: { dir: string; at: number; policy: SecretPolicy } | null = null;
  const policy = (): SecretPolicy | null => {
    const dir = workFolder();
    if (dir === null) return null;
    if (cached === null || cached.dir !== dir || Date.now() - cached.at > POLICY_TTL_MS) cached = { dir, at: Date.now(), policy: loadSecretPolicy(dir) };
    return cached.policy;
  };
  // 규칙을 못 읽으면 막는 쪽으로(읽는 쪽이 비밀 파일을 열어 주지 않게)
  const files = new CodeFiles({ root: workFolder, isSecret: (rel) => policy()?.isSecret(rel) ?? true });
  ipc.handle(CODE_IPC.tree, (_e, path: unknown) => files.tree(path));
  ipc.handle(CODE_IPC.read, (_e, path: unknown) => files.read(path));
  ipc.handle(CODE_IPC.write, (_e, req: unknown) => files.write(req));
  ipc.handle(CODE_IPC.stat, (_e, paths: unknown) => files.stat(paths));
  return files;
}
