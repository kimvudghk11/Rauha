import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { addWorktree, cleanupLeftovers, finishWorktree, jobBranch } from './git-worktree.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function repo() {
  const base = mkdtempSync(join(tmpdir(), 'rauha-wt-'));
  dirs.push(base);
  const root = join(base, 'app');
  execFileSync('git', ['init', '-q', '-b', 'main', root]);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' }).toString();
  git('config', 'user.email', 't@t.t');
  git('config', 'user.name', 't');
  writeFileSync(join(root, 'a.ts'), 'one\n');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  return { base, root, git };
}

describe('git worktree', () => {
  it('작업 브랜치 이름은 작업 id 앞 8자로 만든다', () => {
    expect(jobBranch('1234abcd-ef56-7890')).toBe('rauha/job-1234abcd');
  });

  it('worktree에서 고친 내용은 작업 브랜치에 남기고 폴더는 지우며 원래 폴더는 그대로다', async () => {
    const r = repo();
    const wt = join(r.base, 'wt', 'job1');
    await addWorktree(r.root, wt);
    expect(existsSync(join(wt, 'a.ts'))).toBe(true);
    writeFileSync(join(wt, 'a.ts'), 'two\n');
    const branch = await finishWorktree(r.root, wt, 'job-1111-aaaa', '고침');
    expect(branch).toBe('rauha/job-job1111a');
    expect(existsSync(wt)).toBe(false);
    expect(r.git('show', `${branch}:a.ts`)).toBe('two\n');
    expect(r.git('rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('main');
    expect(r.git('worktree', 'list')).not.toContain('job1');
  });

  it('바뀐 게 없으면 브랜치를 남기지 않고 폴더만 지운다', async () => {
    const r = repo();
    const wt = join(r.base, 'wt', 'job2');
    await addWorktree(r.root, wt);
    expect(await finishWorktree(r.root, wt, 'zzzz0000', '읽기만')).toBeNull();
    expect(existsSync(wt)).toBe(false);
    expect(r.git('branch', '--list', 'rauha/*').trim()).toBe('');
  });

  it('앱을 다시 켰을 때 남은 worktree를 치우고 바뀐 내용은 브랜치로 남긴다', async () => {
    const r = repo();
    const root = join(r.base, 'wt');
    const wt = join(root, 'leftover1');
    await addWorktree(r.root, wt);
    writeFileSync(join(wt, 'b.ts'), 'new\n');
    expect(await cleanupLeftovers(root)).toBe(1);
    expect(existsSync(wt)).toBe(false);
    expect(r.git('branch', '--list', 'rauha/*')).toContain('rauha/job-leftover');
  });

  it('남은 게 없거나 폴더가 없으면 0이다', async () => {
    expect(await cleanupLeftovers(join(tmpdir(), 'rauha-없는-폴더'))).toBe(0);
  });
});
