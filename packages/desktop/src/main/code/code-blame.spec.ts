import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runGit } from '../git/git-run.js';
import { CodeFiles } from './code-files.js';
import { CodeGit } from './code-git.js';

let base = '';
let work = '';
let repo = '';
const secret = /(^|\/)\.env$/;
const git = (author: string, ...args: string[]): void => {
  execFileSync('git', ['-c', 'user.email=t@t', '-c', `user.name=${author}`, '-c', 'commit.gpgsign=false', ...args], { cwd: repo, stdio: 'ignore' });
};
const codeGit = (): CodeGit => new CodeGit({ files: new CodeFiles({ root: () => work, isSecret: (p) => secret.test(p) }), repos: () => [repo], run: (root, args) => runGit(root, args) });

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'rauha-blame-'));
  work = join(base, 'work');
  repo = join(work, 'app');
  await mkdir(join(repo, 'src'), { recursive: true });
  await writeFile(join(repo, 'src', 'a.ts'), 'one\ntwo\nthree\n');
  git('Kim', 'init', '-q');
  git('Kim', 'add', '.');
  git('Kim', 'commit', '-q', '-m', 'first');
  await writeFile(join(repo, 'src', 'a.ts'), 'one\nTWO\nthree\nfour\n');
  git('Bo', 'commit', '-q', '-am', 'second: 둘째 줄');
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('코드 탭 blame (임시 레포)', () => {
  it('줄마다 작성자·요약을 주고 같은 커밋 줄은 같은 번호다', async () => {
    const r = await codeGit().blame('app/src/a.ts');
    if (!r.ok || r.view === null) throw new Error('blame 실패');
    expect(r.view.lines).toHaveLength(4);
    const who = r.view.lines.map((i) => r.view.commits[i]!.author);
    expect(who).toEqual(['Kim', 'Bo', 'Kim', 'Bo']);
    expect(r.view.commits.find((c) => c.author === 'Bo')!.summary).toBe('second: 둘째 줄');
    expect(r.root).toBe(repo);
  });

  it('저장했지만 커밋하지 않은 줄은 Not committed yet 이다', async () => {
    await writeFile(join(repo, 'src', 'a.ts'), 'one\nTWO\nthree\nfour\nfive\n');
    const r = await codeGit().blame('app/src/a.ts');
    if (!r.ok || r.view === null) throw new Error('blame 실패');
    expect(r.view.commits[r.view.lines[4]!]!.uncommitted).toBe(true);
  });

  it('추적하지 않는 새 파일·레포 밖 파일은 까닭만 알려 준다', async () => {
    await writeFile(join(repo, 'fresh.ts'), 'x\n');
    expect(await codeGit().blame('app/fresh.ts')).toEqual({ ok: true, view: null, why: 'not-tracked' });
  });

  it('밖 경로·비밀 파일·폴더는 거절한다', async () => {
    expect(await codeGit().blame('../x')).toEqual({ ok: false, reason: 'bad-path' });
    await writeFile(join(repo, '.env'), 'k=1');
    expect(await codeGit().blame('app/.env')).toEqual({ ok: false, reason: 'secret' });
    expect(await codeGit().blame('')).toEqual({ ok: false, reason: 'not-file' });
    expect(await codeGit().blame({ path: 'app' })).toEqual({ ok: false, reason: 'bad-path' });
  });

  it('작업 폴더 밖으로 향한 링크 파일은 읽지 않는다', async () => {
    await mkdir(join(base, 'outside'));
    await writeFile(join(base, 'outside', 'leak.txt'), 'secret\n');
    try {
      await symlink(join(base, 'outside', 'leak.txt'), join(repo, 'link.txt'));
    } catch {
      return; // 이 PC 는 링크를 만들 권한이 없다
    }
    const r = await codeGit().blame('app/link.txt');
    expect(r.ok && r.view !== null).toBe(false);
  });

  it('글자가 pathspec 처럼 생긴 파일 이름(*)도 그 파일만 가리킨다', async () => {
    if (process.platform === 'win32') return; // Windows 는 * 를 파일 이름에 쓸 수 없다
    await writeFile(join(repo, 'src', 'x*.ts'), 'star\n');
    git('Kim', 'add', '-f', '--', 'src/x*.ts');
    git('Kim', 'commit', '-q', '-m', 'star');
    await writeFile(join(repo, 'src', 'xa.ts'), 'other\n');
    const r = await codeGit().blame('app/src/x*.ts');
    if (!r.ok || r.view === null) throw new Error('blame 실패');
    expect(r.view.lines).toHaveLength(1);
  });
});
