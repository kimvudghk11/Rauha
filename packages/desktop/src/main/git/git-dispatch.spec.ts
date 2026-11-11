import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { GitFn, GitResult } from '../../shared/git-api.js';
import { dispatchGit } from './git-dispatch.js';
import { RepoGate } from './repo-gate.js';

const base = realpathSync(mkdtempSync(join(tmpdir(), 'rauha-git-')));
afterAll(() => rmSync(base, { recursive: true, force: true }));

const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
let n = 0;
function newRepo(): string {
  const root = join(base, `repo${n++}`);
  mkdirSync(root);
  sh(root, 'init', '-q', '-b', 'main');
  for (const [k, v] of [['user.name', 't'], ['user.email', 't@t'], ['core.autocrlf', 'false']] as const) sh(root, 'config', k, v);
  return root;
}
const write = (root: string, file: string, text: string) => writeFileSync(join(root, file), text);
const commitAll = (root: string, msg = 'c') => {
  sh(root, 'add', '-A');
  sh(root, 'commit', '-q', '-m', msg);
};

const opened: string[] = [];
let roots: string[] = [];
const gate = new RepoGate(async () => roots);
const call = async <T = unknown>(root: string, fn: GitFn, arg: unknown = {}): Promise<GitResult<T>> => {
  roots = [root];
  return (await dispatchGit({ gate, protectedBranches: () => ['main', 'qa', 'release', 'team-*'], openExternal: async (u) => void opened.push(u) }, fn, root, arg)) as GitResult<T>;
};
const data = async <T = unknown>(root: string, fn: GitFn, arg: unknown = {}): Promise<T> => {
  const r = await call<T>(root, fn, arg);
  if (!r.ok) throw new Error(`${fn}: ${r.error}`);
  return r.data;
};
const ten = Array.from({ length: 12 }, (_, i) => `line${i + 1}`).join('\n') + '\n';

beforeEach(() => {
  opened.length = 0;
});

