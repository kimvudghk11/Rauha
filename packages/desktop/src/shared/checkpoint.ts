/**
 * 작업 체크포인트: 코드를 고치는 작업이 시작될 때의 기준(HEAD·시작 시점 파일 상태)과 끝났을 때의 변경 목록.
 * 되돌리기 계획(RevertPlan)과 안전 백업 장부(BackupLedger)도 여기에 둔다. 바깥(git·파일)은 모른다.
 */

export type ChangeKind = 'added' | 'modified' | 'deleted';

export interface FileChange {
  readonly path: string;
  readonly kind: ChangeKind;
  /** 작업이 더한 줄 수(바이너리면 0) */
  readonly added: number;
  /** 작업이 지운 줄 수(바이너리면 0) */
  readonly removed: number;
  readonly binary: boolean;
}

export const CHECKPOINT_LIMITS = { records: 100, files: 500, backups: 20 } as const;

export type CheckpointPlace = 'repo' | 'worktree';

export interface CheckpointData {
  readonly jobId: string;
  /** 작업이 속한 레포 폴더(원래 폴더) */
  readonly repoRoot: string;
  readonly place: CheckpointPlace;
  readonly startedAt: string;
  readonly endedAt: string | null;
  /** 시작할 때 HEAD 커밋(커밋이 없는 레포면 null) */
  readonly head: string | null;
  /** 끝났을 때 HEAD 커밋 */
  readonly headAtEnd: string | null;
  /** 시작할 때 브랜치(분리된 HEAD면 null) */
  readonly branch: string | null;
  /** 시작 시점의 파일 상태를 담은 git 트리 해시(HEAD + 그때 커밋 안 한 변경). worktree 작업은 HEAD 커밋 */
  readonly startTree: string | null;
  /** 끝났을 때의 트리 해시. worktree 작업은 작업 브랜치 끝 커밋 */
  readonly endTree: string | null;
  /** 시작할 때 이미 커밋 안 한 변경이 있던 파일 수 */
  readonly startDirty: number;
  /** worktree 로 돈 작업이 남긴 브랜치 */
  readonly workBranch: string | null;
  readonly branchDiscarded: boolean;
  readonly files: readonly FileChange[];
  /** 비밀 파일이라 목록에서 뺀 수 */
  readonly hiddenCount: number;
}

export interface BeginInput {
  readonly jobId: string;
  readonly repoRoot: string;
  readonly place: CheckpointPlace;
  readonly startedAt: string;
  readonly head: string | null;
  readonly branch: string | null;
  readonly startTree: string | null;
  readonly startDirty: number;
}

export interface Totals {
  readonly files: number;
  readonly added: number;
  readonly removed: number;
}

/** 작업 하나의 체크포인트. 불변. 상태는 의도가 드러나는 메서드로만 바꾼다. */
export class Checkpoint {
  private constructor(readonly data: CheckpointData) {}

  static begin(input: BeginInput): Checkpoint {
    return new Checkpoint({ ...input, endedAt: null, headAtEnd: null, endTree: null, workBranch: null, branchDiscarded: false, files: [], hiddenCount: 0 });
  }

  /** 저장된 값에서 되살린다(검증은 DTO 가 이미 했다). 파일 목록은 상한을 다시 적용한다. */
  static restore(data: CheckpointData): Checkpoint {
    return new Checkpoint({ ...data, files: data.files.slice(0, CHECKPOINT_LIMITS.files) });
  }

  /** 원래 폴더에서 일한 작업이 끝났다 */
  finishInPlace(input: { readonly endedAt: string; readonly headAtEnd: string | null; readonly endTree: string | null; readonly files: readonly FileChange[]; readonly hiddenCount: number }): Checkpoint {
    return new Checkpoint({ ...this.data, ...input, files: input.files.slice(0, CHECKPOINT_LIMITS.files) });
  }

  /** worktree 에서 일한 작업이 끝났다. branch 가 null 이면 남긴 변경이 없다. */
  finishBranch(input: { readonly endedAt: string; readonly workBranch: string | null; readonly branchTip: string | null; readonly files: readonly FileChange[]; readonly hiddenCount: number }): Checkpoint {
    return new Checkpoint({ ...this.data, endedAt: input.endedAt, workBranch: input.workBranch, endTree: input.branchTip, headAtEnd: this.data.head, files: input.files.slice(0, CHECKPOINT_LIMITS.files), hiddenCount: input.hiddenCount });
  }

  withBranchDiscarded(): Checkpoint {
    return new Checkpoint({ ...this.data, branchDiscarded: true });
  }

