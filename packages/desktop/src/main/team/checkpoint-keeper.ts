import { BackupLedger, Checkpoint, CheckpointBook, RevertPlan, type RevertAction } from '../../shared/checkpoint.js';
import type { ChangesView, CheckpointDiff, CheckpointDone, RevertPreview } from '../../shared/checkpoint-api.js';
import { HUNK_STATE_LIMIT, HunkRef, findHunk, hunkHash, hunkRevertSummary, type HunkState } from '../../shared/checkpoint-hunk.js';
import type { FileDiff } from '../../shared/git-diff.js';
import { ProtectedBranches, RepoPath } from '../../shared/git-guard.js';
import { applyPatch, backupPatch, branchTip, captureEnd, captureStart, deleteBranch, deleteCreated, fileDiffParsed, fileStates, hunkState, listChanges, restoreFile, type IsSecret } from '../git/checkpoint-git.js';
import type { CheckpointStorePort } from '../data/checkpoint-store.js';

export interface CheckpointDeps {
  readonly store: CheckpointStorePort;
  /** 레포 폴더의 비밀 파일 규칙 */
  readonly secretOf: (root: string) => IsSecret;
  readonly protectedBranches: () => readonly string[];
  readonly newId: () => string;
  readonly now: () => string;
}

/** 파일 상태 표시는 이 수까지만 계산한다(파일마다 git 을 한 번씩 부르므로) */
const STATE_LIMIT = 100;

/**
 * 작업 체크포인트의 서비스: 시작 때 기준 남기기 → 끝났을 때 변경 목록 남기기 → 되돌리기 계획·실행(규칙은 Checkpoint·RevertPlan 에 있다).
 * 되돌리기·브랜치 버리기는 한 줄로 세워 같은 동작이 겹쳐 돌지 않게 한다. 어떤 실패도 작업 자체를 멈추지 않는다(begin·finish).
 */
