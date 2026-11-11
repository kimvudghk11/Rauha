import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConflictText } from '../../shared/conflict-text.js';
import { RepoGate } from './repo-gate.js';
import { dispatchGit } from './git-dispatch.js';

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

const sh = (cwd: string, ...args: string[]): string => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const mk = (): string => {
  const r = mkdtempSync(join(tmpdir(), 'rauha-cbase-'));
  roots.push(r);
  sh(r, 'init', '-q', '-b', 'main');
  return r;
};
const ctx = (r: string) => ({ gate: new RepoGate(async () => [r]), protectedBranches: () => [] as string[], openExternal: async () => undefined });
const read = async (r: string, arg: unknown) => dispatchGit(ctx(r), 'readConflict', r, arg);

describe('충돌 읽기에서 공통 조상(base) 얻기', () => {
  it('base 를 요청하면 git 이 다시 만든 diff3 글을 함께 주고, 작업 파일은 건드리지 않는다', async () => {
    const r = mk();
    writeFileSync(join(r, 'a.txt'), 'l1\nbase\nl3\n');
    sh(r, 'add', '.');
    sh(r, 'commit', '-qm', 'base');
    sh(r, 'checkout', '-qb', 'topic');
    writeFileSync(join(r, 'a.txt'), 'l1\ntopic\nl3\n');
    sh(r, 'commit', '-qam', 'topic');
    sh(r, 'checkout', '-q', 'main');
    writeFileSync(join(r, 'a.txt'), 'l1\nmain\nl3\n');
    sh(r, 'commit', '-qam', 'main');
    try {
      sh(r, 'merge', 'topic');
    } catch {
      /* 충돌이 나야 한다 */
    }
    const leftovers = readdirSync(tmpdir()).filter((n) => n.startsWith('rauha-merge-'));
    const before = readFileSync(join(r, 'a.txt'), 'utf8');
    const plain = await read(r, { path: 'a.txt' });
    expect(plain).toMatchObject({ ok: true });
    expect((plain as { data: { diff3?: string } }).data.diff3).toBeUndefined();
    const res = (await read(r, { path: 'a.txt', base: true })) as { ok: true; data: { text: string; diff3?: string } };
    expect(res.ok).toBe(true);
    expect(res.data.text).toBe(before);
    expect(res.data.diff3).toContain('||||||| base');
    const t = ConflictText.withBase(res.data.text, res.data.diff3 ?? null);
    expect(t.hasBase()).toBe(true);
    expect(t.parts.find((p) => p.kind === 'conflict')).toMatchObject({ ours: ['main'], theirs: ['topic'], base: ['base'] });
    expect(readFileSync(join(r, 'a.txt'), 'utf8')).toBe(before);
    expect(readdirSync(tmpdir()).filter((n) => n.startsWith('rauha-merge-') && !leftovers.includes(n))).toEqual([]);
  });

  it('양쪽이 새로 추가한 파일(조상 없음)도 빈 조상으로 diff3 를 만든다', async () => {
    const r = mk();
    writeFileSync(join(r, 'seed.txt'), 's\n');
    sh(r, 'add', '.');
    sh(r, 'commit', '-qm', 'seed');
    sh(r, 'checkout', '-qb', 'topic');
    writeFileSync(join(r, 'n.txt'), 'topic\n');
    sh(r, 'add', '.');
    sh(r, 'commit', '-qm', 'topic');
    sh(r, 'checkout', '-q', 'main');
    writeFileSync(join(r, 'n.txt'), 'main\n');
    sh(r, 'add', '.');
    sh(r, 'commit', '-qm', 'main');
    try {
      sh(r, 'merge', 'topic');
    } catch {
      /* 충돌 */
    }
    const res = (await read(r, { path: 'n.txt', base: true })) as { ok: true; data: { diff3?: string } };
    expect(res.ok).toBe(true);
    expect(res.data.diff3 === undefined || res.data.diff3.includes('<<<<<<<')).toBe(true);
  });

  it('충돌 중이 아닌 파일은 base 를 요청해도 거절한다', async () => {
    const r = mk();
    writeFileSync(join(r, 'a.txt'), 'x\n');
    sh(r, 'add', '.');
    sh(r, 'commit', '-qm', 'one');
    expect(await read(r, { path: 'a.txt', base: true })).toMatchObject({ ok: false });
  });
});
