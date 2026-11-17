import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GitWorkspace } from './git-workspace.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rauha-git-'));
  dirs.push(dir);
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir });
  git('init', '-q');
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'a.ts'), 'a1');
  git('add', '.');
  git('commit', '-qm', 'init');
  return dir;
}

describe('GitWorkspace.readFile', () => {
  it('작업 폴더 안의 파일만 읽고, 밖이거나 없는 파일은 null', async () => {
    const dir = repo();
    writeFileSync(join(dir, 'secret.txt'), 'outside');
    const ws = new GitWorkspace(join(dir, 'src'));
    expect(await ws.readFile('a.ts')).toBe('a1');
    expect(await ws.readFile('../secret.txt')).toBeNull();
    expect(await ws.readFile(join(dir, 'secret.txt'))).toBeNull();
    expect(await ws.readFile('missing.ts')).toBeNull();
  });

  it('비밀 파일은 rauha도 읽지 않는다(null)', async () => {
    const dir = repo();
    writeFileSync(join(dir, '.env'), 'SECRET=1');
    writeFileSync(join(dir, '.env.example'), 'SECRET=');
    const ws = new GitWorkspace(dir);
    expect(await ws.readFile('.env')).toBeNull();
    expect(await ws.readFile('.env.example')).toBe('SECRET=');
  });
});

describe('GitWorkspace.recentCommits', () => {
  it('파일의 최근 커밋을 새것부터 "해시 날짜 제목"으로, 밖·비밀 파일은 빈 목록', async () => {
    const dir = repo();
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir });
    writeFileSync(join(dir, 'src', 'a.ts'), 'a2');
    git('commit', '-qam', '금액 반올림 바꿈');
    const ws = new GitWorkspace(dir);
    const commits = await ws.recentCommits('src/a.ts', 5);
    expect(commits).toHaveLength(2);
    expect(commits[0]).toMatch(/^[0-9a-f]{7,} \d{4}-\d{2}-\d{2} 금액 반올림 바꿈$/);
    expect(await ws.recentCommits('../x.ts', 5)).toEqual([]);
    expect(await ws.recentCommits('.env', 5)).toEqual([]);
  });
});

describe('GitWorkspace.reviewChanges', () => {
  const gitIn = (dir: string) => (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir }).toString().trim();

  it('검토 대상: 커밋 안 한 변경과 새 파일', async () => {
    const dir = repo();
    writeFileSync(join(dir, 'src', 'a.ts'), 'a2');
    writeFileSync(join(dir, 'src', 'b.ts'), 'b1');
    const changes = await new GitWorkspace(dir).reviewChanges(null);
    expect(changes).toEqual([
      { path: 'src/a.ts', kind: 'modified' },
      { path: 'src/b.ts', kind: 'added' },
    ]);
  });

  it('검토 대상: 브랜치와 갈라진 뒤의 변경', async () => {
    const dir = repo();
    const git = gitIn(dir);
    const main = git('rev-parse', '--abbrev-ref', 'HEAD');
    git('checkout', '-qb', 'feature');
    writeFileSync(join(dir, 'src', 'f.ts'), 'f1');
    git('add', '.');
    git('commit', '-qm', 'feature');
    git('checkout', '-q', main);
    writeFileSync(join(dir, 'src', 'm.ts'), 'm1');
    git('add', '.');
    git('commit', '-qm', 'main moves on');
    git('checkout', '-q', 'feature');
    writeFileSync(join(dir, 'src', 'a.ts'), 'a2');
    const changes = await new GitWorkspace(dir).reviewChanges(main);
    expect(changes.map((c) => c.path)).toEqual(['src/a.ts', 'src/f.ts']);
  });

  it('없는 브랜치나 -로 시작하는 이름은 알기 쉬운 오류', async () => {
    const ws = new GitWorkspace(repo());
    await expect(ws.reviewChanges('no-such-branch')).rejects.toThrow('no-such-branch 브랜치나 커밋을 찾지 못했어요.');
    await expect(ws.reviewChanges('--output=x')).rejects.toThrow('브랜치나 커밋을 찾지 못했어요.');
  });
});

