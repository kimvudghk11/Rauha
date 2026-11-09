import type { ChangeCode, ChangeMap } from '../shared/code-changes.js';

const CHANGE_TITLE: Readonly<Record<ChangeCode, string>> = { M: '수정됨', A: '추가됨', D: '삭제됨', R: '이름 바뀜', U: '새 파일(추적 안 함)', '!': '충돌' };

/** 파일 상태 글자의 툴팁 */
export const changeTitle = (code: ChangeCode): string => CHANGE_TITLE[code];

export interface FolderMark {
  /** 이름 오른쪽에 붙일 한 글자(없으면 null). git이 폴더 자체에 알려 준 상태만 쓴다. */
  readonly badge: ChangeCode | null;
  readonly title: string;
}

/**
 * 폴더 줄 표시. 안에 바뀐 파일이 있다는 것만 알 때는 글자를 지어내지 않고 이름 색과 설명만 준다.
 * 폴더 자체가 추적 안 하는 새 폴더일 때만 U 배지를 단다.
 */
export function folderMark(changes: ChangeMap, path: string): FolderMark | null {
  if (!changes.dirHasChange(path)) return null;
  if (changes.statusOf(path) === 'U') return { badge: 'U', title: '새 폴더(추적 안 함)' };
  return { badge: null, title: '안에 바뀐 파일이 있어요' };
}
