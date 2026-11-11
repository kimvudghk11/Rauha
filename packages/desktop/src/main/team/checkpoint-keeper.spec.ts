import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CheckpointStore } from '../data/checkpoint-store.js';
import { CheckpointKeeper } from './checkpoint-keeper.js';

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();
const put = (root: string, rel: string, text: string) => {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), text);
};
const read = (root: string, rel: string) => readFileSync(join(root, rel), 'utf8');

let repo: string;
let data: string;
let seq = 0;
const make = () =>
  new CheckpointKeeper({
    store: new CheckpointStore(data),
    secretOf: () => (p) => p === '.env' || p.endsWith('.pem'),
    protectedBranches: () => ['main', 'master', 'release/*'],
    newId: () => `backup-${String(++seq).padStart(4, '0')}`,
    now: () => '2026-11-11T00:00:00.000Z',
  });

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'rauha-cp-repo-'));
  data = mkdtempSync(join(tmpdir(), 'rauha-cp-data-'));
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 't@t');
  git(repo, 'config', 'user.name', 't');
  git(repo, 'config', 'core.autocrlf', 'false');
  put(repo, 'a.txt', 'one\ntwo\nthree\n');
  put(repo, 'b.txt', 'bee\n');
  put(repo, 'gone.txt', 'will be deleted\n');
  put(repo, 'src/deep/c.ts', 'export const c = 1;\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'first');
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(data, { recursive: true, force: true });
});

/** 팀이 한 일을 흉내 낸다: 수정·새 파일(새 폴더)·삭제·비밀 파일 */
const teamWorks = () => {
  put(repo, 'a.txt', 'one\nTWO\nthree\nfour\n');
  put(repo, 'new/dir/n.ts', 'export const n = 1;\nexport const m = 2;\n');
  rmSync(join(repo, 'gone.txt'));
  put(repo, '.env', 'SECRET=1\n');
};

describe('CheckpointKeeper 작업 기준 기록과 변경 목록', () => {
  it('작업 시작 기준을 남기고 끝나면 바뀐 파일과 줄 수를 낸다(비밀 파일은 목록에 없다)', async () => {
    const keeper = make();
    await keeper.begin('job1', { repoRoot: repo, cwd: repo, place: 'repo' });
    teamWorks();
    await keeper.finishInPlace('job1');
    const view = await keeper.changes('job1');
    expect(view).not.toBeNull();
    const byPath = Object.fromEntries(view!.files.map((f) => [f.path, f]));
    expect(Object.keys(byPath).sort()).toEqual(['a.txt', 'gone.txt', 'new/dir/n.ts']);
    expect(byPath['a.txt']).toMatchObject({ kind: 'modified', added: 2, removed: 1 });
    expect(byPath['new/dir/n.ts']).toMatchObject({ kind: 'added', added: 2, removed: 0 });
    expect(byPath['gone.txt']).toMatchObject({ kind: 'deleted', added: 0, removed: 1 });
    expect(view!.hiddenCount).toBe(1);
    expect(view!.revertBlock).toBeNull();
  });

  it('바뀐 게 없으면 기록을 남기지 않는다', async () => {
    const keeper = make();
    await keeper.begin('job1', { repoRoot: repo, cwd: repo, place: 'repo' });
    await keeper.finishInPlace('job1');
    expect(await keeper.changes('job1')).toBeNull();
  });

  it('git 저장소가 아닌 폴더에서는 아무것도 남기지 않고 작업도 막지 않는다', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'rauha-cp-plain-'));
    const ceiling = process.env['GIT_CEILING_DIRECTORIES'];
    process.env['GIT_CEILING_DIRECTORIES'] = tmpdir(); // 임시 폴더 위에 다른 저장소가 있어도 찾아 올라가지 않게
    try {
      const keeper = make();
      await keeper.begin('job1', { repoRoot: plain, cwd: plain, place: 'repo' });
      await keeper.finishInPlace('job1');
      expect(await keeper.changes('job1')).toBeNull();
    } finally {
      if (ceiling === undefined) delete process.env['GIT_CEILING_DIRECTORIES'];
      else process.env['GIT_CEILING_DIRECTORIES'] = ceiling;
      rmSync(plain, { recursive: true, force: true });
    }
  });

  it('시작할 때 이미 커밋 안 한 내 변경은 작업이 한 일로 세지 않는다', async () => {
    put(repo, 'b.txt', 'bee mine\n');
    const keeper = make();
    await keeper.begin('job1', { repoRoot: repo, cwd: repo, place: 'repo' });
    put(repo, 'a.txt', 'changed by job\n');
    await keeper.finishInPlace('job1');
    const view = await keeper.changes('job1');
    expect(view!.files.map((f) => f.path)).toEqual(['a.txt']);
    expect(view!.startDirty).toBe(1);
  });

  it('파일 diff 를 읽고, 목록에 없는 파일·비밀 파일·경로 탈출은 거절한다', async () => {
    const keeper = make();
    await keeper.begin('job1', { repoRoot: repo, cwd: repo, place: 'repo' });
    teamWorks();
    await keeper.finishInPlace('job1');
    const d = await keeper.diff('job1', 'a.txt');
    expect(d.hunks[0]!.lines.some((l) => l.kind === 'add' && l.text === 'TWO')).toBe(true);
    await expect(keeper.diff('job1', '.env')).rejects.toThrow(/not part|hidden/);
    await expect(keeper.diff('job1', 'b.txt')).rejects.toThrow(/not part/);
    await expect(keeper.diff('job1', '../../etc/passwd')).rejects.toThrow(/cannot be used/);
    await expect(keeper.diff('job1', '.git/config')).rejects.toThrow(/cannot be used/);
  });

  it('기록은 파일에 남고 앱을 다시 켜도 읽힌다', async () => {
    const first = make();
    await first.begin('job1', { repoRoot: repo, cwd: repo, place: 'repo' });
    teamWorks();
    await first.finishInPlace('job1');
    const second = make();
    await second.load();
    expect((await second.changes('job1'))!.files).toHaveLength(3);
  });

  it('깨진 기록 파일은 .bak 으로 남기고 빈 기록으로 시작한다', async () => {
    writeFileSync(join(data, 'checkpoints.json'), '{ not json');
    const keeper = make();
    await keeper.load();
    expect(await keeper.changes('job1')).toBeNull();
    expect(require('node:fs').readdirSync(data).some((n: string) => n.startsWith('checkpoints.json.bak-'))).toBe(true);
  });
});

