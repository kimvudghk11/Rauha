/** 기록 탭 화면의 순수 규칙: 선택 작업줄, 강조 버튼, 필터 표시, 키보드 이동, 안내 문장. 화면은 이 값을 그리기만 한다. */

export interface PickBarState {
  readonly summary: string;
  readonly canBlog: boolean;
  readonly canCopy: boolean;
  readonly canDelete: boolean;
  readonly canClear: boolean;
  readonly canSelectAll: boolean;
}

/** 선택 작업줄: 앞에 보일 글과 각 단추를 누를 수 있는지 */
export function pickBarState(picked: readonly string[], shown: readonly string[]): PickBarState {
  const shownSet = new Set(shown);
  const pickedSet = new Set(picked);
  const hidden = picked.filter((id) => !shownSet.has(id)).length;
  const any = pickedSet.size > 0;
  const summary = !any ? 'No records selected' : hidden > 0 ? `${pickedSet.size} selected (${hidden} not shown now)` : `${pickedSet.size} selected`;
  return { summary, canBlog: any, canCopy: any, canDelete: any, canClear: any, canSelectAll: shown.some((id) => !pickedSet.has(id)) };
}

export type RecordView = 'none' | 'detail' | 'blog';
export type RecordPrimary = 'none' | 'pick-blog' | 'detail-copy' | 'blog-draft';

/** 한 화면에 강조(파랑) 버튼은 하나: 지금 가장 앞에 있는 일의 버튼만 */
export function primaryRecordAction(pickedCount: number, view: RecordView): RecordPrimary {
  if (view === 'blog') return 'blog-draft';
  if (view === 'detail') return 'detail-copy';
  return pickedCount > 0 ? 'pick-blog' : 'none';
}

export interface RecordFilterState {
  readonly text: string;
  readonly tag: string | null;
  readonly status: 'all' | 'done' | 'stopped';
  readonly repo: string | null;
  readonly divergedOnly: boolean;
  readonly period: string;
}

export type FilterKey = 'text' | 'tag' | 'status' | 'repo' | 'diverged' | 'period';

/** 걸려 있는 필터 조건들(없으면 빈 목록 → "필터 지우기"를 숨긴다) */
export function activeFilterKeys(f: RecordFilterState): FilterKey[] {
  const keys: FilterKey[] = [];
  if (f.text.trim() !== '') keys.push('text');
  if (f.tag !== null) keys.push('tag');
  if (f.status !== 'all') keys.push('status');
  if (f.repo !== null) keys.push('repo');
  if (f.divergedOnly) keys.push('diverged');
  if (f.period !== 'all') keys.push('period');
  return keys;
}

/** ↑↓·Home·End로 옮길 다음 줄 번호. 옮길 곳이 없으면 null */
export function moveRowSelection(ids: readonly string[], current: string | null, key: string): string | null {
  if (ids.length === 0) return null;
  const at = current === null ? -1 : ids.indexOf(current);
  if (key === 'Home') return ids[0] ?? null;
  if (key === 'End') return ids[ids.length - 1] ?? null;
  if (key === 'ArrowDown') return ids[at === -1 ? 0 : Math.min(at + 1, ids.length - 1)] ?? null;
  if (key === 'ArrowUp') return ids[at === -1 ? ids.length - 1 : Math.max(at - 1, 0)] ?? null;
  return null;
}

export interface DeleteDialog {
  readonly title: string;
  readonly body: string;
  readonly okLabel: string;
}

/** 지우기 확인 창 문장: 무엇을 몇 개 지우는지, 되돌릴 수 없다는 것 */
export function deleteDialog(requests: readonly string[]): DeleteDialog {
  const shown = requests.slice(0, 3).map((r) => `"${r}"`);
  if (requests.length > 3) shown.push(`+${requests.length - 3} more`);
  return {
    title: requests.length === 1 ? 'Delete this record?' : `Delete ${requests.length} records?`,
    body: [...shown, 'They are removed from this computer. This cannot be undone.'].join('\n'),
    okLabel: requests.length <= 1 ? 'Delete' : `Delete ${requests.length}`,
  };
}

/** Shift+클릭: 기준 줄과 누른 줄 사이(양끝 포함). 기준이 없으면 누른 줄만 */
export function rangeBetween(ids: readonly string[], anchor: string | null, target: string): string[] {
  const a = anchor === null ? -1 : ids.indexOf(anchor);
  const b = ids.indexOf(target);
  if (a === -1 || b === -1) return [target];
  return ids.slice(Math.min(a, b), Math.max(a, b) + 1);
}

/** 화면에 쓰는 짧은 걸린 시간: 45s · 2m 10s · 1h 5m. 알 수 없으면 Unknown */
export function shortDuration(seconds: number | null): string {
  if (seconds === null) return 'Unknown';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m${seconds % 60 === 0 ? '' : ` ${seconds % 60}s`}`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60 === 0 ? '' : ` ${m % 60}m`}`;
}

export const copiedText =(count: number, ok: boolean): string => (!ok ? 'Could not copy. Please try again.' : count <= 1 ? 'Copied' : `Copied ${count} records`);

/** 기록 상세의 허락 결정 칩 글(화면용 영어. 마크다운·블로그 글은 record-dto의 decisionLabel) */
export const DECISION_CHIP: Readonly<Record<'once' | 'job' | 'revise' | 'deny', string>> = { once: 'Allowed once', job: 'Allowed for the job', revise: 'Asked to revise', deny: 'Denied' };