  get jobId(): string {
    return this.data.jobId;
  }

  get isFinished(): boolean {
    return this.data.endedAt !== null;
  }

  /** 화면에 보일 가치가 있나(바뀐 파일이 있거나 남은 브랜치가 있다) */
  hasChanges(): boolean {
    return this.isFinished && (this.data.files.length > 0 || this.data.workBranch !== null);
  }

  totals(): Totals {
    return { files: this.data.files.length, added: this.data.files.reduce((n, f) => n + f.added, 0), removed: this.data.files.reduce((n, f) => n + f.removed, 0) };
  }

  /** 지금 작업 폴더에서 파일 되돌리기를 할 수 없는 이유(할 수 있으면 null). 사용자에게 그대로 보인다. */
  revertBlock(): string | null {
    const d = this.data;
    if (!this.isFinished) return 'The job is still running.';
    if (d.place === 'worktree') return d.workBranch === null ? 'This job left no changes.' : `The changes are on branch ${d.workBranch}, not in your files. Use Discard branch to throw them away.`;
    if (d.startTree === null || d.endTree === null) return 'No checkpoint was saved for this job, so it cannot be undone from here.';
    if (d.head !== d.headAtEnd) return 'Commits were made while this job ran. Undo them in the Git tab; Rauha does not rewrite history.';
    if (d.files.length === 0) return 'This job changed no files.';
    return null;
  }

  /** 작업 브랜치를 버릴 수 있나(버릴 수 있으면 null) */
  discardBlock(): string | null {
    const d = this.data;
    if (d.place !== 'worktree' || d.workBranch === null) return 'This job has no branch to discard.';
    if (d.branchDiscarded) return 'The branch was already discarded.';
    return null;
  }
}

/** 작업별 체크포인트 모음. 불변. 최근 100개만 두고 오래된 것부터 뺀다. */
export class CheckpointBook {
  private constructor(readonly items: readonly Checkpoint[]) {}

  static empty(): CheckpointBook {
    return new CheckpointBook([]);
  }

  static restore(items: readonly Checkpoint[]): CheckpointBook {
    return items.reduce((book, c) => book.remember(c), CheckpointBook.empty());
  }

  /** 같은 작업은 덮어쓰고 새 작업은 뒤에 붙인다 */
  remember(cp: Checkpoint): CheckpointBook {
    const rest = this.items.filter((c) => c.jobId !== cp.jobId);
    return new CheckpointBook([...rest, cp].slice(-CHECKPOINT_LIMITS.records));
  }

  forget(jobId: string): CheckpointBook {
    return new CheckpointBook(this.items.filter((c) => c.jobId !== jobId));
  }

  find(jobId: string): Checkpoint | null {
    return this.items.find((c) => c.jobId === jobId) ?? null;
  }

  /** 대화 초기화 등으로 사라진 작업의 체크포인트는 남기지 않는다 */
  get size(): number {
    return this.items.length;
  }
}

/** 되돌리기 직전의 파일 내용 지문(git blob 해시, 없으면 null) */
export interface FileState {
  /** 작업 시작 때 */
  readonly start: string | null;
  /** 작업이 끝났을 때 */
  readonly end: string | null;
  /** 지금. 읽을 수 없으면(링크·폴더 등) 'unreadable' */
  readonly now: string | null | 'unreadable';
}

export type RevertAction = 'restore' | 'delete' | 'conflict' | 'already';

export interface RevertItem {
  readonly path: string;
  readonly kind: ChangeKind;
  readonly action: RevertAction;
  /** 되돌리면 사라지는 줄(작업이 더한 줄) */
  readonly removedLines: number;
  /** 되돌리면 돌아오는 줄(작업이 지운 줄) */
  readonly restoredLines: number;
}

export interface RevertSummary {
  readonly title: string;
  readonly body: string;
  readonly okLabel: string;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * 되돌리기 계획. 파일마다 어떻게 할지(내용 복원·파일 삭제·충돌로 건너뜀·이미 되돌려짐)를 정한다.
 * 충돌 판정: 지금 내용이 "작업이 끝났을 때"와 다르면 사용자가 그 뒤에 고친 것이라 건드리지 않는다.
 */
export class RevertPlan {
  private constructor(readonly items: readonly RevertItem[]) {}

