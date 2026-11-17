import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { standupLog } from './standup-log.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function repo(): { root: string; commit: (msg: string, who: string, date: string) => void } {
  const root = mkdtempSync(join(tmpdir(), 'rauha-standup-'));
  dirs.push(root);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'me@x'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'me'], { cwd: root });
  let n = 0;
  return {
    root,
    commit: (msg, who, date) => {
      writeFileSync(join(root, `f${n++}.txt`), msg);
      execFileSync('git', ['add', '.'], { cwd: root });
      execFileSync('git', ['-c', `user.email=${who}`, 'commit', '-qm', msg], { cwd: root, env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
    },
  };
}

describe('스탠드업용 git 읽기', () => {
  it('기간 안의 내 커밋만(남의 커밋·이전 커밋은 빼고), 브랜치와 커밋 안 한 변경 수를 읽는다', async () => {
    const r = repo();
    r.commit('예전 일', 'me@x', '2026-11-10T10:00:00');
    r.commit('남이 한 일', 'other@x', '2026-11-16T11:00:00');
    r.commit('환불 금액 고침', 'me@x', '2026-11-16T18:02:00');
    writeFileSync(join(r.root, 'wip.txt'), 'wip');
    const [got] = await standupLog([{ name: 'shop', root: r.root }], '2026-11-16');
    expect(got!.branch).toBe('main');
    expect(got!.dirty).toBe(1);
    expect(got!.commits.map((c) => c.subject)).toEqual(['환불 금액 고침']);
    expect(got!.commits[0]!.at).toBe('2026-11-16 18:02');
  });

  it('git 저장소가 아니면 비어 있는 사실로 돌려준다(던지지 않는다)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rauha-standup-'));
    dirs.push(root);
    // 홈 폴더가 git 저장소인 컴퓨터도 있어서, 위 폴더로 올라가 찾지 않게 막는다
    const before = process.env['GIT_CEILING_DIRECTORIES'];
    process.env['GIT_CEILING_DIRECTORIES'] = tmpdir();
    try {
      expect(await standupLog([{ name: 'x', root }], '2026-11-16')).toEqual([{ name: 'x', branch: null, dirty: 0, commits: [] }]);
    } finally {
      if (before === undefined) delete process.env['GIT_CEILING_DIRECTORIES'];
      else process.env['GIT_CEILING_DIRECTORIES'] = before;
    }
  });
});
