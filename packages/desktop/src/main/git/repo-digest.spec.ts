import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { repoDigest } from './repo-digest.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

let tick = 0;
function repo(): { root: string; commit: (msg: string, who: string) => void } {
  const root = mkdtempSync(join(tmpdir(), 'rauha-digest-'));
  dirs.push(root);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'me@x'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'me'], { cwd: root });
  let n = 0;
  return {
    root,
    commit: (msg, who) => {
      writeFileSync(join(root, `f${n++}.txt`), msg);
      execFileSync('git', ['add', '.'], { cwd: root });
      // 커밋마다 다른 시각(같은 초면 순서가 흔들린다)
      const date = `2026-11-1${(tick++ % 9) + 0}T10:00:00`;
      execFileSync('git', ['-c', `user.name=${who}`, 'commit', '-qm', msg], { cwd: root, env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
    },
  };
}

describe('저장소 변경 묶음용 git·파일 읽기', () => {
  it('저장소마다 모든 사람의 최근 커밋(새것부터)·브랜치·태그·CHANGELOG 앞부분을 읽는다', async () => {
    const r = repo();
    r.commit('결제 취소 추가', '김');
    execFileSync('git', ['tag', 'v1.0.0'], { cwd: r.root });
    r.commit('로그인 고침', '이');
    writeFileSync(join(r.root, 'CHANGELOG.md'), '# Changelog\n## 1.0.0\n- 결제 취소');
    const [got] = await repoDigest([{ name: 'shop', root: r.root }]);
    expect(got).toMatchObject({ name: 'shop', root: r.root, branch: 'main', tags: ['v1.0.0'], changelog: { path: 'CHANGELOG.md', head: '# Changelog\n## 1.0.0\n- 결제 취소' } });
    expect(got!.commits.map((c) => `${c.author}: ${c.subject}`)).toEqual(['이: 로그인 고침', '김: 결제 취소 추가']);
  });

  it('루트에 없으면 docs 아래 CHANGES·HISTORY·릴리스 노트도 CHANGELOG 로 찾는다', async () => {
    const r = repo();
    r.commit('처음', '김');
    mkdirSync(join(r.root, 'docs'));
    writeFileSync(join(r.root, 'docs', 'RELEASE_NOTES.md'), '## 0.1');
    const [got] = await repoDigest([{ name: 'a', root: r.root }]);
    expect(got!.changelog).toEqual({ path: 'docs/RELEASE_NOTES.md', head: '## 0.1' });
  });

  it('git 저장소가 아니어도 던지지 않고 빈 사실로 돌려준다', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rauha-digest-'));
    dirs.push(root);
    const before = process.env['GIT_CEILING_DIRECTORIES'];
    process.env['GIT_CEILING_DIRECTORIES'] = tmpdir();
    try {
      expect(await repoDigest([{ name: 'x', root }])).toEqual([{ name: 'x', root, branch: null, tags: [], commits: [], changelog: null }]);
    } finally {
      if (before === undefined) delete process.env['GIT_CEILING_DIRECTORIES'];
      else process.env['GIT_CEILING_DIRECTORIES'] = before;
    }
  });
});
