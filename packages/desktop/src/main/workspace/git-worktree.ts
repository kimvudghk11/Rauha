import { execFile } from 'node:child_process';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { RepoConventions } from '../../shared/repo-conventions.js';

const run = promisify(execFile);
const git = (cwd: string, args: readonly string[]) => run('git', [...args], { cwd, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });

/** 작업 브랜치 이름: 어느 작업의 결과인지 알 수 있게 작업 id 앞 8자를 쓴다 */
export const jobBranch = (jobId: string): string => `rauha/job-${jobId.replace(/[^A-Za-z0-9]/g, '').slice(0, 8)}`;

/**
 * 이 레포의 기존 브랜치·커밋 이름 방식을 읽는다. 내 이름(git user.name)으로 쓴 최근 커밋을 먼저 보고, 적으면 모두의 커밋을 본다.
 * 읽지 못하면 기본값(예전 rauha/job-…)이다.
 */
export async function readConventions(repo: string): Promise<RepoConventions> {
  try {
    const lines = (out: string) => out.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '');
    const branches = lines((await git(repo, ['branch', '-a', '--format=%(refname:short)'])).stdout);
    const me = (await git(repo, ['config', 'user.name']).catch(() => ({ stdout: '' }))).stdout.trim();
    const log = async (extra: string[]) => lines((await git(repo, ['log', '--all', '-n', '50', '--no-merges', '--format=%s', ...extra]).catch(() => ({ stdout: '' }))).stdout);
    const mine = me === '' ? [] : await log([`--author=${me}`]);
    const subjects = mine.length >= 5 ? mine : await log([]);
    return RepoConventions.infer(branches, subjects);
  } catch {
    return RepoConventions.default();
  }
}

/** 같은 이름의 브랜치가 이미 있으면 -2, -3 … 을 붙여 겹치지 않게 한다. */
async function freeBranchName(repo: string, wanted: string): Promise<string> {
  for (let n = 1; n < 50; n += 1) {
    const name = n === 1 ? wanted : `${wanted}-${n}`;
    const exists = await git(repo, ['rev-parse', '--verify', '-q', `refs/heads/${name}`]).then(() => true, () => false);
    if (!exists) return name;
  }
  return `${wanted}-${Date.now()}`;
}

/** 레포 원래 폴더에서 갈라져 나오는 worktree를 만든다(지금 HEAD 기준, 분리된 상태). */
export async function addWorktree(repo: string, path: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  await git(repo, ['worktree', 'add', '--detach', path, 'HEAD']);
}

/**
 * 작업이 끝난 worktree를 정리한다. 바뀐 내용이 있으면 먼저 작업 브랜치(rauha/job-…)에 커밋해 남기고(그래야 합치는 건 허락 흐름으로 할 수 있다),
 * 그 뒤 worktree 폴더를 지운다. 남긴 브랜치 이름을 돌려주고, 바뀐 게 없었으면 null이다.
 */
export async function finishWorktree(repo: string, path: string, jobId: string, message: string): Promise<string | null> {
  let kept: string | null = null;
  try {
    const { stdout } = await git(path, ['status', '--porcelain']);
    if (stdout.trim() !== '') {
      const conv = await readConventions(repo);
      const branch = await freeBranchName(repo, conv.branchName(message, jobId));
      await git(path, ['checkout', '-q', '-b', branch]);
      await git(path, ['add', '-A']);
      const hasUser = (await git(repo, ['config', 'user.email']).catch(() => ({ stdout: '' }))).stdout.trim() !== '';
      const identity = hasUser ? [] : ['-c', 'user.name=rauha', '-c', 'user.email=rauha@localhost'];
      await git(path, [...identity, 'commit', '-q', '-m', conv.commitSubject(message.replace(/s+/g, ' ').trim().slice(0, 60), message)]);
      kept = branch;
    }
  } catch {
    /* 상태를 못 읽으면 그대로 지운다 */
  }
  await removeWorktree(repo, path);
  return kept;
}

/** worktree를 지우고 git의 목록에서도 뺀다. 이미 없으면 아무 일 없다. */
export async function removeWorktree(repo: string, path: string): Promise<void> {
  try {
    await git(repo, ['worktree', 'remove', '--force', path]);
  } catch {
    await rm(path, { recursive: true, force: true });
  }
  await git(repo, ['worktree', 'prune']).catch(() => undefined);
}

/**
 * 앱을 다시 켰을 때 남은 worktree 폴더를 치운다(앱이 꺼지면서 정리 못 한 것). 폴더 안의 .git 파일이 가리키는 레포를 찾아 목록에서도 뺀다.
 * 바뀐 내용이 있던 것은 작업 브랜치로 남긴 뒤 지운다. 지운 폴더 수를 돌려준다.
 */
export async function cleanupLeftovers(root: string): Promise<number> {
  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    return 0;
  }
  let count = 0;
  for (const name of names) {
    const path = join(root, name);
    try {
      const { stdout } = await git(path, ['rev-parse', '--git-common-dir']);
      const common = join(path, stdout.trim());
      const repo = join(common, '..');
      await finishWorktree(repo, path, name, '앱이 꺼지며 남은 작업');
    } catch {
      await rm(path, { recursive: true, force: true });
    }
    count += 1;
  }
  return count;
}

/** 빈 폴더를 git 저장소로 시작한다(첫 빈 커밋까지: 두 번째 일의 worktree가 HEAD에서 만들어지기 때문). 커밋 이름이 설정에 없으면 임시 이름을 쓴다. */
export async function initRepo(dir: string): Promise<void> {
  await git(dir, ['init']);
  const has = async (key: string) => (await git(dir, ['config', key]).then((r) => r.stdout.trim(), () => '')) !== '';
  const identity = (await has('user.name')) && (await has('user.email')) ? [] : ['-c', 'user.name=rauha', '-c', 'user.email=rauha@localhost'];
  await git(dir, [...identity, 'commit', '--allow-empty', '-m', '시작']);
}

/** 폴더가 git 저장소 안인가(상위 폴더가 저장소여도 그렇다) */
export async function insideRepo(dir: string): Promise<boolean> {
  return git(dir, ['rev-parse', '--is-inside-work-tree']).then((r) => r.stdout.trim() === 'true', () => false);
}
