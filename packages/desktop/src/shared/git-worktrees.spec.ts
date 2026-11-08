import { describe, expect, it } from 'vitest';
import { parseWorktrees, worktreeName } from './git-worktrees.js';

describe('parseWorktrees', () => {
  const text = ['worktree /w/app', 'HEAD 1234567890abcdef', 'branch refs/heads/main', '', 'worktree /w/wt/job1', 'HEAD abcdef1234567890', 'branch refs/heads/feature/a', 'locked reason', '', 'worktree /w/wt/old', 'HEAD 0000000aaaa', 'detached', 'prunable gone', ''].join('\n');
  it('첫 항목을 메인 작업 폴더로 읽는다', () => {
    const r = parseWorktrees(text);
    expect(r).toHaveLength(3);
    expect(r[0]).toMatchObject({ path: '/w/app', branch: 'main', head: '1234567', main: true });
    expect(r[1]).toMatchObject({ branch: 'feature/a', main: false, locked: true });
  });
  it('분리된 HEAD는 브랜치가 없고 사라진 폴더는 prunable이다', () => {
    expect(parseWorktrees(text)[2]).toMatchObject({ branch: null, prunable: true });
  });
  it('빈 출력은 빈 목록이다', () => {
    expect(parseWorktrees('')).toEqual([]);
  });
  it('폴더 이름은 경로 마지막 칸이다', () => {
    expect(worktreeName(['C:', 'w', 'wt', 'job1', ''].join(String.fromCharCode(92)))).toBe('job1');
  });
});
