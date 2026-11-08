import { describe, expect, it } from 'vitest';
import { commitBlockReason, directionText, fetchedLabel, friendlyGitError, pullDoneMessage, stageSummary, subjectState, syncBadge } from './git-toolbar.js';

describe('Fetch 배지 글', () => {
  it('한 번도 안 했으면 "아직 안 함"이다', () => {
    expect(fetchedLabel(null, 1000)).toBe('아직 안 함');
  });
  it('1분 안이면 "방금 확인", 그 뒤로는 분·시간·일 단위다', () => {
    expect(fetchedLabel(990, 1000)).toBe('방금 확인');
    expect(fetchedLabel(1000 - 5 * 60, 1000)).toBe('마지막 확인 5분 전');
    expect(fetchedLabel(1000 - 3 * 3600, 1000)).toBe('마지막 확인 3시간 전');
    expect(fetchedLabel(1000 - 2 * 86400, 1000)).toBe('마지막 확인 2일 전');
  });
});

describe('Pull·Push 배지', () => {
  it('뒤처진 수는 ↓, 앞선 수는 ↑로 보이고 0이나 모르면 비운다', () => {
    expect(syncBadge('down', 3)).toBe('↓3');
    expect(syncBadge('up', 2)).toBe('↑2');
    expect(syncBadge('down', 0)).toBe('');
    expect(syncBadge('up', null)).toBe('');
  });
});

describe('pull 결과 글', () => {
  it('받은 커밋이 있으면 개수를, 없으면 이미 최신이라고 말한다', () => {
    expect(pullDoneMessage(3)).toBe('새 커밋 3개를 받았어요.');
    expect(pullDoneMessage(0)).toBe('이미 최신이에요.');
  });
  it('개수를 모르면 개수 없이 받았다고만 말한다', () => {
    expect(pullDoneMessage(null)).toBe('새 커밋을 받았어요.');
  });
});

describe('실패 이유를 쉬운 말로', () => {
  it('push가 거절되면 먼저 pull 하라고 알린다', () => {
    expect(friendlyGitError('! [rejected] main -> main (non-fast-forward)')).toMatch(/먼저 pull/);
    expect(friendlyGitError('Updates were rejected because the remote contains work that you do not have locally')).toMatch(/먼저 pull/);
  });
  it('인증 실패·권한 없음·인터넷 문제를 구분한다', () => {
    expect(friendlyGitError('fatal: Authentication failed for ...')).toMatch(/로그인|인증/);
    expect(friendlyGitError('Permission denied (publickey).')).toMatch(/권한|열쇠|키/);
    expect(friendlyGitError('fatal: Could not resolve host: github.com')).toMatch(/인터넷|연결/);
  });
  it('내 변경이 덮어써질 때는 커밋하거나 보관하라고 알린다', () => {
    expect(friendlyGitError('error: Your local changes to the following files would be overwritten by merge')).toMatch(/커밋/);
  });
  it('업스트림이 없으면 push로 연결하라고 알린다', () => {
    expect(friendlyGitError('fatal: The current branch x has no upstream branch.')).toMatch(/원격 브랜치/);
  });
  it('모르는 문장은 첫 줄을 그대로 둔다', () => {
    expect(friendlyGitError('something odd\nsecond')).toBe('something odd');
  });
});

describe('커밋 제목 입력', () => {
  it('글자 수를 세고 72자를 넘으면 경고한다', () => {
    expect(subjectState('feat: 로그인')).toMatchObject({ length: 9, warn: false });
    expect(subjectState('a'.repeat(72)).warn).toBe(false);
    expect(subjectState('a'.repeat(73))).toMatchObject({ length: 73, warn: true });
  });
  it('앞뒤 공백은 세지 않는다', () => {
    expect(subjectState('  ab  ').length).toBe(2);
  });
});

describe('스테이지 요약', () => {
  it('파일 수와 +줄 −줄을 한 줄로 만든다', () => {
    expect(stageSummary(3, 12, 4)).toBe('3개 파일, +12 −4');
  });
  it('줄 수를 모르면 파일 수만 보여 준다', () => {
    expect(stageSummary(2, null, null)).toBe('2개 파일');
  });
});

describe('커밋 버튼을 못 누르는 이유', () => {
  const base = { staged: 1, subject: 'x', conflicts: false };
  it('누를 수 있으면 null이다', () => {
    expect(commitBlockReason(base)).toBeNull();
  });
  it('충돌 → 스테이지 없음 → 제목 없음 순으로 이유를 댄다', () => {
    expect(commitBlockReason({ ...base, conflicts: true })).toMatch(/충돌/);
    expect(commitBlockReason({ ...base, staged: 0 })).toMatch(/스테이지/);
    expect(commitBlockReason({ ...base, subject: ' ' })).toMatch(/제목/);
  });
});

describe('앞섬·뒤처짐 표기', () => {
  it('↑앞선 수 ↓뒤처진 수 모양으로 같은 기호를 쓴다', () => {
    expect(directionText(1, 3)).toBe('↑1 ↓3');
    expect(directionText(2, 0)).toBe('↑2');
    expect(directionText(0, 4)).toBe('↓4');
    expect(directionText(0, 0)).toBe('');
    expect(directionText(null, null)).toBe('');
  });
});
