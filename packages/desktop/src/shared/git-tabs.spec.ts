import { describe, expect, it } from 'vitest';
import { settleGitView, visibleGitViews } from './git-tabs.js';

const clean = { merging: false, files: [{ conflict: false }] };

describe('git 탭의 화면 탭', () => {
  it('충돌이 없으면 변경·브랜치·히스토리만 보인다', () => {
    expect(visibleGitViews(clean)).toEqual(['changes', 'branches', 'history']);
  });
  it('머지 중이거나 풀지 않은 충돌 파일이 있으면 충돌 탭이 더해진다', () => {
    expect(visibleGitViews({ merging: true, files: [] })).toContain('conflicts');
    expect(visibleGitViews({ merging: false, files: [{ conflict: true }] })).toContain('conflicts');
  });
  it('상태를 아직 모르면 충돌 탭 없이 기본 셋이다', () => {
    expect(visibleGitViews(null)).toEqual(['changes', 'branches', 'history']);
  });
  it('보이지 않는 탭에 있었다면 변경 탭으로 돌아오고, 보이는 탭이면 그대로다', () => {
    expect(settleGitView('conflicts', clean)).toBe('changes');
    expect(settleGitView('conflicts', { merging: true, files: [] })).toBe('conflicts');
    expect(settleGitView('history', clean)).toBe('history');
  });
});
