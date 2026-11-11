import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CheckpointDiff } from '../../shared/checkpoint-api.js';
import { CheckpointStore } from '../data/checkpoint-store.js';
import { CheckpointKeeper } from './checkpoint-keeper.js';

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();
const lines = (n: number, patch: Record<number, string> = {}): string[] => Array.from({ length: n }, (_, i) => patch[i + 1] ?? `line${String(i + 1).padStart(2, '0')}`);
const body = (eol: string, patch: Record<number, string> = {}, n = 30): string => lines(n, patch).join(eol) + eol;
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
    protectedBranches: () => ['main'],
    newId: () => `hunk-backup-${String(++seq).padStart(4, '0')}`,
    now: () => '2026-11-11T00:00:00.000Z',
  });

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(data, { recursive: true, force: true });
});

/** 윈도우 CI 는 autocrlf=true 라서 true/false 둘 다 같은 규칙이 지켜져야 한다 */
describe.each([['false'], ['true']])('CheckpointKeeper hunk 되돌리기 (autocrlf=%s)', (autocrlf) => {
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'rauha-hunk-repo-'));
    data = mkdtempSync(join(tmpdir(), 'rauha-hunk-data-'));
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'config', 'user.email', 't@t');
    git(repo, 'config', 'user.name', 't');
    git(repo, 'config', 'core.autocrlf', autocrlf);
    put(repo, 'lf.txt', body('\n'));
    put(repo, 'crlf.txt', body('\r\n'));
    put(repo, 'gone.txt', 'bye\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'first');
  });

  /** 팀이 파일의 3째 줄과 25째 줄을 고쳤다(멀리 떨어져 hunk 가 둘) */
  const twoHunkJob = async (file = 'lf.txt', eol = '\n') => {
    const keeper = make();
    await keeper.begin('job1', { repoRoot: repo, cwd: repo, place: 'repo' });
    put(repo, file, body(eol, { 3: 'THREE', 25: 'TWENTY-FIVE' }));
    await keeper.finishInPlace('job1');
    const diff = (await keeper.diff('job1', file)) as CheckpointDiff;
    return { keeper, diff };
  };

  it('diff 가 hunk 마다 내용 해시와 상태(pending)를 함께 준다', async () => {
    const { diff } = await twoHunkJob();
    expect(diff.hunks).toHaveLength(2);
    expect(diff.hunkIds).toHaveLength(2);
    expect(new Set(diff.hunkIds).size).toBe(2);
    expect(diff.hunkStates).toEqual(['pending', 'pending']);
  });

  it('hunk 하나만 작업 전으로 되돌리고 다른 hunk 는 그대로 둔다', async () => {
    const { keeper, diff } = await twoHunkJob();
    const out = await keeper.revertHunk('job1', 'lf.txt', diff.hunkIds[0]!);
    expect(out).toMatchObject({ reverted: 1, conflicts: [] });
    expect(read(repo, 'lf.txt')).toBe(body('\n', { 25: 'TWENTY-FIVE' }));
    const after = (await keeper.diff('job1', 'lf.txt')) as CheckpointDiff;
    expect(after.hunkStates).toEqual(['already', 'pending']);
  });

  it('남은 hunk 도 이어서 되돌리면 파일이 작업 전과 같아진다', async () => {
    const { keeper, diff } = await twoHunkJob();
    await keeper.revertHunk('job1', 'lf.txt', diff.hunkIds[0]!);
    await keeper.revertHunk('job1', 'lf.txt', diff.hunkIds[1]!);
    expect(read(repo, 'lf.txt')).toBe(body('\n'));
    expect(git(repo, 'status', '--porcelain')).toBe('');
  });

  it('CRLF 파일의 hunk 를 되돌려도 줄 끝이 CRLF 로 남는다', async () => {
    const { keeper, diff } = await twoHunkJob('crlf.txt', '\r\n');
    expect(diff.hunkStates).toEqual(['pending', 'pending']);
    const out = await keeper.revertHunk('job1', 'crlf.txt', diff.hunkIds[1]!);
    expect(out.reverted).toBe(1);
    expect(read(repo, 'crlf.txt')).toBe(body('\r\n', { 3: 'THREE' }));
  });

  it('되돌리기 전에 백업을 남기고 Undo the undo 로 그 hunk 를 다시 살린다', async () => {
    const { keeper, diff } = await twoHunkJob();
    const out = await keeper.revertHunk('job1', 'lf.txt', diff.hunkIds[0]!);
    expect(out.backupId).not.toBeNull();
    expect((await keeper.changes('job1'))!.backup).toMatchObject({ files: 1 });
    await keeper.undoRevert('job1');
    expect(read(repo, 'lf.txt')).toBe(body('\n', { 3: 'THREE', 25: 'TWENTY-FIVE' }));
  });

  it('미리보기는 지워질 줄과 돌아올 줄을 말하고 파일은 건드리지 않는다', async () => {
    const { keeper, diff } = await twoHunkJob();
    const p = await keeper.previewHunk('job1', 'lf.txt', diff.hunkIds[0]!);
    expect(p).toMatchObject({ files: 1, conflicts: [], okLabel: 'Revert hunk' });
    expect(p.body).toContain('Removes 1 line the job added and brings back 1 line it deleted');
    expect(read(repo, 'lf.txt')).toBe(body('\n', { 3: 'THREE', 25: 'TWENTY-FIVE' }));
  });

  it('작업 뒤 사용자가 그 hunk 자리를 고쳤으면 충돌로 건너뛰고 아무것도 바꾸지 않는다', async () => {
    const { keeper, diff } = await twoHunkJob();
    put(repo, 'lf.txt', body('\n', { 3: 'MY OWN EDIT', 25: 'TWENTY-FIVE' }));
    const states = ((await keeper.diff('job1', 'lf.txt')) as CheckpointDiff).hunkStates;
    expect(states).toEqual(['conflict', 'pending']);
    const p = await keeper.previewHunk('job1', 'lf.txt', diff.hunkIds[0]!);
    expect(p).toMatchObject({ files: 0, conflicts: ['lf.txt'] });
    const out = await keeper.revertHunk('job1', 'lf.txt', diff.hunkIds[0]!);
    expect(out).toMatchObject({ reverted: 0, conflicts: ['lf.txt'], backupId: null });
    expect(read(repo, 'lf.txt')).toBe(body('\n', { 3: 'MY OWN EDIT', 25: 'TWENTY-FIVE' }));
    expect((await keeper.changes('job1'))!.backup).toBeNull();
  });

  it('작업 뒤 다른 자리를 고쳤다면 그 hunk 는 되돌리고 내 수정은 남긴다', async () => {
    const { keeper, diff } = await twoHunkJob();
    put(repo, 'lf.txt', body('\n', { 3: 'THREE', 25: 'TWENTY-FIVE', 15: 'mine in the middle' }));
    const out = await keeper.revertHunk('job1', 'lf.txt', diff.hunkIds[0]!);
    expect(out.reverted).toBe(1);
    expect(read(repo, 'lf.txt')).toBe(body('\n', { 25: 'TWENTY-FIVE', 15: 'mine in the middle' }));
  });

  it('이미 되돌린 hunk 를 또 되돌리려 하면 아무것도 안 하고 알린다', async () => {
    const { keeper, diff } = await twoHunkJob();
    await keeper.revertHunk('job1', 'lf.txt', diff.hunkIds[0]!);
    const again = await keeper.previewHunk('job1', 'lf.txt', diff.hunkIds[0]!);
    expect(again.files).toBe(0);
    expect(again.body).toMatch(/already/i);
    expect(await keeper.revertHunk('job1', 'lf.txt', diff.hunkIds[0]!)).toMatchObject({ reverted: 0, backupId: null });
  });

  it('화면에 보인 hunk 가 지금 diff 와 다르면(해시가 없으면) 거절한다', async () => {
    const { keeper } = await twoHunkJob();
    await expect(keeper.revertHunk('job1', 'lf.txt', '0123456789abcdef')).rejects.toThrow(/no longer match/i);
    await expect(keeper.previewHunk('job1', 'lf.txt', '0123456789abcdef')).rejects.toThrow(/no longer match/i);
    expect(read(repo, 'lf.txt')).toBe(body('\n', { 3: 'THREE', 25: 'TWENTY-FIVE' }));
  });

  it('새 파일·지운 파일·목록에 없는 파일·비밀 파일은 hunk 로 되돌리지 않는다', async () => {
    const keeper = make();
    await keeper.begin('job1', { repoRoot: repo, cwd: repo, place: 'repo' });
    put(repo, 'new.txt', 'a\nb\n');
    writeFileSync(join(repo, '.env'), 'SECRET=1\n');
    rmSync(join(repo, 'gone.txt'));
    put(repo, 'lf.txt', body('\n', { 3: 'THREE' }));
    await keeper.finishInPlace('job1');
    const id = ((await keeper.diff('job1', 'lf.txt')) as CheckpointDiff).hunkIds[0]!;
    for (const path of ['new.txt', 'gone.txt', 'crlf.txt', '.env']) await expect(keeper.revertHunk('job1', path, id)).rejects.toThrow();
    expect(read(repo, 'new.txt')).toBe('a\nb\n');
    // 새 파일·지운 파일의 diff 에는 hunk 상태(되돌리기 단추)가 없다
    expect(((await keeper.diff('job1', 'new.txt')) as CheckpointDiff).hunkStates).toEqual([]);
    expect(((await keeper.diff('job1', 'gone.txt')) as CheckpointDiff).hunkStates).toEqual([]);
  });

  it('작업 중 커밋이 있었으면 hunk 되돌리기도 막는다', async () => {
    const keeper = make();
    await keeper.begin('job1', { repoRoot: repo, cwd: repo, place: 'repo' });
    put(repo, 'lf.txt', body('\n', { 3: 'THREE' }));
    git(repo, 'commit', '-q', '-am', 'job commit');
    put(repo, 'crlf.txt', body('\r\n', { 5: 'FIVE' }));
    await keeper.finishInPlace('job1');
    const view = await keeper.changes('job1');
    expect(view?.revertBlock).not.toBeNull();
    await expect(keeper.revertHunk('job1', 'crlf.txt', '0123456789abcdef')).rejects.toThrow(/Commits were made/);
  });

  it('파일이 레포 밖을 가리키는 링크로 바뀌었으면 건드리지 않는다', async () => {
    const { keeper, diff } = await twoHunkJob();
    const outside = mkdtempSync(join(tmpdir(), 'rauha-hunk-out-'));
    writeFileSync(join(outside, 'victim.txt'), body('\n', { 3: 'THREE' }));
    rmSync(join(repo, 'lf.txt'));
    try {
      symlinkSync(join(outside, 'victim.txt'), join(repo, 'lf.txt'));
    } catch {
      rmSync(outside, { recursive: true, force: true });
      return; // 링크를 만들 권한이 없는 환경
    }
    const out = await keeper.revertHunk('job1', 'lf.txt', diff.hunkIds[0]!);
    expect(out.reverted).toBe(0);
    expect(readFileSync(join(outside, 'victim.txt'), 'utf8')).toBe(body('\n', { 3: 'THREE' }));
    rmSync(outside, { recursive: true, force: true });
  });

  it('UTF-8 이 아닌 내용이 든 hunk 는 글자가 깨질 수 있어 되돌리기 단추를 주지 않는다', async () => {
    const keeper = make();
    await keeper.begin('job1', { repoRoot: repo, cwd: repo, place: 'repo' });
    writeFileSync(join(repo, 'lf.txt'), Buffer.concat([Buffer.from('line01\nline02\n'), Buffer.from([0xe9, 0x0a]), Buffer.from(body('\n').split('\n').slice(3).join('\n'))]));
    await keeper.finishInPlace('job1');
    const d = (await keeper.diff('job1', 'lf.txt')) as CheckpointDiff;
    expect(d.hunkStates).toEqual([]);
  });
});
