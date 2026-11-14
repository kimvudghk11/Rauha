import { describe, expect, it } from 'vitest';
import { primaryGitAction, type GitPrimaryInput } from './git-primary.js';
import { isPushRejected, switchBlockedByChanges, syncSentence } from './git-toolbar.js';

const base: GitPrimaryInput = { staged: 0, conflicts: false, merging: false, ahead: 0, behind: 0, hasRemote: true };

describe('저장소 막대의 상태 문장', () => {
  const s = { branch: 'main', upstream: 'origin/main', ahead: 0, behind: 0, hasRemote: true };
  it('같으면 "Up to date with origin/main"', () => {
    expect(syncSentence(s)).toBe('Up to date with origin/main');
  });
  it('앞서고 뒤처진 수를 한 문장으로', () => {
    expect(syncSentence({ ...s, ahead: 1 })).toBe('1 commit ahead of origin/main');
    expect(syncSentence({ ...s, behind: 3 })).toBe('3 commits behind origin/main');
    expect(syncSentence({ ...s, ahead: 1, behind: 3 })).toBe('1 ahead · 3 behind origin/main');
  });
  it('원격 브랜치가 없으면 "Not on the remote yet", 원격 자체가 없으면 "No remote"', () => {
    expect(syncSentence({ ...s, upstream: null, ahead: null, behind: null })).toBe('Not on the remote yet');
    expect(syncSentence({ ...s, hasRemote: false, upstream: null })).toBe('No remote · commits stay on this computer');
  });
  it('브랜치가 없으면(detached) 그 사실을 말한다', () => {
    expect(syncSentence({ ...s, branch: null, upstream: null })).toBe('Not on a branch (detached HEAD)');
  });
});

describe('원격에 없는 브랜치는 Publish 가 파란 단추다', () => {
  it('원격은 있는데 이 브랜치의 원격 브랜치가 없으면 publish', () => {
    expect(primaryGitAction({ ...base, upstream: null, ahead: null, behind: null })).toBe('publish');
  });
  it('스테이지한 변경이 있으면 여전히 커밋이 먼저', () => {
    expect(primaryGitAction({ ...base, staged: 1, upstream: null })).toBe('commit');
  });
  it('upstream 을 모르면(undefined) 예전처럼 앞섬·뒤처짐으로만', () => {
    expect(primaryGitAction({ ...base, ahead: null, behind: null })).toBeNull();
  });
});

describe('브랜치 전환이 고친 파일 때문에 막혔는지', () => {
  it('git 원문과 쉬운 말 둘 다 알아본다', () => {
    expect(switchBlockedByChanges('error: Your local changes to the following files would be overwritten by checkout:\n\ta.txt\nPlease commit your changes or stash them before you switch branches.')).toBe(true);
    expect(switchBlockedByChanges('Your uncommitted changes could be overwritten. Commit or stash them first.')).toBe(true);
    expect(switchBlockedByChanges("fatal: invalid reference: nope")).toBe(false);
  });
});

describe('Push 거절 알아보기', () => {
  it('원격에 내가 없는 커밋이 있어 거절된 것만 true', () => {
    expect(isPushRejected(' ! [rejected]        main -> main (fetch first)')).toBe(true);
    expect(isPushRejected('Updates were rejected because the tip of your current branch is behind (non-fast-forward)')).toBe(true);
    expect(isPushRejected('The remote has commits you do not have, so you cannot push yet. Pull first, then push again.')).toBe(true);
    expect(isPushRejected('Authentication failed for https://github.com/x/y')).toBe(false);
    expect(isPushRejected('Could not resolve host: github.com')).toBe(false);
  });
});