describe('GitWorkspace', () => {
  it('git 저장소가 아니면 dirtyFiles는 null', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rauha-nogit-'));
    dirs.push(dir);
    // 홈 폴더가 git 저장소인 PC도 있으므로 위로 찾아 올라가지 못하게 막는다.
    const saved = process.env['GIT_CEILING_DIRECTORIES'];
    process.env['GIT_CEILING_DIRECTORIES'] = tmpdir();
    try {
      expect(await new GitWorkspace(dir).dirtyFiles()).toBeNull();
    } finally {
      if (saved === undefined) delete process.env['GIT_CEILING_DIRECTORIES'];
      else process.env['GIT_CEILING_DIRECTORIES'] = saved;
    }
  });

  it('하위 폴더에서 실행하면 그 폴더 안의 변경만 그 폴더 기준 경로로 본다', async () => {
    const dir = repo();
    mkdirSync(join(dir, 'pkg'));
    writeFileSync(join(dir, 'pkg', 'x.ts'), 'x');
    writeFileSync(join(dir, 'src', 'a.ts'), 'a2');
    const ws = new GitWorkspace(join(dir, 'pkg'));
    expect(await ws.dirtyFiles()).toEqual(['x.ts']);
    expect([...(await ws.snapshot()).files.keys()]).toEqual(['x.ts']);
  });

  it('커밋하지 않은 파일을 돌려준다', async () => {
    const dir = repo();
    const ws = new GitWorkspace(dir);
    expect(await ws.dirtyFiles()).toEqual([]);
    writeFileSync(join(dir, 'src', 'b.ts'), 'b');
    expect(await ws.dirtyFiles()).toEqual(['src/b.ts']);
  });

  it('두 스냅숏 사이에 바뀐 파일만 돌려준다', async () => {
    const dir = repo();
    const ws = new GitWorkspace(dir);
    writeFileSync(join(dir, 'src', 'a.ts'), 'a2');
    const before = await ws.snapshot();
    writeFileSync(join(dir, 'src', 'b.ts'), 'b');
    const after = await ws.snapshot();
    expect(ws.changesBetween(before, after)).toEqual([{ path: 'src/b.ts', kind: 'added' }]);
    writeFileSync(join(dir, 'src', 'a.ts'), 'a3');
    expect(ws.changesBetween(after, await ws.snapshot())).toEqual([{ path: 'src/a.ts', kind: 'modified' }]);
  });

  it('팀원이 커밋해도 시작 시점 커밋 대비 바뀐 파일을 놓치지 않는다', async () => {
    const dir = repo();
    const ws = new GitWorkspace(dir);
    expect(await ws.dirtyFiles()).toEqual([]); // 시작 시점 기록
    writeFileSync(join(dir, 'src', 'b.spec.ts'), 'test');
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '.'], { cwd: dir });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'sneaky'], { cwd: dir });
    expect(await ws.changesSinceHead()).toEqual([{ path: 'src/b.spec.ts', kind: 'added' }]);
    expect([...(await ws.snapshot()).files.keys()]).toEqual(['src/b.spec.ts']);
  });

  it('추가했다가 지운 파일 때문에 스냅숏이 깨지지 않는다', async () => {
    const dir = repo();
    const ws = new GitWorkspace(dir);
    await ws.dirtyFiles();
    writeFileSync(join(dir, 'src', 'tmp.ts'), 'x');
    execFileSync('git', ['add', 'src/tmp.ts'], { cwd: dir });
    rmSync(join(dir, 'src', 'tmp.ts'));
    await expect(ws.snapshot()).resolves.toBeDefined();
  });

  it('node_modules 안의 변경(테스트 도구 캐시 등)은 무시한다', async () => {
    const dir = repo();
    mkdirSync(join(dir, 'node_modules', '.vite'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', '.vite', 'results.json'), '{}');
    const ws = new GitWorkspace(dir);
    expect(await ws.dirtyFiles()).toEqual([]);
    expect(await ws.changesSinceHead()).toEqual([]);
  });

  it('HEAD 이후 바뀐 파일을 종류와 함께 돌려준다', async () => {
    const dir = repo();
    const ws = new GitWorkspace(dir);
    writeFileSync(join(dir, 'src', 'a.ts'), 'a2');
    writeFileSync(join(dir, 'src', 'c.ts'), 'c');
    expect(await ws.changesSinceHead()).toEqual([
      { path: 'src/a.ts', kind: 'modified' },
      { path: 'src/c.ts', kind: 'added' },
    ]);
  });
});

describe('GitWorkspace.listFiles', () => {
  it('추적 중인 파일과 새 파일을 실행 폴더 기준으로 돌려준다', async () => {
    const dir = repo();
    writeFileSync(join(dir, 'src', 'new.ts'), 'n');
    expect(await new GitWorkspace(dir).listFiles()).toEqual(['src/a.ts', 'src/new.ts']);
  });
});
