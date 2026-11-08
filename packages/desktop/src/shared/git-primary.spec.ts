import { describe, expect, it } from 'vitest';
import { primaryGitAction, type GitPrimaryInput } from './git-primary.js';

const base: GitPrimaryInput = { staged: 0, conflicts: false, merging: false, ahead: 0, behind: 0, hasRemote: true };

describe('primaryGitAction: 파랗게 강조하는 동작은 하나뿐이다', () => {
  it('스테이지한 변경이 있으면 커밋이다', () => {
    expect(primaryGitAction({ ...base, staged: 2, ahead: 3 })).toBe('commit');
  });
  it('커밋할 게 없고 뒤처졌으면 pull이다', () => {
    expect(primaryGitAction({ ...base, behind: 1, ahead: 2 })).toBe('pull');
  });
  it('커밋할 게 없고 앞서 있기만 하면 push다', () => {
    expect(primaryGitAction({ ...base, ahead: 2 })).toBe('push');
  });
  it('할 일이 없으면 강조하지 않는다', () => {
    expect(primaryGitAction(base)).toBeNull();
  });
  it('충돌이 있으면 아무것도 강조하지 않는다', () => {
    expect(primaryGitAction({ ...base, staged: 1, conflicts: true })).toBeNull();
  });
  it('머지 중에는 pull·push를 강조하지 않지만 마무리 커밋은 강조한다', () => {
    expect(primaryGitAction({ ...base, ahead: 1, merging: true })).toBeNull();
    expect(primaryGitAction({ ...base, staged: 1, merging: true })).toBe('commit');
  });
  it('원격이 없으면 pull·push는 강조하지 않는다', () => {
    expect(primaryGitAction({ ...base, ahead: 1, hasRemote: false })).toBeNull();
    expect(primaryGitAction({ ...base, staged: 1, hasRemote: false })).toBe('commit');
  });
});
