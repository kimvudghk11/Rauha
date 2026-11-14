import { describe, expect, it } from 'vitest';
import { protectedMessage } from './git-api.js';
import { commitBlockReason, directionText, fetchedLabel, friendlyGitError, pullDoneMessage, stageSummary, subjectState, syncBadge } from './git-toolbar.js';

describe('Fetch 배지 글', () => {
  it('한 번도 안 했으면 "아직 안 함"이다', () => {
    expect(fetchedLabel(null, 1000)).toBe('Not yet');
  });
  it('1분 안이면 "방금 확인", 그 뒤로는 분·시간·일 단위다', () => {
    expect(fetchedLabel(990, 1000)).toBe('Checked just now');
    expect(fetchedLabel(1000 - 5 * 60, 1000)).toBe('Last checked 5m ago');
    expect(fetchedLabel(1000 - 3 * 3600, 1000)).toBe('Last checked 3h ago');
    expect(fetchedLabel(1000 - 2 * 86400, 1000)).toBe('Last checked 2d ago');
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
    expect(pullDoneMessage(3)).toBe('Pulled 3 new commit(s).');
    expect(pullDoneMessage(0)).toBe('Already up to date.');
  });
  it('개수를 모르면 개수 없이 받았다고만 말한다', () => {
    expect(pullDoneMessage(null)).toBe('Pulled new commits.');
  });
});

describe('실패 이유를 쉬운 말로', () => {
  it('push가 거절되면 먼저 pull 하라고 알린다', () => {
    expect(friendlyGitError('! [rejected] main -> main (non-fast-forward)')).toMatch(/Pull first/);
    expect(friendlyGitError('Updates were rejected because the remote contains work that you do not have locally')).toMatch(/Pull first/);
  });
  it('인증 실패·권한 없음·인터넷 문제를 구분한다', () => {
    expect(friendlyGitError('fatal: Authentication failed for ...')).toMatch(/Sign-in/);
    expect(friendlyGitError('Permission denied (publickey).')).toMatch(/permission|SSH/);
    expect(friendlyGitError('fatal: Could not resolve host: github.com')).toMatch(/internet/);
  });
  it('내 변경이 덮어써질 때는 커밋하거나 보관하라고 알린다', () => {
    expect(friendlyGitError('error: Your local changes to the following files would be overwritten by merge')).toMatch(/Commit/);
  });
  it('업스트림이 없으면 push로 연결하라고 알린다', () => {
    expect(friendlyGitError('fatal: The current branch x has no upstream branch.')).toMatch(/remote branch/);
  });
  it('커밋에 쓸 이름·이메일이 없으면 한 번 정하라고 알린다(정하는 단추는 화면이 붙인다)', () => {
    const raw = 'Author identity unknown\n\n*** Please tell me who you are.\n\nRun\n\n  git config --global user.email "you@example.com"';
    expect(friendlyGitError(raw)).toMatch(/name and email/);
    expect(friendlyGitError(raw)).toMatch(/Set them once/);
    expect(friendlyGitError("fatal: unable to auto-detect email address (got 'a@b.(none)')")).toMatch(/email/);
  });
  it('갈라진 브랜치를 빨리감기할 수 없다는 힌트 줄들도 갈라졌다는 한 문장으로 바꾼다', () => {
    expect(friendlyGitError("hint: Diverging branches can't be fast-forwarded, you need to either:\nhint: git merge --no-ff")).toMatch(/diverged/);
    expect(friendlyGitError('fatal: Not possible to fast-forward, aborting.')).toMatch(/diverged/);
  });
  it('아직 합치지 않은 브랜치를 지우려 하면 먼저 머지하라고 알린다', () => {
    const raw = "error: the branch 'feature/x' is not fully merged\nhint: If you are sure you want to delete it, run 'git branch -D feature/x'";
    expect(friendlyGitError(raw)).toMatch(/unmerged commits/);
    expect(friendlyGitError(raw)).not.toMatch(/hint/);
  });
  it('보호 브랜치 안내는 받침과 상관없이 맞는 조사를 쓴다', () => {
    expect(protectedMessage('main')).toBe('Branch main is protected.');
    expect(protectedMessage('release/한글')).toBe('Branch release/한글 is protected.');
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
    expect(stageSummary(3, 12, 4)).toBe('3 file(s), +12 −4');
  });
  it('줄 수를 모르면 파일 수만 보여 준다', () => {
    expect(stageSummary(2, null, null)).toBe('2 file(s)');
  });
});

describe('커밋 버튼을 못 누르는 이유', () => {
  const base = { staged: 1, subject: 'x', conflicts: false };
  it('누를 수 있으면 null이다', () => {
    expect(commitBlockReason(base)).toBeNull();
  });
  it('충돌 → 스테이지 없음 → 제목 없음 순으로 이유를 댄다', () => {
    expect(commitBlockReason({ ...base, conflicts: true })).toMatch(/conflicts/);
    expect(commitBlockReason({ ...base, staged: 0 })).toMatch(/stage/);
    expect(commitBlockReason({ ...base, subject: ' ' })).toMatch(/subject/);
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
