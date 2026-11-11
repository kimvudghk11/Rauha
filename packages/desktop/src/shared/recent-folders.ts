/** 최근 작업 폴더 한 줄(설정 화면·첫 실행 마법사) */
export interface RecentFolderRow {
  readonly path: string;
  /** 폴더 이름(맨 끝 조각) */
  readonly name: string;
  /** 디스크에서 찾지 못했다(지워졌거나 옮겨졌거나 확인하지 못했다) */
  readonly missing: boolean;
}

const lastPart = (path: string): string => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path;

/**
 * 최근 폴더를 보일 줄로 바꾼다. 지금 작업 폴더는 이미 열려 있으니 뺀다.
 * 디스크 확인 결과(exists)에 없는 폴더는 없는 것으로 본다(열기 전에 틀린 길을 막는다).
 */
export function recentFolderRows(recent: readonly string[], exists: Readonly<Record<string, boolean>>, current: string | null): readonly RecentFolderRow[] {
  return recent.filter((p) => p !== current).map((path) => ({ path, name: lastPart(path), missing: exists[path] !== true }));
}