export class CheckpointKeeper {
  private book = CheckpointBook.empty();
  private ledger = BackupLedger.empty();
  private readonly running = new Map<string, Checkpoint>();
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: CheckpointDeps) {}

  async load(): Promise<void> {
    this.book = await this.deps.store.loadBook().catch(() => CheckpointBook.empty());
    this.ledger = await this.deps.store.loadLedger().catch(() => BackupLedger.empty());
  }

  /** 작업이 일할 폴더(cwd)의 기준을 남긴다. git 이 아니면 아무것도 안 한다. */
  async begin(jobId: string, input: { readonly repoRoot: string; readonly cwd: string; readonly place: 'repo' | 'worktree' }): Promise<void> {
    try {
      const base = await captureStart(input.cwd, this.deps.secretOf(input.repoRoot));
      if (base === null) return;
      this.running.set(jobId, Checkpoint.begin({ jobId, repoRoot: input.repoRoot, place: input.place, startedAt: this.deps.now(), ...base }));
    } catch {
      /* 기준을 못 남겨도 작업은 한다 */
    }
  }

  /** 원래 폴더에서 일한 작업이 끝났다 */
  async finishInPlace(jobId: string): Promise<void> {
    const cp = this.running.get(jobId);
    this.running.delete(jobId);
    if (cp === undefined) return;
    try {
      const isSecret = this.deps.secretOf(cp.data.repoRoot);
      const end = await captureEnd(cp.data.repoRoot, isSecret);
      if (end === null || cp.data.startTree === null || end.endTree === null) return;
      const { files, hidden } = await listChanges(cp.data.repoRoot, cp.data.startTree, end.endTree, isSecret);
      await this.keep(cp.finishInPlace({ endedAt: this.deps.now(), headAtEnd: end.head, endTree: end.endTree, files, hiddenCount: Math.max(hidden, end.secretDirty) }));
    } catch {
      /* 변경 목록을 못 만들면 남기지 않는다 */
    }
  }

  /** worktree 로 일한 작업이 끝났다. branch 는 남긴 작업 브랜치(없으면 null) */
  async finishBranch(jobId: string, branch: string | null): Promise<void> {
    const cp = this.running.get(jobId);
    this.running.delete(jobId);
    if (cp === undefined) return;
    try {
      const root = cp.data.repoRoot;
      const tip = branch === null ? null : await branchTip(root, branch);
      const listed = tip === null || cp.data.startTree === null ? { files: [], hidden: 0 } : await listChanges(root, cp.data.startTree, tip, this.deps.secretOf(root));
      await this.keep(cp.finishBranch({ endedAt: this.deps.now(), workBranch: tip === null ? null : branch, branchTip: tip, files: listed.files, hiddenCount: listed.hidden }));
    } catch {
      /* 남기지 않는다 */
    }
  }

  private async keep(cp: Checkpoint): Promise<void> {
    if (!cp.hasChanges()) return;
    this.book = this.book.remember(cp);
    await this.deps.store.saveBook(this.book).catch(() => undefined);
  }

  /** 대화 초기화 등으로 말풍선이 사라진 작업의 기록을 지운다 */
  async forget(jobId: string): Promise<void> {
    this.book = this.book.forget(jobId);
    await this.deps.store.saveBook(this.book).catch(() => undefined);
  }

  private need(jobId: string): Checkpoint {
    const cp = this.book.find(jobId);
    if (cp === null) throw new Error('There is no saved checkpoint for this job.');
    return cp;
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const mine = this.chain.catch(() => undefined).then(work);
    this.chain = mine;
    return mine;
  }

  async changes(jobId: string): Promise<ChangesView | null> {
    const cp = this.book.find(jobId);
    if (cp === null || !cp.hasChanges()) return null;
    const d = cp.data;
    const latest = this.ledger.latestFor(jobId);
    const states: Record<string, RevertAction> = {};
    if (cp.revertBlock() === null && d.files.length <= STATE_LIMIT && d.startTree !== null && d.endTree !== null) {
      try {
        const plan = RevertPlan.of(d.files, await fileStates(d.repoRoot, d.startTree, d.endTree, d.files.map((f) => f.path)));
        for (const i of plan.items) states[i.path] = i.action;
      } catch {
        /* 상태를 모르면 표시하지 않는다 */
      }
    }
    return { jobId, files: d.files, totals: cp.totals(), place: d.place, workBranch: d.workBranch, revertBlock: cp.revertBlock(), discardBlock: cp.discardBlock(), hiddenCount: d.hiddenCount, startDirty: d.startDirty, backup: latest === null ? null : { id: latest.id, files: latest.files, createdAt: latest.createdAt }, states };
  }

  /** 목록에 있는 비밀 아닌 파일의 diff 를 읽는다(읽기 전용) */
  private async readDiff(cp: Checkpoint, path: string): Promise<{ readonly safe: string; readonly parsed: FileDiff }> {
    const safe = RepoPath.parse(path).value;
    const d = cp.data;
    if (!d.files.some((f) => f.path === safe)) throw new Error('That file is not part of this job’s changes.');
    if (this.deps.secretOf(d.repoRoot)(safe)) throw new Error('This file is hidden because it may hold secrets.');
    if (d.startTree === null || d.endTree === null) throw new Error('No checkpoint was saved for this job.');
    return { safe, parsed: await fileDiffParsed(d.repoRoot, d.startTree, d.endTree, safe) };
  }

  /** hunk 단위로 되돌릴 수 있는 파일인가: 고쳐진 글 파일이고, 작업 뒤 커밋이 없고, 글자가 깨지지 않을 때만 */
  private hunkable(cp: Checkpoint, safe: string, parsed: FileDiff): boolean {
    const f = cp.data.files.find((x) => x.path === safe);
    return cp.revertBlock() === null && f?.kind === 'modified' && !f.binary && !parsed.isBinary() && parsed.hunks.length > 0 && !parsed.hunks.some((h) => h.lines.some((l) => l.text.includes('�')));
  }

  async diff(jobId: string, path: string): Promise<CheckpointDiff> {
    const cp = this.need(jobId);
    const { safe, parsed } = await this.readDiff(cp, path);
    const hunkIds = parsed.hunks.map((h) => hunkHash(safe, h));
    const states: HunkState[] = [];
    if (this.hunkable(cp, safe, parsed) && parsed.hunks.length <= HUNK_STATE_LIMIT) {
      for (let i = 0; i < parsed.hunks.length; i++) states.push(await hunkState(cp.data.repoRoot, safe, Buffer.from(parsed.hunkPatch(i), 'utf8')));
    }
    return { binary: parsed.isBinary(), hunks: parsed.hunks, path: safe, hunkIds, hunkStates: states };
  }

  /** 화면이 가리킨 hunk 를 지금 diff 에서 내용 해시로 다시 찾아 패치와 함께 돌려준다. 어긋나면 거절한다. */
  private async hunkTarget(jobId: string, path: string, hunk: string): Promise<{ readonly cp: Checkpoint; readonly safe: string; readonly parsed: FileDiff; readonly index: number; readonly patch: Buffer }> {
    const ref = HunkRef.parse(hunk);
    const cp = this.need(jobId);
    const block = cp.revertBlock();
    if (block !== null) throw new Error(block);
    const { safe, parsed } = await this.readDiff(cp, path);
    if (!this.hunkable(cp, safe, parsed)) throw new Error('Only edited text files can be reverted one change at a time. Use Revert file instead.');
    const index = findHunk(safe, parsed.hunks, ref);
    if (index === null) throw new Error('The change on your screen no longer matches this file’s changes. Reload and try again.');
    return { cp, safe, parsed, index, patch: Buffer.from(parsed.hunkPatch(index), 'utf8') };
  }

  previewHunk(jobId: string, path: string, hunk: string): Promise<RevertPreview> {
    return this.serial(async () => {
      const t = await this.hunkTarget(jobId, path, hunk);
      const state = await hunkState(t.cp.data.repoRoot, t.safe, t.patch);
      if (state === 'already') return { title: 'Nothing to undo', body: 'This change is already reverted.', okLabel: 'OK', files: 0, conflicts: [] };
      if (state === 'conflict') return { title: 'Nothing to undo', body: `Conflict, skipped: this part of ${t.safe} changed after the job, so Rauha will not touch it.`, okLabel: 'OK', files: 0, conflicts: [t.safe] };
      return { ...hunkRevertSummary(t.safe, t.parsed.hunks[t.index]!), files: 1, conflicts: [] };
    });
  }

  /** hunk 하나를 되돌린다: 다시 확인(git apply -R --check) → 백업 → 적용. 그 자리가 작업 뒤 바뀌었으면 건너뛴다. */
  revertHunk(jobId: string, path: string, hunk: string): Promise<CheckpointDone> {
    return this.serial(async () => {
      const t = await this.hunkTarget(jobId, path, hunk);
      const d = t.cp.data;
      const state = await hunkState(d.repoRoot, t.safe, t.patch);
      if (state === 'already') return { message: 'This change was already reverted.', reverted: 0, conflicts: [], backupId: null };
      if (state === 'conflict') return { message: `Skipped: this part of ${t.safe} changed after the job.`, reverted: 0, conflicts: [t.safe], backupId: null };
      // 되돌리기 전에 이 hunk 의 패치를 백업으로 남긴다(작업 전→후 방향이라 되돌린 파일에 그대로 적용하면 hunk 가 돌아온다). 못 남기면 아무것도 바꾸지 않는다.
      const id = this.deps.newId();
      await this.deps.store.writePatch(id, t.patch);
      const added = this.ledger.add({ id, jobId, repoRoot: d.repoRoot, createdAt: this.deps.now(), files: 1 });
      this.ledger = added.ledger;
      for (const old of added.evicted) await this.deps.store.removePatch(old);
      await this.deps.store.saveLedger(this.ledger);
      const result = await applyPatch(d.repoRoot, t.patch, this.deps.secretOf(d.repoRoot), { reverse: true });
      if (!result.ok) {
        // 적용에 실패했으면 아무것도 안 바뀌었으니 쓸모없는 백업은 치운다
        this.ledger = this.ledger.remove(id);
        await this.deps.store.removePatch(id);
        await this.deps.store.saveLedger(this.ledger);
        return { message: result.error, reverted: 0, conflicts: [t.safe], backupId: null };
      }
      return { message: `Reverted 1 change in ${t.safe}.`, reverted: 1, conflicts: [], backupId: id };
    });
  }

  private async planOf(cp: Checkpoint, paths: readonly string[] | undefined): Promise<RevertPlan> {
    const block = cp.revertBlock();
    if (block !== null) throw new Error(block);
    const d = cp.data;
    const listed = new Set(d.files.map((f) => f.path));
    const only = paths?.map((p) => RepoPath.parse(p).value);
    if (only?.some((p) => !listed.has(p)) === true) throw new Error('That file is not part of this job’s changes.');
    const states = await fileStates(d.repoRoot, d.startTree!, d.endTree!, (only ?? d.files.map((f) => f.path)));
    return RevertPlan.of(d.files, states, only);
  }

  preview(jobId: string, paths?: readonly string[]): Promise<RevertPreview> {
    return this.serial(async () => {
      const plan = await this.planOf(this.need(jobId), paths);
      return { ...plan.summary(paths === undefined ? 'all' : 'file'), files: plan.fileCount, conflicts: plan.conflicts.map((c) => c.path) };
    });
  }

  /** 되돌린다: 백업 → 파일별 복원·삭제. 충돌 파일은 건너뛴다. */
  revert(jobId: string, paths?: readonly string[]): Promise<CheckpointDone> {
    return this.serial(async () => {
      const cp = this.need(jobId);
      const plan = await this.planOf(cp, paths);
      const conflicts = plan.conflicts.map((c) => c.path);
      if (plan.fileCount === 0) return { message: conflicts.length > 0 ? `Skipped ${conflicts.length} file(s) that changed after the job.` : 'Nothing to undo.', reverted: 0, conflicts, backupId: null };
      const d = cp.data;
      const targets = plan.actionable;
      // 되돌리기 전에 지금 내용을 패치로 남긴다. 못 남기면 아무것도 바꾸지 않는다.
      const id = this.deps.newId();
      await this.deps.store.writePatch(id, await backupPatch(d.repoRoot, d.startTree!, targets.map((t) => t.path)));
      const added = this.ledger.add({ id, jobId, repoRoot: d.repoRoot, createdAt: this.deps.now(), files: targets.length });
      this.ledger = added.ledger;
      for (const old of added.evicted) await this.deps.store.removePatch(old);
      await this.deps.store.saveLedger(this.ledger);
      const failed: string[] = [];
      let reverted = 0;
      const apply = async (list: readonly { readonly path: string; readonly action: RevertAction }[]): Promise<void> => {
        for (const t of list) {
          try {
            if (t.action === 'delete') await deleteCreated(d.repoRoot, t.path);
            else await restoreFile(d.repoRoot, d.startTree!, t.path);
            reverted += 1;
          } catch {
            failed.push(t.path);
          }
        }
      };
      // 새로 만든 파일을 먼저 지운다: 파일과 폴더가 서로 바뀐 이름은 지우고 나서야 원래 것을 되살릴 수 있다
      const deletes = targets.filter((t) => t.action === 'delete');
      await apply(deletes);
      let skipped = conflicts;
      let restores = targets.filter((t) => t.action !== 'delete');
      if (deletes.length > 0 && conflicts.length > 0) {
        // 지우고 나니 폴더가 비어 길이 열린 파일이 있을 수 있다(폴더였던 자리에 원래 파일이 있던 경우). 상태를 다시 보고, 그래도 막힌 것만 건너뛴다.
        const again = await this.planOf(cp, paths).catch(() => null);
        if (again !== null) {
          restores = again.actionable.filter((i) => i.action === 'restore');
          skipped = again.conflicts.map((c) => c.path);
        }
      }
      await apply(restores);
      const parts = [`Reverted ${reverted} file(s).`];
      if (skipped.length > 0) parts.push(`Skipped ${skipped.length} that changed after the job.`);
      if (failed.length > 0) parts.push(`Could not change: ${failed.join(', ')}.`);
      return { message: parts.join(' '), reverted, conflicts: [...skipped, ...failed], backupId: id };
    });
  }

  /** 가장 최근 되돌리기를 취소한다(Undo the undo). 그 사이 파일이 바뀌었으면 아무것도 바꾸지 않는다. */
  undoRevert(jobId: string): Promise<{ readonly message: string }> {
    return this.serial(async () => {
      const entry = this.ledger.latestFor(jobId);
      if (entry === null) throw new Error('There is no backup to restore for this job.');
      const patch = await this.deps.store.readPatch(entry.id);
      if (patch === null) throw new Error('The backup file is gone.');
      const result = await applyPatch(entry.repoRoot, patch, this.deps.secretOf(entry.repoRoot));
      if (!result.ok) throw new Error(result.error);
      this.ledger = this.ledger.remove(entry.id);
      await this.deps.store.removePatch(entry.id);
      await this.deps.store.saveLedger(this.ledger);
      return { message: `Brought back the ${entry.files} file(s) you reverted.` };
    });
  }

  /** worktree 로 돈 작업의 브랜치를 버린다. 보호 브랜치·현재 브랜치·작업 뒤 새 커밋이 있는 브랜치는 버리지 않는다. */
  discardBranch(jobId: string): Promise<{ readonly message: string }> {
    return this.serial(async () => {
      const cp = this.need(jobId);
      const block = cp.discardBlock();
      if (block !== null) throw new Error(block);
      const d = cp.data;
      const branch = d.workBranch!;
      if (ProtectedBranches.of(this.deps.protectedBranches()).has(branch)) throw new Error(`${branch} is a protected branch, so Rauha will not delete it.`);
      if ((await branchTip(d.repoRoot, branch)) !== d.endTree) throw new Error('The branch has new commits since the job. Delete it from the Git tab if you are sure.');
      await deleteBranch(d.repoRoot, branch);
      this.book = this.book.remember(cp.withBranchDiscarded());
      await this.deps.store.saveBook(this.book).catch(() => undefined);
      return { message: `Deleted branch ${branch}.` };
    });
  }
}
