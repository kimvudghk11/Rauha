/** 작업 폴더가 지금 일할 수 있는 상태인지 보는 규칙(파일 시스템은 호출한 쪽이 읽어 넘긴다). 문제가 없으면 null, 있으면 사람이 읽는 한 줄. */
export interface FolderFacts {
  readonly exists: boolean;
  readonly isDirectory: boolean;
}

export function workFolderProblem(path: string, facts: FolderFacts): string | null {
  if (!facts.exists) return `작업 폴더를 찾을 수 없어요(${path}). 지워졌거나 옮겨졌을 수 있어요. 설정에서 작업 폴더를 다시 골라 주세요.`;
  if (!facts.isDirectory) return `작업 폴더가 폴더가 아니에요(${path}). 설정에서 작업 폴더를 다시 골라 주세요.`;
  return null;
}
