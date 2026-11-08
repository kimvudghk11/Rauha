/** git 탭에서 지금 가장 중요한 한 동작. 그 버튼만 강조색(파랑)을 쓰고 나머지는 보조 버튼이다. */
export type GitPrimary = 'commit' | 'pull' | 'push';

export interface GitPrimaryInput {
  /** 스테이지한 파일 수 */
  readonly staged: number;
  /** 충돌 파일이 있다 */
  readonly conflicts: boolean;
  readonly merging: boolean;
  /** 원격보다 앞선·뒤처진 커밋 수(원격이 없으면 null) */
  readonly ahead: number | null;
  readonly behind: number | null;
  readonly hasRemote: boolean;
}

/** 충돌이 있으면 없음 → 스테이지한 변경이 있으면 커밋 → (머지 중이 아니고) 뒤처졌으면 pull → 앞섰으면 push */
export function primaryGitAction(s: GitPrimaryInput): GitPrimary | null {
  if (s.conflicts) return null;
  if (s.staged > 0) return 'commit';
  if (s.merging || !s.hasRemote) return null;
  if ((s.behind ?? 0) > 0) return 'pull';
  if ((s.ahead ?? 0) > 0) return 'push';
  return null;
}
