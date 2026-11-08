/** git 동기화 툴바와 커밋 입력에 쓰는 글·규칙(순수 함수). 화면은 이 결과를 그대로 그린다. */

/** Fetch 버튼 배지: 마지막으로 원격을 확인한 시각(초 단위 UNIX 시각, 모르면 null) */
export function fetchedLabel(atSec: number | null, nowSec: number): string {
  if (atSec === null) return '아직 안 함';
  const d = Math.max(0, nowSec - atSec);
  if (d < 60) return '방금 확인';
  if (d < 3600) return `마지막 확인 ${Math.floor(d / 60)}분 전`;
  if (d < 86400) return `마지막 확인 ${Math.floor(d / 3600)}시간 전`;
  return `마지막 확인 ${Math.floor(d / 86400)}일 전`;
}

/** Pull(↓ 뒤처진 수)·Push(↑ 앞선 수) 배지. 0이거나 모르면 빈 글 */
export function syncBadge(dir: 'up' | 'down', n: number | null): string {
  return n === null || n <= 0 ? '' : `${dir === 'down' ? '↓' : '↑'}${n}`;
}

export function pullDoneMessage(received: number | null): string {
  if (received === null) return '새 커밋을 받았어요.';
  return received > 0 ? `새 커밋 ${received}개를 받았어요.` : '이미 최신이에요.';
}

/** git이 내는 영어 오류를 쉬운 한국어 한두 문장으로. 아는 모양이 아니면 null. */
export function knownGitError(raw: string): string | null {
  const t = raw.trim();
  if (/non-fast-forward|rejected|fetch first|contains work that you do not have/i.test(t)) return '원격에 내 컴퓨터에 없는 새 커밋이 있어서 올릴 수 없어요. 먼저 pull로 받아 합친 뒤 다시 push해 주세요.';
  if (/Authentication failed|could not read Username|invalid credentials/i.test(t)) return '로그인(인증)이 안 됐어요. GitHub 로그인 정보나 토큰을 확인해 주세요.';
  if (/Permission denied|publickey|access denied|403/i.test(t)) return '이 저장소에 올릴 권한이 없거나 접속 열쇠(SSH 키)가 맞지 않아요.';
  if (/Could not resolve host|unable to access|Network is unreachable|timed out|Connection refused/i.test(t)) return '원격에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.';
  if (/would be overwritten|commit your changes or stash/i.test(t)) return '아직 커밋하지 않은 내 변경이 덮어써질 수 있어요. 먼저 커밋하거나 변경을 정리해 주세요.';
  if (/no upstream branch|has no upstream/i.test(t)) return '이 브랜치에는 연결된 원격 브랜치가 없어요. push를 누르면 새로 만들어 연결해요.';
  if (/Not possible to fast-forward|diverged/i.test(t)) return '내 브랜치와 원격 브랜치가 서로 갈라졌어요. 병합으로 합칠 수 있어요.';
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
  return added === null || removed === null ? `${files}개 파일` : `${files}개 파일, +${added} −${removed}`;
}

export interface CommitInput {
  readonly staged: number;
  readonly subject: string;
  readonly conflicts: boolean;
}

/** 커밋 버튼을 못 누르는 이유(누를 수 있으면 null) */
export function commitBlockReason(i: CommitInput): string | null {
  if (i.conflicts) return '풀지 않은 충돌이 있어요. 충돌을 먼저 풀어 주세요.';
  if (i.staged === 0) return '커밋할 파일이 없어요. 왼쪽에서 파일을 체크해 스테이지해 주세요.';
  if (i.subject.trim() === '') return '커밋 제목을 적어 주세요.';
  return null;
}

/** 브랜치 목록·툴바에서 쓰는 앞섬·뒤처짐 표기: "↑1 ↓3" (0이거나 모르면 비운다) */
export function directionText(ahead: number | null, behind: number | null): string {
  return [syncBadge('up', ahead), syncBadge('down', behind)].filter((x) => x !== '').join(' ');
}