describe('git 탭 main (임시 저장소)', () => {
  it('바뀐 파일을 M·?로 보이고 파일 단위로 스테이지·해제한다', async () => {
    const r = newRepo();
    write(r, 'a.txt', ten);
    commitAll(r);
    write(r, 'a.txt', ten + 'more\n');
    write(r, '새 파일.txt', 'x\n');
    const o = await data<{ branch: string; files: { path: string; label: string; staged: boolean }[] }>(r, 'overview');
    expect(o.branch).toBe('main');
    expect(o.files.map((f) => [f.path, f.label]).sort()).toEqual([['a.txt', 'M'], ['새 파일.txt', '?']]);
    await data(r, 'stage', { paths: ['a.txt', '새 파일.txt'] });
    expect((await data<{ files: { staged: boolean }[] }>(r, 'overview')).files.every((f) => f.staged)).toBe(true);
    await data(r, 'unstage', { paths: ['a.txt'] });
    expect((await data<{ files: { path: string; staged: boolean }[] }>(r, 'overview')).files.find((f) => f.path === 'a.txt')!.staged).toBe(false);
  });

  it('줄 단위로 고른 변경만 스테이지하고 나머지는 작업 폴더에 남긴다', async () => {
    const r = newRepo();
    write(r, 'a.txt', ten);
    commitAll(r);
    write(r, 'a.txt', ten.replace('line2\n', 'LINE2\nextra\n').replace('line11\n', 'LINE11\n'));
    const d = await data<{ hunks: { lines: { kind: string; text: string }[] }[] }>(r, 'diff', { path: 'a.txt', side: 'unstaged' });
    expect(d.hunks).toHaveLength(2);
    const lines = d.hunks[0]!.lines;
    const pick = [lines.findIndex((l) => l.text === 'line2'), lines.findIndex((l) => l.text === 'LINE2')];
    await data(r, 'stageSelection', { path: 'a.txt', selection: { lines: { 0: pick } }, mode: 'stage' });
    const staged = sh(r, 'diff', '--cached');
    expect(staged).toContain('+LINE2');
    expect(staged).not.toContain('+extra');
    expect(staged).not.toContain('LINE11');
    expect(sh(r, 'diff')).toContain('+extra');
    // 해제도 줄 단위
    await data(r, 'stageSelection', { path: 'a.txt', selection: { hunks: [0] }, mode: 'unstage' });
    expect(sh(r, 'diff', '--cached')).toBe('');
  });

  it('hunk 하나만 스테이지한다', async () => {
    const r = newRepo();
    write(r, 'a.txt', ten);
    commitAll(r);
    write(r, 'a.txt', ten.replace('line2\n', 'LINE2\n').replace('line11\n', 'LINE11\n'));
    await data(r, 'stageSelection', { path: 'a.txt', selection: { hunks: [1] }, mode: 'stage' });
    const staged = sh(r, 'diff', '--cached');
    expect(staged).toContain('LINE11');
    expect(staged).not.toContain('LINE2');
  });

  it('CRLF 파일도 줄 단위로 스테이지한다', async () => {
    const r = newRepo();
    write(r, 'w.txt', 'a\r\nb\r\nc\r\n');
    commitAll(r);
    write(r, 'w.txt', 'a\r\nB\r\nc\r\nd\r\n');
    const d = await data<{ hunks: { lines: { text: string }[] }[] }>(r, 'diff', { path: 'w.txt', side: 'unstaged' });
    const i = d.hunks[0]!.lines.findIndex((l) => l.text === 'd');
    await data(r, 'stageSelection', { path: 'w.txt', selection: { lines: { 0: [i] } }, mode: 'stage' });
    expect(sh(r, 'show', ':w.txt')).toBe('a\r\nb\r\nc\r\nd\r\n');
  });

  it('추적 안 하는 파일의 diff는 전부 추가 줄이다', async () => {
    const r = newRepo();
    write(r, 'seed', 's');
    commitAll(r);
    write(r, 'n.txt', 'one\ntwo\n');
    const d = await data<{ hunks: { lines: { kind: string }[] }[] }>(r, 'diff', { path: 'n.txt', side: 'unstaged' });
    expect(d.hunks[0]!.lines.map((l) => l.kind)).toEqual(['add', 'add']);
  });

  it('변경 버리기는 파일을 HEAD 상태로 되돌리고 새 파일은 지운다', async () => {
    const r = newRepo();
    write(r, 'a.txt', 'a\n');
    commitAll(r);
    write(r, 'a.txt', 'changed\n');
    write(r, 'tmp.txt', 'x');
    await data(r, 'discard', { paths: ['a.txt', 'tmp.txt'] });
    expect(readFileSync(join(r, 'a.txt'), 'utf8')).toBe('a\n');
    expect((await data<{ files: unknown[] }>(r, 'overview')).files).toEqual([]);
  });

  it('제목과 설명으로 커밋하고, 제목이 없거나 스테이지가 없으면 막는다', async () => {
    const r = newRepo();
    write(r, 'a.txt', 'a\n');
    expect((await call(r, 'commit', { subject: '제목', body: '' })).ok).toBe(false);
    await data(r, 'stage', { paths: ['a.txt'] });
    expect((await call(r, 'commit', { subject: '  ', body: '' })).ok).toBe(false);
    await data(r, 'commit', { subject: '-제목: 옵션처럼 보이는 글', body: '설명 한 줄' });
    expect(sh(r, 'log', '-1', '--format=%s|%b').trim()).toBe('-제목: 옵션처럼 보이는 글|설명 한 줄');
  });

  it('브랜치를 만들고 옮기며, 커밋 안 한 변경이 막으면 이유를 주고 강제로 하지 않는다', async () => {
    const r = newRepo();
    write(r, 'a.txt', 'a\n');
    commitAll(r);
    await data(r, 'createBranch', { name: 'feature/x' });
    write(r, 'a.txt', 'on x\n');
    commitAll(r, 'x');
    await data(r, 'switchBranch', { name: 'main' });
    write(r, 'a.txt', 'dirty\n');
    const blocked = await call(r, 'switchBranch', { name: 'feature/x' });
    expect(blocked).toMatchObject({ ok: false, code: 'BLOCKED' });
    expect(sh(r, 'branch', '--show-current').trim()).toBe('main');
    expect(readFileSync(join(r, 'a.txt'), 'utf8')).toBe('dirty\n');
    const list = await data<{ name: string; current: boolean }[]>(r, 'branches');
    expect(list.map((b) => b.name).sort()).toEqual(['feature/x', 'main']);
  });

  it('브랜치마다 마지막 커밋을 한 사람 이름을 주고, 작업 트리 목록은 메인 폴더를 먼저 준다', async () => {
    const r = newRepo();
    write(r, 'a.txt', 'a');
    commitAll(r);
    const list = await data<{ name: string; author: string }[]>(r, 'branches');
    expect(list[0]!.author).not.toBe('');
    const wts = await data<{ branch: string | null; main: boolean; changed: number }[]>(r, 'worktrees');
    expect(wts).toHaveLength(1);
    expect(wts[0]).toMatchObject({ branch: 'main', main: true, changed: 0 });
    write(r, 'b.txt', 'x');
    expect((await data<{ changed: number }[]>(r, 'worktrees'))[0]!.changed).toBe(1);
  });

  it('브랜치 이름이 옵션처럼 보이면 git에 넘기지 않는다', async () => {
    const r = newRepo();
    write(r, 'a', 'a');
    commitAll(r);
    expect(await call(r, 'createBranch', { name: '--orphan' })).toMatchObject({ ok: false, code: 'INVALID' });
    expect(await call(r, 'stage', { paths: ['../x'] })).toMatchObject({ ok: false, code: 'INVALID' });
    expect(await call(r, 'stage', { paths: ['-A'] })).toMatchObject({ ok: false, code: 'INVALID' });
  });

  it('알지 못하는 폴더와 함수 이름은 받지 않는다', async () => {
    const r = newRepo();
    expect(await call(r, 'nope' as GitFn)).toMatchObject({ ok: false, code: 'INVALID' });
    roots = [r];
    const ctx = { gate, protectedBranches: () => [], openExternal: async () => {} };
    expect(await dispatchGit(ctx, 'overview', base, {})).toMatchObject({ ok: false, code: 'UNKNOWN_REPO' });
    expect(await dispatchGit(ctx, 'overview', 42, {})).toMatchObject({ ok: false, code: 'UNKNOWN_REPO' });
  });

  it('보호 브랜치로 push·머지는 확인이 있어야 하고, 새 브랜치 push는 바로 된다', async () => {
    const r = newRepo();
    const remote = join(base, `remote${n++}.git`);
    sh(base, 'init', '-q', '--bare', '-b', 'main', remote);
    sh(r, 'remote', 'add', 'origin', remote);
    write(r, 'a', 'a');
    commitAll(r);
    expect(await call(r, 'push', {})).toMatchObject({ ok: false, code: 'PROTECTED' });
    expect((await call(r, 'push', { confirmed: true })).ok).toBe(true);
    await data(r, 'createBranch', { name: 'feat' });
    write(r, 'b', 'b');
    commitAll(r, 'b');
    expect((await call(r, 'push', {})).ok).toBe(true);
    expect(sh(remote, 'branch', '--list').replace(/[* ]/g, '').split('\n').filter(Boolean).sort()).toEqual(['feat', 'main']);
    await data(r, 'switchBranch', { name: 'main' });
    expect(await call(r, 'merge', { name: 'feat' })).toMatchObject({ ok: false, code: 'PROTECTED' });
    expect((await call(r, 'merge', { name: 'feat', confirmed: true })).ok).toBe(true);
    expect(await call(r, 'deleteBranch', { name: 'main' })).toMatchObject({ ok: false, code: 'BLOCKED' });
    expect((await call(r, 'deleteBranch', { name: 'feat' })).ok).toBe(true);
  });

  it('안전한 삭제(-d)는 합치지 않은 브랜치를 거절한다', async () => {
    const r = newRepo();
    write(r, 'a', 'a');
    commitAll(r);
    await data(r, 'createBranch', { name: 'wip' });
    write(r, 'b', 'b');
    commitAll(r, 'b');
    await data(r, 'switchBranch', { name: 'main' });
    expect(await call(r, 'deleteBranch', { name: 'wip' })).toMatchObject({ ok: false, code: 'BLOCKED' });
  });

  it('pull은 fast-forward만 하고, 갈라졌으면 이유를 준 뒤 merge 방식으로 충돌을 감지한다', async () => {
    const r = newRepo();
    const remote = join(base, `remote${n++}.git`);
    sh(base, 'init', '-q', '--bare', '-b', 'main', remote);
    sh(r, 'remote', 'add', 'origin', remote);
    write(r, 'a.txt', 'base\n');
    commitAll(r);
    sh(r, 'push', '-q', '-u', 'origin', 'main');
    const other = join(base, `clone${n++}`);
    sh(base, 'clone', '-q', remote, other);
    for (const [k, v] of [['user.name', 'o'], ['user.email', 'o@o'], ['core.autocrlf', 'false']] as const) sh(other, 'config', k, v);
    write(other, 'a.txt', 'theirs\n');
    commitAll(other, 'theirs');
    sh(other, 'push', '-q');
    write(r, 'a.txt', 'mine\n');
    commitAll(r, 'mine');
    await data(r, 'fetch');
    const o = await data<{ ahead: number; behind: number }>(r, 'overview');
    expect([o.ahead, o.behind]).toEqual([1, 1]);
    expect(await call(r, 'pull', { mode: 'ff' })).toMatchObject({ ok: false, code: 'BLOCKED' });
    const merged = await data<{ conflicts?: boolean }>(r, 'pull', { mode: 'merge' });
    expect(merged.conflicts).toBe(true);
    expect(await data(r, 'mergeState')).toEqual({ merging: true, conflicts: ['a.txt'] });
    await data(r, 'abortMerge');
    expect(readFileSync(join(r, 'a.txt'), 'utf8')).toBe('mine\n');
  });

  it('머지 충돌을 감지하고 내 것/상대 것/직접 편집으로 풀고 머지를 마친다', async () => {
    const r = newRepo();
    write(r, 'a.txt', 'base\n');
    write(r, 'b.txt', 'base\n');
    write(r, 'c.txt', 'base\n');
    commitAll(r);
    await data(r, 'createBranch', { name: 'topic' });
    for (const f of ['a.txt', 'b.txt', 'c.txt']) write(r, f, 'topic\n');
    commitAll(r, 'topic');
    await data(r, 'switchBranch', { name: 'main' });
    for (const f of ['a.txt', 'b.txt', 'c.txt']) write(r, f, 'main\n');
    commitAll(r, 'main');
    const res = await data<{ conflicts?: boolean }>(r, 'merge', { name: 'topic', confirmed: true });
    expect(res.conflicts).toBe(true);
    expect((await data<{ merging: boolean; conflicts: string[] }>(r, 'mergeState')).conflicts).toEqual(['a.txt', 'b.txt', 'c.txt']);
    expect(await call(r, 'finishMerge')).toMatchObject({ ok: false, code: 'BLOCKED' });
    await data(r, 'resolveSide', { path: 'a.txt', side: 'ours' });
    await data(r, 'resolveSide', { path: 'b.txt', side: 'theirs' });
    const { text } = await data<{ text: string }>(r, 'readConflict', { path: 'c.txt' });
    expect(text).toContain('<<<<<<<');
    expect(await call(r, 'markResolved', { path: 'c.txt' })).toMatchObject({ ok: false, code: 'BLOCKED' });
    await data(r, 'writeConflict', { path: 'c.txt', text: 'both\n' });
    await data(r, 'markResolved', { path: 'c.txt' });
    await data(r, 'finishMerge');
    expect([readFileSync(join(r, 'a.txt'), 'utf8'), readFileSync(join(r, 'b.txt'), 'utf8'), readFileSync(join(r, 'c.txt'), 'utf8')]).toEqual(['main\n', 'topic\n', 'both\n']);
    expect(sh(r, 'rev-list', '--parents', '-1', 'HEAD').trim().split(' ')).toHaveLength(3);
  });

  it('커밋 목록과 커밋별 diff를 읽는다', async () => {
    const r = newRepo();
    write(r, 'a.txt', 'a\n');
    commitAll(r, '첫째: 제목');
    write(r, 'a.txt', 'a\nb\n');
    write(r, 'img.bin', Buffer.from([0, 1, 2, 0, 3]).toString('latin1'));
    commitAll(r, '둘째');
    const log = await data<{ hash: string; subject: string; author: string }[]>(r, 'log');
    expect(log.map((l) => l.subject)).toEqual(['둘째', '첫째: 제목']);
    expect(log[0]!.author).toBe('t');
    const files = await data<{ path: string; hunks: { lines: { kind: string }[] }[] }[]>(r, 'commitDiff', { hash: log[0]!.hash });
    expect(files.map((f) => f.path).sort()).toEqual(['a.txt', 'img.bin']);
    expect(await call(r, 'commitDiff', { hash: '--output=x' })).toMatchObject({ ok: false });
  });

  it('PR 주소는 GitHub 원격일 때만 만들고 https만 연다', async () => {
    const r = newRepo();
    write(r, 'a', 'a');
    commitAll(r);
    await data(r, 'createBranch', { name: 'rauha/job-3f2a' });
    expect(await call(r, 'openPr', { base: 'main' })).toMatchObject({ ok: false });
    sh(r, 'remote', 'add', 'origin', 'git@github.com:acme/app.git');
    const out = await data<{ url: string }>(r, 'openPr', { base: 'main' });
    expect(out.url).toBe('https://github.com/acme/app/compare/main...rauha/job-3f2a?expand=1');
    expect(opened).toEqual([out.url]);
    const team = await data<{ name: string; team: boolean }[]>(r, 'branches');
    expect(team.find((b) => b.name === 'rauha/job-3f2a')!.team).toBe(true);
  });

  /** 원격(bare)과 이를 따라가는 레포, 같은 원격을 쓰는 다른 복제본 */
  const withRemote = () => {
    const r = newRepo();
    const remote = join(base, `remote${n++}.git`);
    sh(base, 'init', '-q', '--bare', '-b', 'main', remote);
    sh(r, 'remote', 'add', 'origin', remote);
    write(r, 'a.txt', 'base\n');
    commitAll(r);
    sh(r, 'push', '-q', '-u', 'origin', 'main');
    const other = join(base, `clone${n++}`);
    sh(base, 'clone', '-q', remote, other);
    for (const [k, v] of [['user.name', 'o'], ['user.email', 'o@o'], ['core.autocrlf', 'false']] as const) sh(other, 'config', k, v);
    return { r, remote, other };
  };

  it('개요에 마지막 fetch 시각과 스테이지한 줄 수를 담는다', async () => {
    const { r } = withRemote();
    type O = { fetchedAt: number | null; staged: { added: number; removed: number } | null };
    const before = await data<O>(r, 'overview');
    expect(before.staged).toEqual({ added: 0, removed: 0 });
    write(r, 'a.txt', 'base\nplus1\nplus2\n');
    await data(r, 'stage', { paths: ['a.txt'] });
    expect((await data<O>(r, 'overview')).staged).toEqual({ added: 2, removed: 0 });
    await data(r, 'fetch');
    const after = await data<O>(r, 'overview');
    expect(after.fetchedAt).toBeGreaterThan(Date.now() / 1000 - 120);
  });

  it('fetch와 pull은 받은 새 커밋 수를 알려 준다', async () => {
    const { r, other } = withRemote();
    const first = await data<{ message: string; received: number }>(r, 'fetch');
    expect(first.received).toBe(0);
    expect(first.message).toBe('Nothing new.');
    write(other, 'b.txt', 'b\n');
    commitAll(other, 'b');
    write(other, 'c.txt', 'c\n');
    commitAll(other, 'c');
    sh(other, 'push', '-q');
    const f = await data<{ message: string; received: number }>(r, 'fetch');
    expect(f).toMatchObject({ received: 2, message: 'The remote has 2 new commit(s). You can pull them.' });
    const p = await data<{ message: string; received: number }>(r, 'pull', { mode: 'ff' });
    expect(p).toMatchObject({ received: 2, message: 'Pulled 2 new commit(s).' });
    expect(await data(r, 'pull', { mode: 'ff' })).toMatchObject({ received: 0, message: 'Already up to date.' });
  });

  it('push가 거절되면 쉬운 말로 먼저 pull 하라고 알린다', async () => {
    const { r, other } = withRemote();
    write(other, 'b.txt', 'b\n');
    commitAll(other, 'b');
    sh(other, 'push', '-q');
    write(r, 'c.txt', 'c\n');
    commitAll(r, 'c');
    const res = await call(r, 'push', { confirmed: true });
    expect(res).toMatchObject({ ok: false });
    expect(res.ok ? '' : res.error).toMatch(/Pull first/);
  });

  it('새 브랜치는 기준 브랜치에서 만들고, 옮기지 않을 수도 있다', async () => {
    const r = newRepo();
    write(r, 'a', 'a');
    commitAll(r);
    await data(r, 'createBranch', { name: 'base1' });
    write(r, 'b', 'b');
    commitAll(r, 'b');
    await data(r, 'switchBranch', { name: 'main' });
    const done = await data<{ message: string }>(r, 'createBranch', { name: 'fix/y', base: 'base1', checkout: false });
    expect(done.message).toContain('Did not switch to it');
    expect(sh(r, 'branch', '--show-current').trim()).toBe('main');
    expect(sh(r, 'rev-parse', 'fix/y').trim()).toBe(sh(r, 'rev-parse', 'base1').trim());
    await data(r, 'createBranch', { name: 'fix/z', base: 'base1' });
    expect(sh(r, 'branch', '--show-current').trim()).toBe('fix/z');
  });

  it('새 브랜치의 기준 이름도 옵션처럼 보이면 받지 않는다', async () => {
    const r = newRepo();
    write(r, 'a', 'a');
    commitAll(r);
    expect(await call(r, 'createBranch', { name: 'ok', base: '--force' })).toMatchObject({ ok: false, code: 'INVALID' });
    expect(await call(r, 'createBranch', { name: 'ok', base: 'nothere' })).toMatchObject({ ok: false });
  });

  it('원격 브랜치에서 만든 새 브랜치는 그 원격 브랜치에 연결하지 않는다', async () => {
    const { r } = withRemote();
    await data(r, 'createBranch', { name: 'topic', base: 'origin/main' });
    expect(sh(r, 'for-each-ref', '--format=%(upstream)', 'refs/heads/topic').trim()).toBe('');
  });

  it('커밋 방식 안내를 레포의 최근 커밋에서 읽는다', async () => {
    const r = newRepo();
    for (const s of ['feat(ui): 가', 'fix(ui): 나', 'feat(api): 다', 'feat(ui): 라']) {
      write(r, 'f', s);
      commitAll(r, s);
    }
    const v = await data<{ commit: { known: boolean; text: string } }>(r, 'conventions');
    expect(v.commit.known).toBe(true);
    expect(v.commit.text).toContain('feat(scope): text');
  });

  it('직전 커밋 취소는 soft reset이라 변경이 스테이지에 남고, 이미 올린 커밋과 첫 커밋은 막는다', async () => {
    const { r } = withRemote();
    write(r, 'c.txt', 'c\n');
    commitAll(r, 'c');
    sh(r, 'push', '-q');
    expect(await call(r, 'undoCommit')).toMatchObject({ ok: false, code: 'BLOCKED' });
    write(r, 'd.txt', 'd\n');
    commitAll(r, 'd');
    const done = await data<{ message: string }>(r, 'undoCommit');
    expect(done.message).toContain('d');
    expect(sh(r, 'log', '-1', '--format=%s').trim()).toBe('c');
    expect(sh(r, 'status', '--porcelain').trim()).toBe('A  d.txt');
  });

  it('커밋이 하나뿐이면 취소하지 않는다', async () => {
    const r = newRepo();
    write(r, 'a', 'a');
    commitAll(r);
    expect(await call(r, 'undoCommit')).toMatchObject({ ok: false, code: 'BLOCKED' });
  });
});