describe('CheckpointKeeper 되돌리기', () => {
  const done = async () => {
    const keeper = make();
    await keeper.begin('job1', { repoRoot: repo, cwd: repo, place: 'repo' });
    teamWorks();
    await keeper.finishInPlace('job1');
    return keeper;
  };

  it('파일 하나만 작업 시작 때 내용으로 되돌린다', async () => {
    const keeper = await done();
    const out = await keeper.revert('job1', ['a.txt']);
    expect(out.reverted).toBe(1);
    expect(read(repo, 'a.txt')).toBe('one\ntwo\nthree\n');
    expect(existsSync(join(repo, 'new/dir/n.ts'))).toBe(true);
    expect(existsSync(join(repo, 'gone.txt'))).toBe(false);
  });

  it('전체 되돌리기는 수정은 복원하고 새 파일은 지우고 지운 파일은 되살리며 비밀 파일은 건드리지 않는다', async () => {
    const keeper = await done();
    const out = await keeper.revert('job1');
    expect(out.reverted).toBe(3);
    expect(read(repo, 'a.txt')).toBe('one\ntwo\nthree\n');
    expect(existsSync(join(repo, 'new'))).toBe(false);
    expect(read(repo, 'gone.txt')).toBe('will be deleted\n');
    expect(read(repo, '.env')).toBe('SECRET=1\n');
    expect(git(repo, 'status', '--porcelain')).toBe('?? .env');
    const view = await keeper.changes('job1');
    expect(Object.values(view!.states).every((s) => s === 'already')).toBe(true);
  });

  it('확인 전 미리보기는 파일 수·줄 수·새 파일 삭제를 알려 주고 파일은 바꾸지 않는다', async () => {
    const keeper = await done();
    const p = await keeper.preview('job1');
    expect(p.files).toBe(3);
    expect(p.body).toContain('Removes 4 lines');
    expect(p.body).toContain('new/dir/n.ts');
    expect(read(repo, 'a.txt')).toBe('one\nTWO\nthree\nfour\n');
  });

  it('작업 뒤에 내가 직접 고친 파일은 덮어쓰지 않고 충돌로 건너뛴다', async () => {
    const keeper = await done();
    put(repo, 'a.txt', 'my own edit after the job\n');
    const p = await keeper.preview('job1');
    expect(p.conflicts).toEqual(['a.txt']);
    const out = await keeper.revert('job1');
    expect(out.conflicts).toEqual(['a.txt']);
    expect(out.reverted).toBe(2);
    expect(read(repo, 'a.txt')).toBe('my own edit after the job\n');
    expect(read(repo, 'gone.txt')).toBe('will be deleted\n');
  });

  it('되돌리기 전에 백업을 만들고 Undo the undo 로 원래대로 돌린다', async () => {
    const keeper = await done();
    const out = await keeper.revert('job1');
    expect(out.backupId).not.toBeNull();
    expect(existsSync(join(data, 'undo-backups', `${out.backupId}.patch`))).toBe(true);
    expect((await keeper.changes('job1'))!.backup?.id).toBe(out.backupId);
    await keeper.undoRevert('job1');
    expect(read(repo, 'a.txt')).toBe('one\nTWO\nthree\nfour\n');
    expect(read(repo, 'new/dir/n.ts')).toBe('export const n = 1;\nexport const m = 2;\n');
    expect(existsSync(join(repo, 'gone.txt'))).toBe(false);
    expect(existsSync(join(data, 'undo-backups', `${out.backupId}.patch`))).toBe(false);
    await expect(keeper.undoRevert('job1')).rejects.toThrow(/no backup/);
  });

  it('되돌린 뒤 파일을 또 고쳤으면 Undo the undo 는 아무것도 바꾸지 않고 이유를 말한다', async () => {
    const keeper = await done();
    await keeper.revert('job1');
    put(repo, 'a.txt', 'edited again\n');
    await expect(keeper.undoRevert('job1')).rejects.toThrow(/Nothing was changed/);
    expect(read(repo, 'a.txt')).toBe('edited again\n');
  });

  it('바이너리 파일도 백업에서 그대로 돌아온다', async () => {
    const keeper = make();
    await keeper.begin('job1', { repoRoot: repo, cwd: repo, place: 'repo' });
    const bytes = Buffer.from([0, 1, 2, 255, 254, 0, 9]);
    writeFileSync(join(repo, 'bin.dat'), bytes);
    await keeper.finishInPlace('job1');
    await keeper.revert('job1');
    expect(existsSync(join(repo, 'bin.dat'))).toBe(false);
    await keeper.undoRevert('job1');
    expect(readFileSync(join(repo, 'bin.dat')).equals(bytes)).toBe(true);
  });

  it('보호 브랜치(main)에서도 커밋 이력은 바꾸지 않고 작업 폴더만 바꾼다', async () => {
    const keeper = await done();
    const before = git(repo, 'rev-parse', 'HEAD');
    await keeper.revert('job1');
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(before);
    expect(git(repo, 'branch', '--show-current')).toBe('main');
    expect(git(repo, 'stash', 'list')).toBe('');
  });

  it('작업 중에 커밋이 생겼으면 되돌리기를 거절한다', async () => {
    const keeper = make();
    await keeper.begin('job1', { repoRoot: repo, cwd: repo, place: 'repo' });
    put(repo, 'a.txt', 'x\n');
    git(repo, 'commit', '-q', '-am', 'job committed');
    put(repo, 'b.txt', 'y\n');
    await keeper.finishInPlace('job1');
    const view = await keeper.changes('job1');
    expect(view!.revertBlock).toMatch(/Commits were made/);
    await expect(keeper.revert('job1')).rejects.toThrow(/Commits were made/);
  });

  it('링크로 바뀐 경로는 따라가지 않고 충돌로 건너뛴다', async () => {
    const keeper = await done();
    const outside = mkdtempSync(join(tmpdir(), 'rauha-cp-out-'));
    writeFileSync(join(outside, 'victim.txt'), 'do not touch');
    rmSync(join(repo, 'a.txt'));
    try {
      symlinkSync(join(outside, 'victim.txt'), join(repo, 'a.txt'));
    } catch {
      rmSync(outside, { recursive: true, force: true });
      return; // 링크를 만들 권한이 없는 환경
    }
    const out = await keeper.revert('job1', ['a.txt']);
    expect(out.conflicts).toEqual(['a.txt']);
    expect(readFileSync(join(outside, 'victim.txt'), 'utf8')).toBe('do not touch');
    rmSync(outside, { recursive: true, force: true });
  });

  it('두 번 연달아 눌러도 두 번째는 이미 되돌려져 있어 아무것도 하지 않는다', async () => {
    const keeper = await done();
    const [a, b] = await Promise.all([keeper.revert('job1'), keeper.revert('job1')]);
    expect(a.reverted + b.reverted).toBe(3);
    expect(read(repo, 'a.txt')).toBe('one\ntwo\nthree\n');
  });

  it('백업은 20개를 넘으면 오래된 patch 파일부터 지운다', async () => {
    const keeper = make();
    for (let i = 0; i < 22; i += 1) {
      const job = `job${i}`;
      await keeper.begin(job, { repoRoot: repo, cwd: repo, place: 'repo' });
      put(repo, 'a.txt', `round ${i}\n`);
      await keeper.finishInPlace(job);
      await keeper.revert(job);
    }
    const files = require('node:fs').readdirSync(join(data, 'undo-backups')).filter((n: string) => n.endsWith('.patch'));
    expect(files).toHaveLength(20);
  }, 120_000);
});

