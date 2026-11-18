import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fileHistory, parseBranchLine, repoStatus, searchRepos, showCommit } from './workspace-git.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function repo(): { root: string; commit: (file: string, body: string, msg: string) => void } {
  const root = mkdtempSync(join(tmpdir(), 'rauha-wsgit-'));
  dirs.push(root);
  const git = (...a: string[]) => execFileSync('git', a, { cwd: root });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'me@x');
  git('config', 'user.name', 'me');
  return {
    root,
    commit: (file, body, msg) => {
      writeFileSync(join(root, file), body);
      git('add', '.');
      git('commit', '-qm', msg);
    },
  };
}

describe('작업 공간 git 읽기', () => {
  it('브랜치 줄에서 원격·앞섬·뒤처짐을 읽는다', () => {
    expect(parseBranchLine('## main...origin/main [ahead 2, behind 1]')).toEqual({ branch: 'main', upstream: 'origin/main', ahead: 2, behind: 1 });
    expect(parseBranchLine('## feat')).toEqual({ branch: 'feat', upstream: null, ahead: 0, behind: 0 });
    expect(parseBranchLine('## HEAD (no branch)').branch).toBeNull();
  });

  it('상태: 커밋 안 한 파일·stash·최근 브랜치를 읽는다', async () => {
    const r = repo();
    r.commit('a.txt', '1', '처음');
    writeFileSync(join(r.root, 'a.txt'), '2');
    execFileSync('git', ['stash', '-q'], { cwd: r.root });
    writeFileSync(join(r.root, 'b.txt'), 'new');
    const [s] = await repoStatus([{ name: 'shop', root: r.root }]);
    expect(s).toMatchObject({ name: 'shop', branch: 'main', upstream: null, stashes: 1, changed: ['?? b.txt'] });
    expect(s!.branches.map((b) => b.name)).toEqual(['main']);
  });

  it('검색: 여러 저장소에서 글 그대로 찾고 비밀 파일은 뺀다', async () => {
    const a = repo();
    a.commit('pay.ts', 'function refund() {}\n', '결제');
    a.commit('.env', 'refund=secret\n', '설정');
    const b = repo();
    b.commit('x.ts', 'nothing\n', '처음');
    const hits = await searchRepos([{ name: 'a', root: a.root }, { name: 'b', root: b.root }], 'refund(', { fixed: true, glob: null, limit: 10 });
    expect(hits).toEqual([{ repo: 'a', path: 'pay.ts', line: 1, text: 'function refund() {}' }]);
  });

  it('파일 이력과 커밋 보기', async () => {
    const r = repo();
    r.commit('a.txt', '1', '처음');
    r.commit('a.txt', '2', '고침');
    const history = await fileHistory({ name: 'x', root: r.root }, 'a.txt');
    expect(history.map((c) => c.subject)).toEqual(['고침', '처음']);
    const shown = await showCommit({ name: 'x', root: r.root }, history[0]!.hash);
    expect(shown).toContain('고침');
    expect(shown).toContain('+2');
    expect(await showCommit({ name: 'x', root: r.root }, 'deadbeef')).toBeNull();
  });
});
