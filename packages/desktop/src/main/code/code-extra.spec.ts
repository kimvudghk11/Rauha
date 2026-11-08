import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CodeFiles } from './code-files.js';
import { CodeGit } from './code-git.js';
import { runGit } from '../git/git-run.js';

let base = '';
let work = '';
let repo = '';
const secret = /(^|\/)\.env$/;
const make = (): CodeFiles => new CodeFiles({ root: () => work, isSecret: (p) => secret.test(p) });
const git = (...args: string[]): void => {
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, stdio: 'ignore' });
};

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'rauha-code2-'));
  work = join(base, 'work');
  repo = join(work, 'app');
  await mkdir(join(repo, 'src'), { recursive: true });
  await mkdir(join(base, 'outside'));
  await writeFile(join(base, 'outside', 'leak.txt'), 'needle in outside');
  await writeFile(join(repo, 'src', 'a.ts'), 'one\ntwo\nthree\n');
  await writeFile(join(repo, 'keep.txt'), 'keep\n');
  git('init', '-q');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('코드 탭 전체 찾기', () => {
  it('작업 폴더 아래에서 찾고 경로는 작업 폴더 기준이다', async () => {
    const r = await make().searchAll({ query: 'two', caseSensitive: false, regex: false });
    expect(r).toMatchObject({ ok: true, files: [{ path: 'app/src/a.ts', hits: [{ line: 2 }] }] });
  });

  it('비밀 파일·생성물 폴더·링크 너머·바이너리·큰 파일은 뒤지지 않는다', async () => {
    await writeFile(join(repo, '.env'), 'needle=1');
    await mkdir(join(repo, 'node_modules', 'x'), { recursive: true });
    await writeFile(join(repo, 'node_modules', 'x', 'i.js'), 'needle');
    await writeFile(join(repo, 'bin.dat'), Buffer.concat([Buffer.from('needle'), Buffer.from([0, 1])]));
    await writeFile(join(repo, 'big.txt'), `needle${'a'.repeat(1024 * 1024)}`);
    await symlink(join(base, 'outside'), join(repo, 'portal'), 'junction');
    const r = await make().searchAll({ query: 'needle', caseSensitive: false, regex: false });
    expect(r).toMatchObject({ ok: true, files: [] });
  });

  it('빈 검색어·잘못된 정규식·모양이 틀린 요청은 거절한다', async () => {
    expect(await make().searchAll({ query: '', caseSensitive: false, regex: false })).toEqual({ ok: false, reason: 'empty' });
    expect(await make().searchAll({ query: '(', caseSensitive: false, regex: true })).toEqual({ ok: false, reason: 'bad-regex' });
    expect(await make().searchAll('x')).toEqual({ ok: false, reason: 'bad-path' });
  });

  it('빠른 열기 목록은 .git·node_modules·비밀 파일을 뺀다', async () => {
    await writeFile(join(repo, '.env'), 'x');
    await mkdir(join(repo, 'node_modules'), { recursive: true });
    await writeFile(join(repo, 'node_modules', 'i.js'), 'x');
    const r = await make().listFiles();
    if (!r.ok) throw new Error('목록 실패');
    expect(r.paths).toEqual(['app/keep.txt', 'app/src/a.ts']);
  });
});

describe('코드 탭 git 표시', () => {
  const codeGit = (): CodeGit => new CodeGit({ files: make(), repos: () => [repo], run: (root, args) => runGit(root, args) });

  it('바뀐 파일을 작업 폴더 기준 경로와 한 글자 상태로 준다', async () => {
    await writeFile(join(repo, 'src', 'a.ts'), 'one\nTWO\nthree\n');
    await writeFile(join(repo, 'fresh.ts'), 'x');
    const r = await codeGit().changes();
    if (!r.ok) throw new Error('실패');
    expect(r.files).toEqual(expect.arrayContaining([{ path: 'app/src/a.ts', code: 'M' }, { path: 'app/fresh.ts', code: 'U' }]));
    expect(r.repos[0]?.path).toBe('app');
  });

  it('비밀 파일은 바뀐 목록에서도 감춘다', async () => {
    await writeFile(join(repo, '.env'), 'k=1');
    const r = await codeGit().changes();
    if (!r.ok) throw new Error('실패');
    expect(r.files.find((f) => f.path.endsWith('.env'))).toBeUndefined();
  });

  it('고친 줄과 새로 생긴 줄을 알려 준다', async () => {
    await writeFile(join(repo, 'src', 'a.ts'), 'one\nTWO\nthree\nfour\n');
    expect(await codeGit().diff('app/src/a.ts')).toEqual({
      ok: true,
      marks: [
        { from: 2, to: 2, kind: 'modified' },
        { from: 4, to: 4, kind: 'added' },
      ],
    });
  });

  it('바뀌지 않은 파일은 표시가 없고, 새 파일은 전체가 added다', async () => {
    expect(await codeGit().diff('app/keep.txt')).toEqual({ ok: true, marks: [] });
    await writeFile(join(repo, 'fresh.ts'), 'a\nb\n');
    expect(await codeGit().diff('app/fresh.ts')).toEqual({ ok: true, marks: [{ from: 1, to: 2, kind: 'added' }] });
  });

  it('비밀 파일과 밖 경로는 diff도 안 준다', async () => {
    expect(await codeGit().diff('../outside/leak.txt')).toEqual({ ok: false, reason: 'bad-path' });
    await writeFile(join(repo, '.env'), 'k=1');
    expect(await codeGit().diff('app/.env')).toEqual({ ok: false, reason: 'secret' });
  });
});
