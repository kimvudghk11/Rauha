import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GitRepo } from './git-repo.js';

// 가짜 시험: 악성 설정이 든 폴더가 worktree 목록에 끼어 있어도 목록을 읽는 것만으로 명령이 돌면 안 된다.
const base = realpathSync(mkdtempSync(join(tmpdir(), 'rauha-wt-atk-')));
const sh = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
const main = join(base, 'main');
const evil = join(base, 'evil');
const marker = join(base, 'ran.txt');

beforeAll(() => {
  for (const d of [main, evil]) {
    mkdirSync(d);
    sh(d, 'init', '-q', '-b', 'main');
    sh(d, '-c', 'user.name=t', '-c', 'user.email=t@e.x', 'commit', '-q', '--allow-empty', '-m', 'init');
  }
  // 훅 프로그램: 실행되면 표식 파일을 만든다(fsmonitor는 status가 부른다)
  const hook = join(base, 'hook.sh');
  writeFileSync(hook, `#!/bin/sh\necho ran > "${marker.split(String.fromCharCode(92)).join("/")}"\n`, { mode: 0o755 });
  sh(evil, 'config', 'core.fsmonitor', hook.split(String.fromCharCode(92)).join("/"));
  // main의 worktree 목록에 evil을 끼워 넣는다(.git/worktrees/x/gitdir 가 evil/.git 을 가리킨다)
  const meta = join(main, '.git', 'worktrees', 'x');
  mkdirSync(meta, { recursive: true });
  writeFileSync(join(meta, 'gitdir'), `${join(evil, '.git').split(String.fromCharCode(92)).join("/")}\n`);
  writeFileSync(join(meta, 'HEAD'), 'ref: refs/heads/main\n');
  writeFileSync(join(meta, 'commondir'), '../..\n');
});
afterAll(() => rmSync(base, { recursive: true, force: true }));

describe('worktree 목록 읽기', () => {
  it('git 이 만든 진짜 worktree 는 변경 수와 마지막 커밋을 보여 준다', async () => {
    const real = join(base, 'real-wt');
    sh(main, 'worktree', 'add', '-q', '-b', 'feat', real);
    writeFileSync(join(real, 'new.txt'), 'x');
    const rows = await GitRepo.open(main, ['main']).worktrees();
    const row = rows.find((r) => r.branch === 'feat');
    expect(row).toMatchObject({ changed: 1, subject: 'init' });
  });

  it('목록을 읽어도 다른 폴더의 core.fsmonitor 같은 설정 프로그램을 돌리지 않는다', async () => {
    const repo = GitRepo.open(main, ['main']);
    await repo.worktrees();
    expect(existsSync(marker)).toBe(false);
  });

  it('이 레포에 속한 worktree 가 아닌 폴더는 변경 수·커밋을 읽지 않는다', async () => {
    const rows = await GitRepo.open(main, ['main']).worktrees();
    const foreign = rows.find((r) => r.path.toLowerCase().endsWith('evil'));
    if (foreign !== undefined) {
      expect(foreign.subject).toBe('');
      expect(foreign.changed).toBe(0);
    }
  });
});
