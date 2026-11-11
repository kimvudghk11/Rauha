import { execFile } from 'node:child_process';
import { lstat, mkdtemp, realpath, rm, rmdir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import type { FileChange, FileState } from '../../shared/checkpoint.js';
import type { DiffView } from '../../shared/git-api.js';
import { FileDiff } from '../../shared/git-diff.js';
import { BranchName, GitInputError, RepoPath } from '../../shared/git-guard.js';
import { mustGit, runGit } from './git-run.js';

/** 경로가 비밀 파일인가(core SecretPolicy) */
export type IsSecret = (relPath: string) => boolean;

const CONTROL = /[\u0000-\u001f\u007f]/;
const LITERAL = '--literal-pathspecs';

/** git 이 돌려주는 경로 중 안전한 것만(레포 안 상대 경로·제어문자 없음·.git 안쪽 아님) */
export function usablePath(path: string): boolean {
  if (path.endsWith('/') || CONTROL.test(path)) return false;
  try {
    RepoPath.parse(path);
    return true;
  } catch {
    return false;
  }
}

/** 바이트를 그대로 주고받는 git(패치 파일은 글자 변환을 거치면 안 된다) */
function rawGit(root: string, args: readonly string[], input?: Buffer): Promise<{ readonly code: number; readonly stdout: Buffer; readonly stderr: string }> {
  return new Promise((resolveRun, reject) => {
    const child = execFile('git', ['-c', 'core.quotepath=false', '-c', 'core.fsmonitor=false', ...args], { cwd: root, windowsHide: true, maxBuffer: 256 * 1024 * 1024, encoding: 'buffer', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (error, stdout, stderr) => {
      const e = error as (NodeJS.ErrnoException & { code?: number | string }) | null;
      if (e !== null && typeof e.code === 'string') return reject(new Error(e.code === 'ENOENT' ? 'git was not found. Check that git is installed.' : e.message));
      resolveRun({ code: e === null ? 0 : Number(e.code ?? 1), stdout: stdout as Buffer, stderr: (stderr as Buffer).toString('utf8') });
    });
    child.stdin?.end(input);
  });
}

/** 커밋 안 한 변경이 있는 경로들(이름 바꾸기는 지운 것+만든 것으로 따로 센다). git 이 없거나 레포가 아니면 null. */
export async function dirtyPaths(root: string): Promise<string[] | null> {
  const r = await runGit(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames']).catch(() => null);
  if (r === null || r.code !== 0) return null;
  return r.stdout
    .split('\0')
    .filter((e) => e.length > 3)
    .map((e) => e.slice(3));
}

async function headOf(root: string): Promise<string | null> {
  const r = await runGit(root, ['rev-parse', '--verify', '-q', 'HEAD']);
  const h = r.stdout.trim();
  return r.code === 0 && /^[0-9a-f]{40,64}$/.test(h) ? h : null;
}

async function branchOf(root: string): Promise<string | null> {
  const r = await runGit(root, ['symbolic-ref', '-q', '--short', 'HEAD']);
  if (r.code !== 0) return null;
  try {
    return BranchName.parse(r.stdout.trim()).value;
  } catch {
    return null;
  }
}

/**
 * base 트리에 paths 의 "지금 작업 폴더 내용"을 얹은 트리를 만든다(임시 인덱스라 진짜 인덱스·작업 폴더·브랜치는 건드리지 않는다).
 * base 가 null 이면 빈 트리에서 시작한다. 없어진 파일은 지운 것으로 담는다.
 */
export async function treeWith(root: string, base: string | null, paths: readonly string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'rauha-idx-'));
  const env = { GIT_INDEX_FILE: join(dir, 'index') };
  try {
    await mustGit2(root, base === null ? ['read-tree', '--empty'] : ['read-tree', base], env);
    if (paths.length > 0) {
      const add = await runGit(root, [LITERAL, 'add', '-A', '--pathspec-from-file=-', '--pathspec-file-nul'], paths.join('\0'), env);
      if (add.code !== 0) {
        // 한 경로가 걸려도 나머지는 담는다(무시 파일·사라진 파일 등)
        for (const p of paths) await runGit(root, [LITERAL, 'add', '-A', '--', p], undefined, env);
      }
    }
    return (await mustGit2(root, ['write-tree'], env)).trim();
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function mustGit2(root: string, args: readonly string[], env: Readonly<Record<string, string>>): Promise<string> {
  const r = await runGit(root, args, undefined, env);
  if (r.code !== 0) throw new Error((r.stderr.trim() || `git ${args[0]} failed`).split('\n').slice(0, 4).join('\n'));
  return r.stdout;
}

export interface StartBase {
  readonly head: string | null;
  readonly branch: string | null;
  readonly startTree: string | null;
  readonly startDirty: number;
}

/** 작업을 시작할 때의 기준을 잡는다. git 이 아니면 null. 비밀 파일은 트리에 담지 않는다. */
export async function captureStart(cwd: string, isSecret: IsSecret): Promise<StartBase | null> {
  const dirty = await dirtyPaths(cwd);
  if (dirty === null) return null;
  const head = await headOf(cwd);
  const visible = dirty.filter((p) => usablePath(p) && !isSecret(p));
  const startTree = await treeWith(cwd, head, visible).catch(() => null);
  return { head, branch: await branchOf(cwd), startTree, startDirty: dirty.length };
}

export interface EndState {
  readonly head: string | null;
  readonly endTree: string | null;
  /** 끝났을 때 커밋 안 한 비밀 파일 수(내용은 읽지 않는다) */
  readonly secretDirty: number;
}

export async function captureEnd(root: string, isSecret: IsSecret): Promise<EndState | null> {
  const dirty = await dirtyPaths(root);
  if (dirty === null) return null;
  const head = await headOf(root);
  const visible = dirty.filter((p) => usablePath(p) && !isSecret(p));
  return { head, endTree: await treeWith(root, head, visible).catch(() => null), secretDirty: dirty.filter((p) => usablePath(p) && isSecret(p)).length };
}

/** worktree 로 일한 작업이 남긴 브랜치 끝 커밋 */
export async function branchTip(root: string, branch: string): Promise<string | null> {
  const name = BranchName.parse(branch).value;
  const r = await runGit(root, ['rev-parse', '--verify', '-q', `refs/heads/${name}^{commit}`]);
  const h = r.stdout.trim();
  return r.code === 0 && /^[0-9a-f]{40,64}$/.test(h) ? h : null;
}

/** 두 트리(커밋) 사이에서 바뀐 파일과 줄 수. 비밀 파일과 안전하지 않은 경로는 뺀다. */
export async function listChanges(root: string, from: string, to: string, isSecret: IsSecret): Promise<{ readonly files: FileChange[]; readonly hidden: number }> {
  const names = await mustGit(root, ['diff', '--no-renames', '--name-status', '-z', from, to]);
  const nums = await mustGit(root, ['diff', '--no-renames', '--numstat', '-z', from, to]);
  const count = new Map<string, { added: number; removed: number; binary: boolean }>();
  for (const entry of nums.split('\0')) {
    const m = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(entry);
    if (m !== null) count.set(m[3]!, { added: m[1] === '-' ? 0 : Number(m[1]), removed: m[2] === '-' ? 0 : Number(m[2]), binary: m[1] === '-' });
  }
  const parts = names.split('\0');
  const files: FileChange[] = [];
  let hidden = 0;
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const status = parts[i]!;
    const path = parts[i + 1]!;
    if (!usablePath(path)) continue;
    if (isSecret(path)) {
      hidden += 1;
      continue;
    }
    const kind = status.startsWith('A') ? 'added' : status.startsWith('D') ? 'deleted' : 'modified';
    files.push({ path, kind, ...(count.get(path) ?? { added: 0, removed: 0, binary: false }) });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, hidden };
}

/** 한 파일의 diff(읽기 전용). 큰 diff 를 나눠 그리는 일은 화면이 한다. */
export async function fileDiff(root: string, from: string, to: string, path: string): Promise<DiffView> {
  const safe = RepoPath.parse(path).value;
  const text = await mustGit(root, [LITERAL, 'diff', '--no-renames', '--no-color', '--no-ext-diff', '-U3', from, to, '--', safe]);
  const d = FileDiff.parse(text);
  return { binary: d.isBinary(), hunks: d.hunks };
}

/** 트리 안 파일들의 내용 지문(blob 해시). 없으면 null. */
async function blobIds(root: string, tree: string, paths: readonly string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (paths.length === 0) return out;
  const r = await rawGit(root, [LITERAL, 'cat-file', '--batch-check'], Buffer.from(paths.map((p) => `${tree}:${p}\n`).join('')));
  const lines = r.stdout.toString('utf8').split('\n');
  paths.forEach((p, i) => {
    const m = /^([0-9a-f]{40,64}) blob /.exec(lines[i] ?? '');
    out.set(p, m === null ? null : m[1]!);
  });
  return out;
}

/** 작업 폴더에 있는 파일의 지금 지문. 없으면 null, 링크·폴더거나 레포 밖으로 나가면 'unreadable'. */
async function currentId(root: string, rootReal: string, path: string): Promise<string | null | 'unreadable'> {
  const abs = resolve(root, path);
  let info;
  try {
    info = await lstat(abs);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'ENOTDIR' ? null : 'unreadable';
  }
  if (!info.isFile()) return 'unreadable';
  const parent = await realpath(dirname(abs)).catch(() => null);
  if (parent === null || !(parent === rootReal || parent.startsWith(rootReal + sep))) return 'unreadable';
  const r = await runGit(root, [LITERAL, 'hash-object', '--', path]);
  const h = r.stdout.trim();
  return r.code === 0 && /^[0-9a-f]{40,64}$/.test(h) ? h : 'unreadable';
}

/** 되돌리기 계획에 쓸 파일 상태(시작·끝·지금) */
export async function fileStates(root: string, startTree: string, endTree: string, paths: readonly string[]): Promise<Record<string, FileState>> {
  const safe = paths.filter(usablePath);
  const rootReal = await realpath(root);
  const [start, end] = await Promise.all([blobIds(root, startTree, safe), blobIds(root, endTree, safe)]);
  const states: Record<string, FileState> = {};
  for (let i = 0; i < safe.length; i += 8) {
    await Promise.all(
      safe.slice(i, i + 8).map(async (p) => {
        states[p] = { start: start.get(p) ?? null, end: end.get(p) ?? null, now: await currentId(root, rootReal, p) };
      }),
    );
  }
  return states;
}

/**
 * 되돌리기 직전 내용을 담은 패치(지금 → 되돌리기 전 상태로 가는 방향이 아니라, 되돌린 뒤 상태에 적용하면 되돌리기 전이 되는 방향).
 * 비밀 파일은 paths 에 없다. 바이트 그대로 돌려준다.
 */
export async function backupPatch(root: string, startTree: string, paths: readonly string[]): Promise<Buffer> {
  const before = await treeWith(root, startTree, paths);
  const r = await rawGit(root, ['diff', '--binary', '--full-index', '--no-renames', '--no-color', '--no-ext-diff', startTree, before]);
  if (r.code !== 0) throw new Error(r.stderr.trim().split('\n').slice(0, 4).join('\n') || 'Could not make the backup.');
  return r.stdout;
}

async function insideRoot(root: string, abs: string): Promise<boolean> {
  const rootReal = await realpath(root);
  const parent = await realpath(dirname(abs)).catch(() => null);
  return parent !== null && (parent === rootReal || parent.startsWith(rootReal + sep));
}

/** 작업이 새로 만든 파일을 지운다. 링크·폴더·레포 밖 경로는 거절한다. 비게 된 폴더도 정리한다. */
export async function deleteCreated(root: string, path: string): Promise<void> {
  const rel = RepoPath.parse(path).value;
  const abs = resolve(root, rel);
  const info = await lstat(abs).catch(() => null);
  if (info === null) return;
  if (!info.isFile() || !(await insideRoot(root, abs))) throw new GitInputError(`This path cannot be removed: ${path}`);
  await unlink(abs);
  const rootReal = await realpath(root);
  let dir = (await realpath(dirname(abs)).catch(() => null)) ?? rootReal;
  while (dir.length > rootReal.length && dir.startsWith(rootReal + sep)) {
    try {
      await rmdir(dir);
    } catch {
      break;
    }
    dir = dirname(dir);
  }
}

/** 파일 하나를 작업 시작 때 내용으로 되돌린다(작업 폴더만, 인덱스·브랜치는 그대로). */
export async function restoreFile(root: string, startTree: string, path: string): Promise<void> {
  const rel = RepoPath.parse(path).value;
  const abs = resolve(root, rel);
  const info = await lstat(abs).catch(() => null);
  if (info !== null && (!info.isFile() || !(await insideRoot(root, abs)))) throw new GitInputError(`This path cannot be changed: ${path}`);
  await mustGit(root, [LITERAL, 'restore', `--source=${startTree}`, '--worktree', '--', rel]);
}

/** 백업 패치를 되돌린 작업 폴더에 다시 적용한다. 그 사이 파일이 바뀌었으면 아무것도 바꾸지 않고 이유를 돌려준다. */
export async function applyPatch(root: string, patch: Buffer): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: string }> {
  if (patch.length === 0) return { ok: true };
  const check = await rawGit(root, ['apply', '--check', '--binary', '-'], patch);
  if (check.code !== 0) return { ok: false, error: 'Some of these files changed after the undo, so the backup cannot be applied cleanly. Nothing was changed.' };
  const done = await rawGit(root, ['apply', '--binary', '-'], patch);
  return done.code === 0 ? { ok: true } : { ok: false, error: done.stderr.trim().split('\n').slice(0, 3).join('\n') || 'git apply failed' };
}

/** 작업 브랜치를 지운다. 브랜치 이름은 값 객체가 거르고, 현재 브랜치는 git 이 거절한다. */
export async function deleteBranch(root: string, branch: string): Promise<void> {
  const name = BranchName.parse(branch).value;
  await mustGit(root, ['branch', '-D', '--', name]);
}
