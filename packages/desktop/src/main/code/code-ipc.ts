import type { IpcMain } from 'electron';
import { discoverRepos } from '@rauha/core';
import { scanWorkFolder } from '../workspace/scan.js';
import { CODE_IPC } from '../../shared/code-api.js';
import { runGit } from '../git/git-run.js';
import { CodeFiles } from './code-files.js';
import { CodeGit } from './code-git.js';
import { FileOps } from './file-ops.js';
import type { SecretSource } from './secret-cache.js';

/** 레포 목록은 git을 불러 읽으므로 잠깐 기억해 둔다 */
const REPO_TTL_MS = 10_000;

/** 코드 탭 IPC. 작업 폴더 밖·비밀 파일 판정은 core의 SecretPolicy를 그대로 쓴다. */
export interface CodeShellDeps {
  /** 휴지통으로 보낸다(shell.trashItem) */
  readonly trash: (absPath: string) => Promise<void>;
  /** 파일 관리자에서 보여 준다(shell.showItemInFolder) */
  readonly reveal: (absPath: string) => void;
}

export function registerCodeIpc(ipc: Pick<IpcMain, 'handle'>, workFolder: () => string | null, secrets: SecretSource, shell: CodeShellDeps): CodeFiles {
  let repoCache: { dir: string; at: number; repos: string[] } | null = null;
  const repos = (): string[] => {
    const dir = workFolder();
    if (dir === null) return [];
    if (repoCache === null || repoCache.dir !== dir || Date.now() - repoCache.at > REPO_TTL_MS) repoCache = { dir, at: Date.now(), repos: discoverRepos(dir) };
    return repoCache.repos;
  };
  // 규칙을 못 읽으면 막는 쪽으로(읽는 쪽이 비밀 파일을 열어 주지 않게)
  const files = new CodeFiles({ root: workFolder, isSecret: (rel) => secrets.policy()?.isSecret(rel) ?? true });
  const git = new CodeGit({ files, repos, run: (root, args) => runGit(root, args) });
  // 앱이 작업 폴더에서 찾은 레포·문서 폴더의 루트는 이름 바꾸기·삭제·옮기기를 막는다(.git이 든 폴더는 따로 항상 막는다)
  let rootsCache: { dir: string; at: number; roots: Promise<string[]> } | null = null;
  const protectedRoots = (): Promise<string[]> => {
    const dir = workFolder();
    if (dir === null) return Promise.resolve([]);
    if (rootsCache === null || rootsCache.dir !== dir || Date.now() - rootsCache.at > REPO_TTL_MS) {
      rootsCache = { dir, at: Date.now(), roots: scanWorkFolder(dir).then((found) => found.map((e) => e.root), () => []) };
    }
    return rootsCache.roots;
  };
  const ops = new FileOps({ files, trash: shell.trash, reveal: shell.reveal, protectedRoots });
  ipc.handle(CODE_IPC.create, (_e, req: unknown) => ops.create(req as never));
  ipc.handle(CODE_IPC.rename, (_e, req: unknown) => ops.rename(req as never));
  ipc.handle(CODE_IPC.trash, (_e, req: unknown) => ops.trash(req as never));
  ipc.handle(CODE_IPC.duplicate, (_e, req: unknown) => ops.duplicate(req as never));
  ipc.handle(CODE_IPC.move, (_e, req: unknown) => ops.move(req as never));
  ipc.handle(CODE_IPC.inspect, (_e, req: unknown) => ops.inspect(req as never));
  ipc.handle(CODE_IPC.reveal, (_e, req: unknown) => ops.reveal(req as never));
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
