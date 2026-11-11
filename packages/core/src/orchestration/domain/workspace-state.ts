import { DomainError } from '../../shared/domain-error.js';

const LISTED_FILES = 10;

const list = (paths: readonly string[]) =>
  `${paths.slice(0, LISTED_FILES).join(', ')}${paths.length > LISTED_FILES ? ` 외 ${paths.length - LISTED_FILES}개` : ''}`;

/**
 * 시작 전 작업 트리 상태. rauha는 커밋하지 않으므로, 사용자가 바꾼 것과
 * 팀원이 바꾼 것이 섞이지 않도록 깨끗한 작업 트리에서만 시작한다.
 * 대화 세션에서는 앞 요청에서 rauha가 남긴 파일(carried)이 그대로면 그 위에서 이어 일한다.
 */
export class WorkspaceState {
  private constructor(
    private readonly dirty: readonly string[] | null,
    private readonly carried: ReadonlyMap<string, string>,
    private readonly current: ReadonlyMap<string, string>,
  ) {}

  /**
   * dirty: 커밋하지 않은 파일 목록(null이면 git 저장소가 아님).
   * carried: 세션 중 rauha가 남긴 파일 → 그때 내용 값, current: 지금 내용 값.
   */
  static of(
    dirty: readonly string[] | null,
    carried: ReadonlyMap<string, string> = new Map(),
    current: ReadonlyMap<string, string> = new Map(),
  ): WorkspaceState {
    return new WorkspaceState(dirty === null ? null : [...dirty], carried, current);
  }

  /** 시작 전에 사용자가 커밋하지 않은 파일(세션에서 rauha가 남긴 것은 뺀다). git 저장소가 아니면 없다. */
  userFiles(): readonly string[] {
    return (this.dirty ?? []).filter((p) => !this.carried.has(p));
  }

  /** rauha가 이번에 바꾼 파일 중 사용자가 이미 고치던 파일. 이 파일은 git 차이에서 둘의 변경이 섞여 보인다. */
  mixedWith(changed: readonly string[]): readonly string[] {
    const mine = new Set(this.userFiles());
    return changed.filter((p) => mine.has(p));
  }

  assertReady(requireClean: boolean): void {
    if (this.dirty === null) {
      throw new DomainError('NOT_A_REPO', 'git 저장소에서만 실행할 수 있습니다. 바뀐 파일을 git으로 추적하기 때문입니다.');
    }
    if (!requireClean) return;
    const edited = this.dirty.filter((p) => this.carried.has(p) && this.carried.get(p) !== this.current.get(p));
    const foreign = this.dirty.filter((p) => !this.carried.has(p));
    if (edited.length > 0) {
      throw new DomainError(
        'DIRTY_WORKTREE',
        `rauha가 남긴 파일을 직접 고친 것 같습니다: ${list(edited)}. 섞이지 않게 먼저 커밋한 뒤 다시 요청하세요.`,
      );
    }
    if (foreign.length > 0) {
      throw new DomainError('DIRTY_WORKTREE', `커밋하지 않은 변경이 있습니다: ${list(foreign)}. 직접 커밋하거나 stash한 뒤 다시 실행하세요.`);
    }
  }
}
