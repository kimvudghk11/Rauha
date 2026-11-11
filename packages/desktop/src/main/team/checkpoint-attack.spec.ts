import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CheckpointStore } from '../data/checkpoint-store.js';
import { applyPatch, fileDiff } from '../git/checkpoint-git.js';
import { CheckpointKeeper } from './checkpoint-keeper.js';

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();
const put = (root: string, rel: string, text: string) => {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), text);
};
const read = (root: string, rel: string) => readFileSync(join(root, rel), 'utf8');

let repo: string;
let data: string;
let outside: string;
let seq = 0;
const make = () =>
  new CheckpointKeeper({
    store: new CheckpointStore(data),
    secretOf: () => (p) => p === '.env',
    protectedBranches: () => ['main'],
    newId: () => `backup-${String(++seq).padStart(4, '0')}`,
    now: () => '2026-11-11T00:00:00.000Z',
  });

/** 작업이 한 일을 흉내 낸다 */
const job = async (work: () => void) => {
  const keeper = make();
  await keeper.begin('job1', { repoRoot: repo, cwd: repo, place: 'repo' });
  work();
  await keeper.finishInPlace('job1');
  return keeper;
};

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'rauha-cpa-repo-'));
  data = mkdtempSync(join(tmpdir(), 'rauha-cpa-data-'));
  outside = mkdtempSync(join(tmpdir(), 'rauha-cpa-out-'));
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 't@t');
  git(repo, 'config', 'user.name', 't');
  git(repo, 'config', 'core.autocrlf', 'false');
  put(repo, 'a.txt', 'one\n');
  put(repo, 'flat', 'I am a file\n');
  put(repo, 'tree/x.txt', 'x in a folder\n');
  put(repo, 'src/deep/c.ts', 'export const c = 1;\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'first');
});

afterEach(() => {
  for (const d of [repo, data, outside]) rmSync(d, { recursive: true, force: true });
});

describe('체크포인트 되돌리기: 파일과 폴더가 서로 바뀐 경우', () => {
  it('파일이 같은 이름의 폴더로 바뀌었어도 새 파일을 먼저 지우고 원래 파일을 되살린다', async () => {
    const keeper = await job(() => {
      rmSync(join(repo, 'flat'));
      put(repo, 'flat/inner.txt', 'now a folder\n');
    });
    const out = await keeper.revert('job1');
    expect(out.message).not.toMatch(/Could not change/);
    expect(read(repo, 'flat')).toBe('I am a file\n');
    expect(statSync(join(repo, 'flat')).isFile()).toBe(true);
  });

  it('폴더가 같은 이름의 파일로 바뀌었어도 새 파일을 먼저 지우고 원래 폴더 파일을 되살린다', async () => {
    const keeper = await job(() => {
      rmSync(join(repo, 'tree'), { recursive: true });
      put(repo, 'tree', 'now a file\n');
    });
    const out = await keeper.revert('job1');
    expect(out.message).not.toMatch(/Could not change/);
    expect(read(repo, 'tree/x.txt')).toBe('x in a folder\n');
  });

  it('이렇게 바뀐 것도 Undo the undo 로 되돌아온다', async () => {
    const keeper = await job(() => {
      rmSync(join(repo, 'flat'));
      put(repo, 'flat/inner.txt', 'now a folder\n');
    });
    await keeper.revert('job1');
    await keeper.undoRevert('job1');
    expect(read(repo, 'flat/inner.txt')).toBe('now a folder\n');
  });
});

