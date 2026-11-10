import { GIT_FUNCTIONS, type GitErrorCode, type GitFn, type GitResult } from '../../shared/git-api.js';
import { conventionsView } from '../../shared/git-conventions-view.js';
import { readConventions } from '../workspace/git-worktree.js';
import { GitInputError } from '../../shared/git-guard.js';
import { GitRepo } from './git-repo.js';
import { GitFailure } from './git-run.js';
import type { RepoGate } from './repo-gate.js';

export interface GitContext {
  readonly gate: RepoGate;
  readonly protectedBranches: () => readonly string[];
  /** 기본 브라우저로 연다. https 주소만 받는다. */
  readonly openExternal: (url: string) => Promise<void>;
}

const str = (v: unknown): string => {
  if (typeof v !== 'string') throw new GitInputError('The value is not valid.');
  return v;
};
const strs = (v: unknown): string[] => {
  if (!Array.isArray(v)) throw new GitInputError('The value is not valid.');
  return v.map(str);
};
const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {});
const sel = (v: unknown) => {
  const o = obj(v);
  const nums = (x: unknown): number[] => (Array.isArray(x) ? x.filter((n): n is number => Number.isInteger(n) && n >= 0) : []);
  const lines: Record<number, number[]> = {};
  for (const [k, val] of Object.entries(obj(o['lines']))) if (/^\d+$/.test(k)) lines[Number(k)] = nums(val);
  return { hunks: nums(o['hunks']), lines };
};

/**
 * 화면이 부른 git 함수를 실행한다. 함수 이름은 GIT_FUNCTIONS 목록만, 폴더는 RepoGate가 아는 레포 루트만 받는다.
 * 인자는 모양을 하나씩 확인한 뒤 GitRepo에 넘긴다.
 */
export async function dispatchGit(ctx: GitContext, fn: unknown, root: unknown, rawArg: unknown): Promise<GitResult<unknown>> {
  const fail = (code: GitErrorCode, error: string): GitResult<never> => ({ ok: false, error, code });
  if (typeof fn !== 'string' || !(GIT_FUNCTIONS as readonly string[]).includes(fn)) return fail('INVALID', 'Unknown git request.');
  const checked = await ctx.gate.check(root);
  if (checked === null) return fail('UNKNOWN_REPO', 'This folder is not a repo the app knows. Press Reload repos (↻) in the Repo tab.');
  const repo = GitRepo.open(checked, ctx.protectedBranches());
  const a = obj(rawArg);
  const confirm = { confirmed: a['confirmed'] === true };
  try {
    const run: Record<GitFn, () => Promise<unknown>> = {
      overview: () => repo.overview(),
      diff: () => repo.diff(str(a['path']), a['side'] === 'staged' ? 'staged' : 'unstaged'),
      stage: () => repo.stage(strs(a['paths'])),
      unstage: () => repo.unstage(strs(a['paths'])),
      stageSelection: () => repo.stageSelection(str(a['path']), sel(a['selection']), a['mode'] === 'unstage' ? 'unstage' : 'stage'),
      discard: () => repo.discard(strs(a['paths'])),
      commit: () => repo.commit(str(a['subject']), typeof a['body'] === 'string' ? a['body'] : ''),
      branches: () => repo.branches(),
      worktrees: () => repo.worktrees(),
      createBranch: () => repo.createBranch(str(a['name']), typeof a['base'] === 'string' ? a['base'] : undefined, a['checkout'] !== false),
      switchBranch: () => repo.switchBranch(str(a['name'])),
      merge: () => repo.merge(str(a['name']), confirm),
      deleteBranch: () => repo.deleteBranch(str(a['name'])),
      fetch: () => repo.fetch(),
      pull: () => repo.pull(a['mode'] === 'merge' ? 'merge' : 'ff'),
      push: () => repo.push(confirm),
      conventions: async () => conventionsView(await readConventions(checked)),
      undoCommit: () => repo.undoCommit(),
      log: () => repo.log(typeof a['ref'] === 'string' ? a['ref'] : undefined),
      commitDiff: () => repo.commitDiff(str(a['hash'])),
      mergeState: () => repo.mergeState(),
      resolveSide: () => repo.resolveSide(str(a['path']), a['side'] === 'theirs' ? 'theirs' : 'ours'),
      readConflict: () => repo.readConflict(str(a['path'])),
      writeConflict: () => repo.writeConflict(str(a['path']), str(a['text'])),
      markResolved: () => repo.markResolved(str(a['path'])),
      finishMerge: () => repo.finishMerge(),
      abortMerge: () => repo.abortMerge(),
      openPr: async () => {
        const { url } = await repo.prUrl(str(a['base']));
        if (!url.startsWith('https://')) throw new GitFailure('INVALID', 'Only https addresses can be opened.');
        await ctx.openExternal(url);
        return { url };
      },
    };
    return { ok: true, data: await run[fn as GitFn]() };
  } catch (e) {
    if (e instanceof GitFailure) return fail(e.code, e.message);
    if (e instanceof GitInputError) return fail('INVALID', e.message);
    return fail('FAILED', e instanceof Error ? e.message : 'Unknown error');
  }
}
