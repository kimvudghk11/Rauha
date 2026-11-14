import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { GithubRepo } from '../../shared/gh-actions.js';
import type { ActionsClient } from '../github/actions-client.js';
import { dispatchGit } from './git-dispatch.js';
import { RepoGate } from './repo-gate.js';

const base = realpathSync(mkdtempSync(join(tmpdir(), 'rauha-act-')));
afterAll(() => rmSync(base, { recursive: true, force: true }));
const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
let n = 0;
function repo(remote: string | null): string {
  const root = join(base, `r${n++}`);
  execFileSync('git', ['init', '-q', '-b', 'main', root], { windowsHide: true });
  if (remote !== null) sh(root, 'remote', 'add', 'origin', remote);
  return root;
}
const asked: string[] = [];
const fake: ActionsClient = {
  runs: async (r: GithubRepo) => (asked.push(`runs ${r.slug}`), { runs: [], signedIn: false }),
  jobs: async (r: GithubRepo, id: number) => (asked.push(`jobs ${r.slug} ${id}`), []),
  log: async (r: GithubRepo, id: number) => (asked.push(`log ${r.slug} ${id}`), { lines: [], needsLogin: true }),
};
const call = (root: string, fn: 'actionsRuns' | 'actionsJobs' | 'actionsLog', arg: unknown = {}, actions: ActionsClient | null = fake) =>
  dispatchGit({ gate: new RepoGate(async () => [root]), protectedBranches: () => [], openExternal: async () => {}, ...(actions === null ? {} : { actions }) }, fn, root, arg);

describe('Actions 함수는 이 레포의 GitHub 원격만 묻는다', () => {
  it('원격 주소에서 owner/repo 를 읽어 묻고, slug 를 함께 돌려준다', async () => {
    const r = repo('git@github.com:kimvudghk11/rauha.git');
    expect(await call(r, 'actionsRuns')).toMatchObject({ ok: true, data: { slug: 'kimvudghk11/rauha', runs: [] } });
    await call(r, 'actionsJobs', { runId: 42 });
    expect(asked).toContain('jobs kimvudghk11/rauha 42');
  });
  it('원격이 없거나 github.com 이 아니면 이유와 함께 거절한다', async () => {
    expect(await call(repo(null), 'actionsRuns')).toMatchObject({ ok: false, code: 'BLOCKED' });
    expect(await call(repo('https://gitlab.com/o/r.git'), 'actionsRuns')).toMatchObject({ ok: false, error: expect.stringMatching(/github\.com/) });
  });
  it('run·job 번호는 양의 정수만 받는다', async () => {
    const r = repo('https://github.com/o/r.git');
    for (const bad of [0, -1, 1.5, '7', '../x', Number.MAX_SAFE_INTEGER + 2]) expect(await call(r, 'actionsLog', { jobId: bad })).toMatchObject({ ok: false, code: 'INVALID' });
  });
  it('Actions 읽기가 연결되지 않았으면 거절한다', async () => {
    expect(await call(repo('https://github.com/o/r.git'), 'actionsRuns', {}, null)).toMatchObject({ ok: false, code: 'INVALID' });
  });
});