describe('체크포인트 되돌리기: 이름이 특이한 파일', () => {
  it('이름에 대괄호가 든 파일을 되돌려도 비슷한 이름의 다른 파일은 건드리지 않는다(글 그대로 경로)', async () => {
    put(repo, '[ab].txt', 'bracket\n');
    put(repo, 'a.txt', 'one\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'brackets');
    const keeper = await job(() => {
      put(repo, '[ab].txt', 'bracket changed\n');
      put(repo, 'a.txt', 'a changed\n');
    });
    await keeper.revert('job1', ['[ab].txt']);
    expect(read(repo, '[ab].txt')).toBe('bracket\n');
    expect(read(repo, 'a.txt')).toBe('a changed\n');
  });

  it.skipIf(process.platform === 'win32')('이름에 줄바꿈이 든 파일은 목록에 올리지도 되돌리지도 않는다', async () => {
    const keeper = await job(() => {
      put(repo, 'evil\nname.txt', 'x\n');
      put(repo, 'ok.txt', 'ok\n');
    });
    const view = await keeper.changes('job1');
    expect(view!.files.map((f) => f.path)).toEqual(['ok.txt']);
  });
});

describe('체크포인트 되돌리기: 링크·정션으로 밖을 가리키는 폴더', () => {
  it('폴더가 밖을 가리키는 링크로 바뀌어도 되돌리기가 링크 너머 밖에 쓰지 않는다', async () => {
    writeFileSync(join(outside, 'keep.txt'), 'keep');
    const keeper = await job(() => {
      rmSync(join(repo, 'src', 'deep'), { recursive: true });
      try {
        symlinkSync(outside, join(repo, 'src', 'deep'), 'junction');
      } catch {
        /* 링크를 만들 수 없는 환경이면 폴더 삭제만 일어난 것으로 시험한다 */
      }
    });
    await keeper.revert('job1').catch(() => undefined);
    expect(readdirSync(outside)).toEqual(['keep.txt']);
    expect(read(outside, 'keep.txt')).toBe('keep');
  });
});

describe('체크포인트 백업 patch', () => {
  it.skipIf(process.platform === 'win32')('백업 patch 파일은 이 사용자만 읽는다(0600)', async () => {
    const keeper = await job(() => put(repo, 'a.txt', 'changed\n'));
    const out = await keeper.revert('job1');
    const mode = statSync(join(data, 'undo-backups', `${out.backupId}.patch`)).mode & 0o777;
    expect(mode & 0o077).toBe(0);
  });

  it('git 의 apply.whitespace=error 설정이 있어도 줄 끝 공백이 든 내용을 Undo the undo 로 되살린다', async () => {
    git(repo, 'config', 'apply.whitespace', 'error');
    const keeper = await job(() => put(repo, 'a.txt', 'trailing   \nspaces\t\n'));
    await keeper.revert('job1');
    await keeper.undoRevert('job1');
    expect(read(repo, 'a.txt')).toBe('trailing   \nspaces\t\n');
  });

  const patchFor = (path: string, mode = '100644') => Buffer.from(`diff --git a/${path} b/${path}\nnew file mode ${mode}\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1 @@\n+pwned\n`);

  it.each(['.git/hooks/pre-commit', '../escaped.txt', 'sub/../../escaped.txt'])('바뀐 patch 파일이 %s 를 쓰려 해도 적용하지 않는다', async (path) => {
    const parent = join(repo, '..');
    const before = existsSync(join(parent, 'escaped.txt'));
    const out = await applyPatch(repo, patchFor(path));
    expect(out.ok).toBe(false);
    expect(existsSync(join(repo, '.git', 'hooks', 'pre-commit'))).toBe(false);
    expect(existsSync(join(parent, 'escaped.txt'))).toBe(before);
  });

  it('바뀐 patch 파일이 대체 스트림·짧은 이름으로 .git 안을 쓰려 해도 적용하지 않는다', async () => {
    for (const path of ['.git::$INDEX_ALLOCATION/hooks/pre-commit', 'GIT~1/hooks/pre-commit', '.git./hooks/pre-commit', '.g‌it/hooks/pre-commit']) {
      const out = await applyPatch(repo, patchFor(path));
      expect(out.ok, path).toBe(false);
    }
    expect(existsSync(join(repo, '.git', 'hooks', 'pre-commit'))).toBe(false);
  });

  it('밖을 가리키는 링크 폴더 너머로는 patch 가 쓰지 못한다', async () => {
    try {
      symlinkSync(outside, join(repo, 'lnk'), 'junction');
    } catch {
      return; // 링크를 만들 수 없는 환경
    }
    const out = await applyPatch(repo, patchFor('lnk/evil.txt'));
    expect(out.ok).toBe(false);
    expect(existsSync(join(outside, 'evil.txt'))).toBe(false);
  });

  it('바뀐 patch 파일이 링크 파일(120000)을 만들려 하면 적용하지 않는다', async () => {
    const out = await applyPatch(repo, patchFor('shortcut', '120000'));
    expect(out.ok).toBe(false);
    expect(existsSync(join(repo, 'shortcut'))).toBe(false);
  });
});

describe('체크포인트 diff 보기는 읽기만 한다', () => {
  it('저장소 설정의 textconv 프로그램을 실행하지 않는다', async () => {
    const marker = join(outside, 'ran.txt').replace(/\\/g, '/');
    git(repo, 'config', 'diff.evil.textconv', `sh -c 'echo ran > "${marker}"' #`);
    writeFileSync(join(repo, '.gitattributes'), '*.txt diff=evil\n');
    const keeper = await job(() => put(repo, 'a.txt', 'two\n'));
    const view = await keeper.changes('job1');
    expect(view).not.toBeNull();
    const startTree = git(repo, 'rev-parse', 'HEAD');
    await fileDiff(repo, startTree, startTree, 'a.txt').catch(() => undefined);
    await keeper.diff('job1', 'a.txt').catch(() => undefined);
    expect(existsSync(marker)).toBe(false);
  });
});
