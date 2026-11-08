/** 작업이 일할 자리: 레포 원래 폴더, 또는 그 작업만 쓰는 worktree(임시 폴더) */
export type Place = { readonly kind: 'original' } | { readonly kind: 'worktree'; readonly path: string };

interface Holder {
  readonly repo: string;
  /** null이면 원래 폴더를 쓴다 */
  readonly worktree: string | null;
}

const key = (repo: string): string => repo.replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase();

/**
 * 같은 레포를 동시에 두 일이 고쳐서 서로의 변경을 망치지 않게 자리를 나눠 준다.
 * 규칙: 레포의 원래 폴더는 한 번에 한 작업만 쓰고, 같은 레포에 두 번째로 오는 작업부터는 자기 worktree에서 일한다.
 * 원래 폴더를 쓰던 작업이 끝나면 다음에 오는 작업이 다시 원래 폴더를 쓴다. 값은 불변이다.
 */
export class WorktreeLedger {
  private constructor(private readonly holders: ReadonlyMap<string, Holder>) {}

  static empty(): WorktreeLedger {
    return new WorktreeLedger(new Map());
  }

  /** 작업이 레포에서 일할 자리를 정한다. newPath는 worktree가 필요할 때 쓸 폴더 경로를 만든다. 같은 작업이 두 번 청구하면 처음 자리를 그대로 준다. */
  claim(jobId: string, repo: string, newPath: () => string): { ledger: WorktreeLedger; place: Place } {
    const mine = this.holders.get(jobId);
    if (mine !== undefined) return { ledger: this, place: mine.worktree === null ? { kind: 'original' } : { kind: 'worktree', path: mine.worktree } };
    const originalTaken = [...this.holders.values()].some((h) => key(h.repo) === key(repo) && h.worktree === null);
    const worktree = originalTaken ? newPath() : null;
    const next = new Map(this.holders).set(jobId, { repo, worktree });
    return { ledger: new WorktreeLedger(next), place: worktree === null ? { kind: 'original' } : { kind: 'worktree', path: worktree } };
  }

  /** 작업이 끝났다. 정리해야 할 worktree 경로(없으면 null)를 함께 돌려준다. 모르는 작업이면 아무 일 없다. */
  release(jobId: string): { ledger: WorktreeLedger; worktree: string | null } {
    const h = this.holders.get(jobId);
    if (h === undefined) return { ledger: this, worktree: null };
    const next = new Map(this.holders);
    next.delete(jobId);
    return { ledger: new WorktreeLedger(next), worktree: h.worktree };
  }

  /** 그 레포에서 지금 worktree로 일하는 작업 수(코드 탭 레포 노드에 "worktree 작업 중"으로 보인다) */
  worktreeJobs(repo: string): number {
    return [...this.holders.values()].filter((h) => key(h.repo) === key(repo) && h.worktree !== null).length;
  }

  /** 그 작업의 레포(원래 폴더 경로). 모르면 null */
  repoOf(jobId: string): string | null {
    return this.holders.get(jobId)?.repo ?? null;
  }
}
