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
  const summary = !any ? '선택한 기록이 없어요' : hidden > 0 ? `${pickedSet.size}개 선택 (${hidden}개는 지금 안 보여요)` : `${pickedSet.size}개 선택`;
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
  if (requests.length > 3) shown.push(`외 ${requests.length - 3}개`);
  return {
    title: `기록 ${requests.length}개를 지울까요?`,
    body: [...shown, '이 컴퓨터에서 지워져요. 되돌릴 수 없어요.'].join('\n'),
    okLabel: requests.length <= 1 ? '지우기' : `${requests.length}개 지우기`,
  };
}

/** Shift+클릭: 기준 줄과 누른 줄 사이(양끝 포함). 기준이 없으면 누른 줄만 */
export function rangeBetween(ids: readonly string[], anchor: string | null, target: string): string[] {
  const a = anchor === null ? -1 : ids.indexOf(anchor);
  const b = ids.indexOf(target);
  if (a === -1 || b === -1) return [target];
  return ids.slice(Math.min(a, b), Math.max(a, b) + 1);
}

export const copiedText = (count: number, ok: boolean): string => (!ok ? '복사하지 못했어요. 다시 눌러 주세요.' : count <= 1 ? '복사했어요' : `${count}개 기록을 복사했어요`);
