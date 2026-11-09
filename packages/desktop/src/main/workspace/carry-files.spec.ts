import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SecretPolicy } from '@rauha/core';
import { afterEach, describe, expect, it } from 'vitest';
import { carryFiles } from './carry-files.js';
import { addWorktree, finishWorktree } from './git-worktree.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup() {
  const base = mkdtempSync(join(tmpdir(), 'rauha-carry-'));
  dirs.push(base);
  const root = join(base, 'app');
  execFileSync('git', ['init', '-q', '-b', 'main', root]);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' }).toString();
  git('config', 'user.email', 't@t.t');
  git('config', 'user.name', 't');
  writeFileSync(join(root, 'a.ts'), 'one\n');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  return { base, root, wt: join(base, 'wt', 'job2') };
}

describe('앞 업무가 남긴 파일을 worktree로 옮기기', () => {
  it('커밋 안 한 새 파일과 고친 파일을 worktree로 복사하고 원래 폴더는 그대로 둔다', async () => {
    const s = setup();
    mkdirSync(join(s.root, 'src'));
    writeFileSync(join(s.root, 'src', 'new.ts'), 'fresh\n');
    writeFileSync(join(s.root, 'a.ts'), 'edited\n');
    await addWorktree(s.root, s.wt);
    const result = await carryFiles(s.root, s.wt, ['src/new.ts', 'a.ts'], SecretPolicy.defaults());
    expect(result.copied).toEqual(['src/new.ts', 'a.ts']);
    expect(readFileSync(join(s.wt, 'src', 'new.ts'), 'utf8')).toBe('fresh\n');
    expect(readFileSync(join(s.wt, 'a.ts'), 'utf8')).toBe('edited\n');
    expect(readFileSync(join(s.root, 'src', 'new.ts'), 'utf8')).toBe('fresh\n');
    expect(readFileSync(join(s.root, 'a.ts'), 'utf8')).toBe('edited\n');
  });

  it('옮긴 파일은 worktree를 정리할 때 작업 브랜치에 남는다', async () => {
    const s = setup();
    writeFileSync(join(s.root, 'new.ts'), 'fresh\n');
    await addWorktree(s.root, s.wt);
    await carryFiles(s.root, s.wt, ['new.ts'], SecretPolicy.defaults());
    const branch = await finishWorktree(s.root, s.wt, 'job-2222-bbbb', '정리');
    expect(branch).not.toBeNull();
    expect(execFileSync('git', ['show', `${branch}:new.ts`], { cwd: s.root }).toString()).toBe('fresh\n');
  });

  it('비밀 파일과 레포 밖 경로는 옮기지 않는다', async () => {
    const s = setup();
    writeFileSync(join(s.root, '.env'), 'KEY=1\n');
    writeFileSync(join(s.base, 'outside.txt'), 'x');
    await addWorktree(s.root, s.wt);
    const result = await carryFiles(s.root, s.wt, ['.env', '../outside.txt'], SecretPolicy.defaults());
    expect(result.copied).toEqual([]);
    expect(existsSync(join(s.wt, '.env'))).toBe(false);
    expect(existsSync(join(s.wt, '..', 'outside.txt'))).toBe(false);
  });

  it('심볼릭 링크 파일이나 링크 폴더 아래 파일은 따라가지 않는다', async () => {
    const s = setup();
    const secret = join(s.base, 'secret.txt');
    writeFileSync(secret, 'top secret');
    mkdirSync(join(s.base, 'elsewhere'));
    writeFileSync(join(s.base, 'elsewhere', 'f.ts'), 'x');
    try {
      symlinkSync(secret, join(s.root, 'link.ts'));
      symlinkSync(join(s.base, 'elsewhere'), join(s.root, 'dir'), 'junction');
    } catch {
      return; // 링크를 만들 수 없는 환경
    }
    await addWorktree(s.root, s.wt);
    const result = await carryFiles(s.root, s.wt, ['link.ts', 'dir/f.ts'], SecretPolicy.defaults());
    expect(result.copied).toEqual([]);
    expect(existsSync(join(s.wt, 'link.ts'))).toBe(false);
    expect(existsSync(join(s.wt, 'dir', 'f.ts'))).toBe(false);
  });

  it('없는 파일이나 폴더는 건너뛰고 나머지는 옮긴다', async () => {
    const s = setup();
    mkdirSync(join(s.root, 'folder'));
    writeFileSync(join(s.root, 'ok.ts'), 'ok\n');
    await addWorktree(s.root, s.wt);
    const result = await carryFiles(s.root, s.wt, ['missing.ts', 'folder', 'ok.ts'], SecretPolicy.defaults());
    expect(result.copied).toEqual(['ok.ts']);
  });
});
