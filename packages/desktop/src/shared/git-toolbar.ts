/** git 동기화 툴바와 커밋 입력에 쓰는 글·규칙(순수 함수). 화면은 이 결과를 그대로 그린다. */

/** Fetch 버튼 배지: 마지막으로 원격을 확인한 시각(초 단위 UNIX 시각, 모르면 null) */
export function fetchedLabel(atSec: number | null, nowSec: number): string {
  if (atSec === null) return 'Not yet';
  const d = Math.max(0, nowSec - atSec);
  if (d < 60) return 'Checked just now';
  if (d < 3600) return `Last checked ${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `Last checked ${Math.floor(d / 3600)}h ago`;
  return `Last checked ${Math.floor(d / 86400)}d ago`;
}

/** Pull(↓ 뒤처진 수)·Push(↑ 앞선 수) 배지. 0이거나 모르면 빈 글 */
export function syncBadge(dir: 'up' | 'down', n: number | null): string {
  return n === null || n <= 0 ? '' : `${dir === 'down' ? '↓' : '↑'}${n}`;
}

export function pullDoneMessage(received: number | null): string {
  if (received === null) return 'Pulled new commits.';
  return received > 0 ? `Pulled ${received} new commit(s).` : 'Already up to date.';
}

/** 원격이 아닌 로컬 git 작업(커밋·전환·머지·브랜치 삭제)이 실패한 이유를 쉬운 말로. 아는 모양이 아니면 null. */
export function knownLocalGitError(raw: string): string | null {
  const t = raw.trim();
  if (/Author identity unknown|unable to auto-detect email|empty ident name|Please tell me who you are/i.test(t)) return 'Git does not know your name and email yet. Run git config --global user.name "Your Name" and git config --global user.email "you@example.com" in a terminal once, then try again.';
  if (/not fully merged/i.test(t)) return 'This branch has unmerged commits, so it was not deleted. Merge it first, or run git branch -D in a terminal if you really do not need it.';
  if (/would be overwritten|commit your changes or stash/i.test(t)) return 'Your uncommitted changes could be overwritten. Commit or stash them first.';
  return null;
}

/** git이 내는 영어 오류를 쉬운 한국어 한두 문장으로. 아는 모양이 아니면 null. */
export function knownGitError(raw: string): string | null {
  const t = raw.trim();
  const local = knownLocalGitError(t);
  if (local !== null) return local;
  if (/non-fast-forward|rejected|fetch first|contains work that you do not have/i.test(t)) return 'The remote has commits you do not have, so you cannot push yet. Pull first, then push again.';
  if (/Authentication failed|could not read Username|invalid credentials/i.test(t)) return 'Sign-in failed. Check your GitHub login or token.';
  if (/Permission denied|publickey|access denied|403/i.test(t)) return 'You may not have permission to push here, or your SSH key does not match.';
  if (/Could not resolve host|unable to access|Network is unreachable|timed out|Connection refused/i.test(t)) return 'Could not reach the remote. Check your internet connection.';
  if (/no upstream branch|has no upstream/i.test(t)) return 'This branch has no remote branch yet. Push creates and links one.';
  if (/Not possible to fast-forward|diverged|Diverging branches|can't be fast-forwarded/i.test(t)) return 'Your branch and the remote branch have diverged. You can combine them with a merge.';
  return null;
}

/** 아는 오류는 쉬운 말로, 모르는 것은 첫 줄 그대로 */
export function friendlyGitError(raw: string): string {
  return knownGitError(raw) ?? raw.trim().split('\n')[0] ?? raw.trim();
}

export const SUBJECT_LIMIT = 72;

/** 커밋 제목 칸 아래에 보이는 글자 수와 경고 */
export function subjectState(subject: string): { readonly length: number; readonly warn: boolean } {
  const length = [...subject.trim()].length;
  return { length, warn: length > SUBJECT_LIMIT };
}

/** "3개 파일, +12 −4" */
export function stageSummary(files: number, added: number | null, removed: number | null): string {
  return added === null || removed === null ? `${files} file(s)` : `${files} file(s), +${added} −${removed}`;
}

export interface CommitInput {
  readonly staged: number;
  readonly subject: string;
  readonly conflicts: boolean;
}

/** 커밋 버튼을 못 누르는 이유(누를 수 있으면 null) */
export function commitBlockReason(i: CommitInput): string | null {
  if (i.conflicts) return 'There are unresolved conflicts. Resolve them first.';
  if (i.staged === 0) return 'Nothing to commit. Check files on the left to stage them.';
  if (i.subject.trim() === '') return 'Please enter a commit subject.';
  return null;
}

export interface SyncState {
  readonly branch: string | null;
  readonly upstream: string | null;
  readonly ahead: number | null;
  readonly behind: number | null;
  readonly hasRemote: boolean;
}

/** 저장소 막대에서 브랜치 옆에 보이는 한 문장: 지금 원격과 어떤 사이인지 */
export function syncSentence(s: SyncState): string {
  if (s.branch === null) return 'Not on a branch (detached HEAD)';
  if (!s.hasRemote) return 'No remote · commits stay on this computer';
  if (s.upstream === null) return 'Not on the remote yet';
  const a = s.ahead ?? 0;
  const b = s.behind ?? 0;
  if (a > 0 && b > 0) return `${a} ahead · ${b} behind ${s.upstream}`;
  if (a > 0) return `${a} commit${a === 1 ? '' : 's'} ahead of ${s.upstream}`;
  if (b > 0) return `${b} commit${b === 1 ? '' : 's'} behind ${s.upstream}`;
  return `Up to date with ${s.upstream}`;
}

/** push 가 "원격에 내가 없는 커밋이 있어서" 거절됐다(Pull 하고 다시 push 하면 되는 경우). 원문이든 쉬운 말이든 알아본다 */
export function isPushRejected(message: string): boolean {
  return /non-fast-forward|\[rejected\]|fetch first|contains work that you do not have|remote has commits you do not have/i.test(message);
}

/** 브랜치 전환이 고친 파일(덮어써질 변경) 때문에 막혔다. stash 하고 바꾸면 된다 */
export function switchBlockedByChanges(message: string): boolean {
  return /would be overwritten|could be overwritten|commit your changes or stash/i.test(message);
}

/** 브랜치 목록·툴바에서 쓰는 앞섬·뒤처짐 표기: "↑1 ↓3" (0이거나 모르면 비운다) */
export function directionText(ahead: number | null, behind: number | null): string {
  return [syncBadge('up', ahead), syncBadge('down', behind)].filter((x) => x !== '').join(' ');
}