  /** only: 고른 파일만(없으면 전체). states 에 없는 파일은 충돌로 본다(상태를 모르면 덮어쓰지 않는다). */
  static of(files: readonly FileChange[], states: Readonly<Record<string, FileState>>, only?: readonly string[]): RevertPlan {
    const wanted = only === undefined ? null : new Set(only);
    const items = files
      .filter((f) => wanted === null || wanted.has(f.path))
      .map((f): RevertItem => {
        const state = states[f.path];
        return { path: f.path, kind: f.kind, action: state === undefined ? 'conflict' : RevertPlan.actionOf(state), removedLines: f.added, restoredLines: f.removed };
      });
    return new RevertPlan(items);
  }

  private static actionOf(s: FileState): RevertAction {
    if (s.now === 'unreadable') return 'conflict';
    if (s.now === s.start) return 'already';
    if (s.now !== s.end) return 'conflict';
    return s.start === null ? 'delete' : 'restore';
  }

  /** 실제로 건드릴 파일 */
  get actionable(): readonly RevertItem[] {
    return this.items.filter((i) => i.action === 'restore' || i.action === 'delete');
  }

  get conflicts(): readonly RevertItem[] {
    return this.items.filter((i) => i.action === 'conflict');
  }

  get fileCount(): number {
    return this.actionable.length;
  }

  get removedLines(): number {
    return this.actionable.reduce((n, i) => n + i.removedLines, 0);
  }

  get restoredLines(): number {
    return this.actionable.reduce((n, i) => n + i.restoredLines, 0);
  }

  /** 지워질 새 파일 */
  get deletedFiles(): readonly RevertItem[] {
    return this.actionable.filter((i) => i.action === 'delete');
  }

  /** 확인 창에 보일 글. 파일 수·줄 수·충돌·백업 여부를 모두 말한다. */
  summary(scope: 'file' | 'all'): RevertSummary {
    const n = this.fileCount;
    if (n === 0) {
      return { title: 'Nothing to undo', body: this.conflicts.length > 0 ? `Skipped, changed after the job: ${this.conflicts.map((c) => c.path).join(', ')}` : 'These files already match how they were before the job.', okLabel: 'OK' };
    }
    const lines = [`Removes ${plural(this.removedLines, 'line', 'lines')} the job added and brings back ${plural(this.restoredLines, 'line', 'lines')} it deleted, in ${plural(n, 'file', 'files')}.`];
    if (this.deletedFiles.length > 0) lines.push(`${plural(this.deletedFiles.length, 'new file', 'new files')} the job created will be deleted: ${this.deletedFiles.map((i) => i.path).join(', ')}`);
    if (this.conflicts.length > 0) lines.push(`Conflict, skipped (changed after the job): ${this.conflicts.map((c) => c.path).join(', ')}`);
    lines.push(`Before anything changes, Rauha saves a backup so you can use Undo the undo (the last ${CHECKPOINT_LIMITS.backups} backups are kept; older ones are deleted and cannot be restored).`);
    lines.push('Files Rauha hides as secrets are never touched.');
    return { title: scope === 'file' ? `Revert ${this.items[0]?.path ?? 'this file'}?` : `Undo all changes (${plural(n, 'file', 'files')})?`, body: lines.join('\n'), okLabel: scope === 'file' ? 'Revert file' : 'Undo all changes' };
  }
}

export interface BackupEntry {
  readonly id: string;
  readonly jobId: string;
  readonly repoRoot: string;
  readonly createdAt: string;
  readonly files: number;
}

/** 안전 백업(되돌리기 직전 patch) 장부. 불변. 최근 20개만 두고 넘치면 오래된 것의 id 를 알려 준다(파일을 지우라고). */
export class BackupLedger {
  private constructor(readonly items: readonly BackupEntry[]) {}

  static empty(): BackupLedger {
    return new BackupLedger([]);
  }

  static restore(items: readonly BackupEntry[]): BackupLedger {
    return new BackupLedger(items.slice(-CHECKPOINT_LIMITS.backups));
  }

  add(entry: BackupEntry): { readonly ledger: BackupLedger; readonly evicted: readonly string[] } {
    const all = [...this.items.filter((e) => e.id !== entry.id), entry];
    const keep = all.slice(-CHECKPOINT_LIMITS.backups);
    return { ledger: new BackupLedger(keep), evicted: all.slice(0, all.length - keep.length).map((e) => e.id) };
  }

  remove(id: string): BackupLedger {
    return new BackupLedger(this.items.filter((e) => e.id !== id));
  }

  find(id: string): BackupEntry | null {
    return this.items.find((e) => e.id === id) ?? null;
  }

  /** 그 작업의 가장 최근 백업 */
  latestFor(jobId: string): BackupEntry | null {
    return [...this.items].reverse().find((e) => e.jobId === jobId) ?? null;
  }
}
