import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { pushedCommit, upstreamOf } from './ci-after-push.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function clone(): { work: string; git: (...a: string[]) => string } {
  const base = mkdtempSync(join(tmpdir(), 'rauha-ci-'));
  dirs.push(base);
  const bare = join(base, 'remote.git');
  const work = join(base, 'work');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  execFileSync('git', ['clone', '-q', bare, work]);
  const git = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: work }).toString().trim();
  writeFileSync(join(work, 'a.txt'), '1');
  git('add', '.');
  git('commit', '-qm', 'init');
  git('push', '-q', '-u', 'origin', 'main');
  return { work, git };
}

describe('작업이 push 했는지', () => {
  it('작업 중 push 했으면 github.com 저장소·커밋·브랜치를 알려 준다', async () => {
    const { work, git } = clone();
    const before = await upstreamOf(work);
    writeFileSync(join(work, 'a.txt'), '2');
    git('commit', '-qam', 'change');
    git('push', '-q');
    git('remote', 'set-url', 'origin', 'https://github.com/o/r.git');
    const pushed = await pushedCommit(work, before);
    expect(pushed?.repo.slug).toBe('o/r');
    expect(pushed?.sha).toBe(git('rev-parse', 'HEAD'));
    expect(pushed?.branch).toBe('main');
  });

  it('커밋만 하고 push 하지 않았거나 github.com 이 아니면 null', async () => {
    const { work, git } = clone();
    const before = await upstreamOf(work);
    writeFileSync(join(work, 'a.txt'), '2');
    git('commit', '-qam', 'change');
    git('remote', 'set-url', 'origin', 'https://github.com/o/r.git');
    expect(await pushedCommit(work, before)).toBeNull();
    git('remote', 'set-url', 'origin', join(work, '..', 'remote.git'));
    git('push', '-q');
    expect(await pushedCommit(work, before)).toBeNull(); // github.com 이 아님
  });
});
