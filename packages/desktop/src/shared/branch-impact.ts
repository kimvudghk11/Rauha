/** 바뀐 파일 한 줄(git diff --numstat). 이진 파일은 줄 수를 모른다(null). */
export interface ChangedFile {
  readonly path: string;
  readonly additions: number | null;
  readonly deletions: number | null;
}

export type AutoDeploy = 'yes' | 'no' | 'unknown';

/** 보호 브랜치 하나에 이 변경이 주는 영향 */
export interface BranchImpact {
  readonly branch: string;
  /** 그 브랜치가 이 저장소에 있는지(없으면 아래 값은 모른다) */
  readonly exists: boolean;
  /** 지금 브랜치가 그 브랜치보다 앞선 커밋 수 */
  readonly ahead: number | null;
  /** 지금 브랜치가 그 브랜치보다 뒤처진 커밋 수 */
  readonly behind: number | null;
  /** 합쳐 보면 충돌이 나는지. 시험 머지를 못 했으면 null */
  readonly conflicts: boolean | null;
  readonly autoDeploy: AutoDeploy;
}

/** `git diff --numstat` 출력 → 파일 목록 */
export function parseNumstat(text: string): ChangedFile[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => {
      const [add, del, ...rest] = line.split('\t');
      const num = (v: string | undefined) => (v === undefined || v === '-' ? null : Number(v));
      return { path: rest.join('\t'), additions: num(add), deletions: num(del) };
    });
}

/** `git rev-list --left-right --count A...B` 출력("왼쪽\t오른쪽") → [왼쪽, 오른쪽]. 모양이 틀리면 null. */
export function parseLeftRight(text: string): readonly [number, number] | null {
  const m = /^(\d+)\s+(\d+)$/.exec(text.trim());
  return m === null ? null : [Number(m[1]), Number(m[2])];
}

/** CI 설정 파일 하나 */
export interface CiFile {
  readonly path: string;
  readonly text: string;
}

/**
 * 레포의 CI 설정에서 그 브랜치에 올리면 자동 배포되는지 읽는다. 설정 파일이 하나도 없으면 "모름"이다.
 * 브랜치 이름이 적힌 파일에 deploy·release·cd 같은 말이 있으면 yes, 설정은 있는데 그런 파일이 없으면 no.
 */
export function autoDeployFor(branch: string, files: readonly CiFile[]): AutoDeploy {
  if (files.length === 0) return 'unknown';
  const name = branch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const mentions = new RegExp(`(^|[^\\w/-])${name}([^\\w/-]|$)`);
  const deploys = /deploy|release|publish|\bcd\b|배포/i;
  return files.some((f) => mentions.test(f.text) && (deploys.test(f.text) || deploys.test(f.path))) ? 'yes' : 'no';
}
