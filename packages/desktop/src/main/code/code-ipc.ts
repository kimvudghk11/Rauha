import type { IpcMain } from 'electron';
import { discoverRepos, loadSecretPolicy, type SecretPolicy } from '@rauha/core';
import { CODE_IPC } from '../../shared/code-api.js';
import { runGit } from '../git/git-run.js';
import { CodeFiles } from './code-files.js';
import { CodeGit } from './code-git.js';

/** 비밀 파일 규칙(.rauhaignore 포함)과 레포 목록은 git을 불러 읽으므로 잠깐 기억해 둔다 */
const CACHE_TTL_MS = 10_000;

/** 코드 탭 IPC. 작업 폴더 밖·비밀 파일 판정은 core의 SecretPolicy를 그대로 쓴다. */
export function registerCodeIpc(ipc: Pick<IpcMain, 'handle'>, workFolder: () => string | null): CodeFiles {
  let cached: { dir: string; at: number; policy: SecretPolicy } | null = null;
  const policy = (): SecretPolicy | null => {
    const dir = workFolder();
    if (dir === null) return null;
    if (cached === null || cached.dir !== dir || Date.now() - cached.at > CACHE_TTL_MS) cached = { dir, at: Date.now(), policy: loadSecretPolicy(dir) };
    return cached.policy;
  };
  let repoCache: { dir: string; at: number; repos: string[] } | null = null;
  const repos = (): string[] => {
    const dir = workFolder();
    if (dir === null) return [];
    if (repoCache === null || repoCache.dir !== dir || Date.now() - repoCache.at > CACHE_TTL_MS) repoCache = { dir, at: Date.now(), repos: discoverRepos(dir) };
    return repoCache.repos;
  };
  // 규칙을 못 읽으면 막는 쪽으로(읽는 쪽이 비밀 파일을 열어 주지 않게)
  const files = new CodeFiles({ root: workFolder, isSecret: (rel) => policy()?.isSecret(rel) ?? true });
  const git = new CodeGit({ files, repos, run: (root, args) => runGit(root, args) });
  ipc.handle(CODE_IPC.tree, (_e, path: unknown) => files.tree(path));
  ipc.handle(CODE_IPC.read, (_e, path: unknown) => files.read(path));
  ipc.handle(CODE_IPC.write, (_e, req: unknown) => files.write(req));
  ipc.handle(CODE_IPC.stat, (_e, paths: unknown) => files.stat(paths));
  ipc.handle(CODE_IPC.changes, () => git.changes());
  ipc.handle(CODE_IPC.diff, (_e, path: unknown) => git.diff(path));
  ipc.handle(CODE_IPC.search, (_e, options: unknown) => files.searchAll(options));
  ipc.handle(CODE_IPC.files, () => files.listFiles());
  return files;
}
