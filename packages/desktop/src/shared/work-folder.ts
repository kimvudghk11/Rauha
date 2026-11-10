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

/** 폴더가 새 프로젝트를 시작할 자리인지 보는 사실(파일 시스템은 호출한 쪽이 읽어 넘긴다) */
export interface NewProjectFacts extends FolderFacts {
  /** 이미 git 저장소 안(상위 폴더가 저장소인 경우 포함)인가 */
  readonly insideRepo: boolean;
  /** 폴더 바로 아래 항목 이름들 */
  readonly entries: readonly string[];
}

const SYSTEM_FILES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);

/**
 * 비어 있는 폴더를 열고 "무엇을 만들어 줘"라고 하면 git 저장소로 시작해 준다(바뀐 파일을 git으로 추적하기 때문).
 * 사용자의 파일이 이미 있는 폴더는 건드리지 않는다.
 */
export function startsAsNewProject(facts: NewProjectFacts): boolean {
  if (!facts.exists || !facts.isDirectory || facts.insideRepo) return false;
  return facts.entries.every((name) => SYSTEM_FILES.has(name.toLowerCase()));
}