describe('CheckpointKeeper worktree 브랜치', () => {
  const branchJob = async (branch = 'rauha/job-abc12345') => {
    const wt = join(mkdtempSync(join(tmpdir(), 'rauha-cp-wt-')), 'wt');
    git(repo, 'worktree', 'add', '--detach', wt, 'HEAD');
    const keeper = make();
    await keeper.begin('job1', { repoRoot: repo, cwd: wt, place: 'worktree' });
    put(wt, 'a.txt', 'branch change\n');
    put(wt, 'only/in/branch.ts', 'x\n');
    git(wt, 'checkout', '-q', '-b', branch);
    git(wt, 'add', '-A');
    git(wt, 'commit', '-q', '-m', 'job');
    git(repo, 'worktree', 'remove', '--force', wt);
    await keeper.finishBranch('job1', branch);
    return keeper;
  };

  it('worktree 작업은 브랜치가 체크포인트라 변경 목록은 보이고 파일 되돌리기는 막는다', async () => {
    const keeper = await branchJob();
    const view = await keeper.changes('job1');
    expect(view!.files.map((f) => f.path)).toEqual(['a.txt', 'only/in/branch.ts']);
    expect(view!.revertBlock).toMatch(/Discard branch/);
    expect(view!.workBranch).toBe('rauha/job-abc12345');
    expect((await keeper.diff('job1', 'a.txt')).hunks.length).toBe(1);
    await expect(keeper.revert('job1')).rejects.toThrow(/Discard branch/);
  });

  it('브랜치 버리기는 브랜치를 지우고 내 작업 폴더는 그대로 둔다', async () => {
    const keeper = await branchJob();
    await keeper.discardBranch('job1');
    expect(git(repo, 'branch', '--list', 'rauha/job-abc12345')).toBe('');
    expect(read(repo, 'a.txt')).toBe('one\ntwo\nthree\n');
    await expect(keeper.discardBranch('job1')).rejects.toThrow(/already/);
  });

  it('보호 브랜치 이름이면 버리지 않는다', async () => {
    const keeper = await branchJob('release/1.0');
    await expect(keeper.discardBranch('job1')).rejects.toThrow(/protected/);
    expect(git(repo, 'branch', '--list', 'release/1.0')).not.toBe('');
  });

  it('작업 뒤 브랜치에 새 커밋이 생겼으면 버리지 않는다', async () => {
    const keeper = await branchJob();
    git(repo, 'checkout', '-q', 'rauha/job-abc12345');
    put(repo, 'extra.txt', 'later\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'later');
    git(repo, 'checkout', '-q', 'main');
    await expect(keeper.discardBranch('job1')).rejects.toThrow(/new commits/);
  });
});