describe('git 탭 stash (임시 저장소)', () => {
  type Row = { index: number; hash: string; message: string; branch: string };
  const listOf = (r: string) => data<Row[]>(r, 'stashList');
  const dirty = (r: string) => {
    write(r, 'a.txt', 'changed\n');
    write(r, 'new.txt', 'brand new\n');
  };
  const base = () => {
    const r = newRepo();
    write(r, 'a.txt', 'base\n');
    commitAll(r);
    return r;
  };

  it('바뀐 파일과 새 파일을 메시지와 함께 stash 하면 작업 폴더가 깨끗해지고 목록에 나타난다', async () => {
    const r = base();
    dirty(r);
    const done = await data<{ message: string }>(r, 'stash', { message: '결제 작업 중', includeUntracked: true });
    expect(done.message).toContain('결제 작업 중');
    expect(sh(r, 'status', '--porcelain').trim()).toBe('');
    const list = await listOf(r);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ index: 0, message: '결제 작업 중', branch: 'main' });
  });

  it('새 파일 포함을 끄면 추적 중인 파일만 stash 하고 새 파일은 그대로 둔다', async () => {
    const r = base();
    dirty(r);
    await data(r, 'stash', { includeUntracked: false });
    expect(sh(r, 'status', '--porcelain').trim()).toBe('?? new.txt');
  });

  it('stash 할 변경이 없으면 막는다(빈 stash 를 만들지 않는다)', async () => {
    const r = base();
    expect(await call(r, 'stash', { includeUntracked: true })).toMatchObject({ ok: false, code: 'BLOCKED' });
    write(r, 'only-new.txt', 'x\n');
    expect(await call(r, 'stash', { includeUntracked: false })).toMatchObject({ ok: false, code: 'BLOCKED' });
    expect(await listOf(r)).toHaveLength(0);
  });

  it('첫 커밋이 없는 저장소에서는 stash 하지 않는다', async () => {
    const empty = newRepo();
    write(empty, 'x', '1');
    expect(await call(empty, 'stash', { includeUntracked: true })).toMatchObject({ ok: false, code: 'BLOCKED' });
  });

  it('Apply 는 stash 를 남기고, Pop 은 적용한 뒤 목록에서 지운다', async () => {
    const r = base();
    dirty(r);
    await data(r, 'stash', { includeUntracked: true });
    const [s] = await listOf(r);
    await data(r, 'stashApply', { index: 0, hash: s?.hash });
    expect(readFileSync(join(r, 'a.txt'), 'utf8')).toBe('changed\n');
    expect(await listOf(r)).toHaveLength(1);
    sh(r, 'checkout', '--', 'a.txt');
    sh(r, 'clean', '-fq');
    await data(r, 'stashPop', { index: 0, hash: s?.hash });
    expect(readFileSync(join(r, 'new.txt'), 'utf8')).toBe('brand new\n');
    expect(await listOf(r)).toHaveLength(0);
  });

  it('지금 변경과 겹쳐 덮어써질 것 같으면 적용하지 않고 stash 도 지우지 않는다', async () => {
    const r = base();
    dirty(r);
    await data(r, 'stash', { includeUntracked: false });
    write(r, 'a.txt', 'other edit\n');
    const [s] = await listOf(r);
    const res = await call(r, 'stashPop', { index: 0, hash: s?.hash });
    expect(res).toMatchObject({ ok: false, code: 'BLOCKED' });
    expect(readFileSync(join(r, 'a.txt'), 'utf8')).toBe('other edit\n');
    expect(await listOf(r)).toHaveLength(1);
  });

  it('적용하다 충돌이 나면 충돌로 알리고 Pop 이어도 stash 를 남긴다', async () => {
    const r = base();
    write(r, 'a.txt', 'mine\n');
    await data(r, 'stash', { includeUntracked: true });
    write(r, 'a.txt', 'theirs\n');
    commitAll(r, 'other');
    const [s] = await listOf(r);
    const done = await data<{ conflicts?: boolean; message: string }>(r, 'stashPop', { index: 0, hash: s?.hash });
    expect(done.conflicts).toBe(true);
    expect(await listOf(r)).toHaveLength(1);
    expect((await data<{ conflicts: string[] }>(r, 'mergeState')).conflicts).toEqual(['a.txt']);
  });

  it('Drop 은 그 stash 하나만 지우고 되살릴 해시를 알린다', async () => {
    const r = base();
    dirty(r);
    await data(r, 'stash', { message: 'first', includeUntracked: true });
    write(r, 'a.txt', 'second\n');
    await data(r, 'stash', { message: 'second', includeUntracked: true });
    const list = await listOf(r);
    expect(list.map((x) => x.message)).toEqual(['second', 'first']);
    const done = await data<{ message: string }>(r, 'stashDrop', { index: 1, hash: list[1]?.hash });
    expect(done.message).toContain('git stash apply');
    expect((await listOf(r)).map((x) => x.message)).toEqual(['second']);
  });

  it('목록을 본 뒤 번호가 밀렸으면(해시가 다르면) 아무것도 하지 않는다', async () => {
    const r = base();
    dirty(r);
    await data(r, 'stash', { message: 'old', includeUntracked: true });
    const [old] = await listOf(r);
    write(r, 'a.txt', 'newer\n');
    await data(r, 'stash', { message: 'newer', includeUntracked: true });
    const res = await call(r, 'stashDrop', { index: 0, hash: old?.hash });
    expect(res).toMatchObject({ ok: false, code: 'BLOCKED' });
    expect(await listOf(r)).toHaveLength(2);
  });

  it('옵션처럼 읽히는 번호·해시·메시지, 없는 번호는 받지 않는다', async () => {
    const r = base();
    dirty(r);
    await data(r, 'stash', { includeUntracked: true });
    const [s] = await listOf(r);
    for (const arg of [{ index: '--all', hash: s?.hash }, { index: -1, hash: s?.hash }, { index: 0, hash: '--all' }, { index: 0 }, { index: 7, hash: s?.hash }]) {
      for (const fn of ['stashApply', 'stashPop', 'stashDrop'] as const) expect(await call(r, fn, arg)).toMatchObject({ ok: false });
    }
    expect(await call(r, 'stash', { message: 'a\nb' })).toMatchObject({ ok: false, code: 'INVALID' });
    expect(await call(r, 'stash', { message: 5 })).toMatchObject({ ok: false, code: 'INVALID' });
    expect(await listOf(r)).toHaveLength(1);
  });

  it('stash 함수는 허용 목록에 있는 이름만 받는다', async () => {
    const r = base();
    expect(await call(r, 'stashClear' as GitFn)).toMatchObject({ ok: false, code: 'INVALID' });
    expect(await call(r, 'stash --all' as GitFn)).toMatchObject({ ok: false, code: 'INVALID' });
  });
});
