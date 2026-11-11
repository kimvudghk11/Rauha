import { BackupLedger, Checkpoint, CheckpointBook, CHECKPOINT_LIMITS, type BackupEntry, type CheckpointData, type FileChange } from './checkpoint.js';
import { BranchName, RepoPath } from './git-guard.js';

const HASH = /^[0-9a-f]{40,64}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max = 4000): string | null => (typeof v === 'string' && v !== '' && v.length <= max && !CONTROL.test(v) ? v : null);
const hashOrNull = (v: unknown): string | null | undefined => (v === null ? null : typeof v === 'string' && HASH.test(v) ? v : undefined);
const count = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 10_000_000 ? v : null);

function fileOf(raw: unknown): FileChange | null {
  if (!isObject(raw)) return null;
  const { path, kind, added, removed, binary } = raw;
  if (typeof path !== 'string' || CONTROL.test(path)) return null;
  try {
    RepoPath.parse(path);
  } catch {
    return null;
  }
  const a = count(added);
  const r = count(removed);
  if ((kind !== 'added' && kind !== 'modified' && kind !== 'deleted') || a === null || r === null || typeof binary !== 'boolean') return null;
  return { path, kind, added: a, removed: r, binary };
}

function dataOf(raw: unknown): CheckpointData | null {
  if (!isObject(raw)) return null;
  const jobId = text(raw['jobId'], 200);
  const repoRoot = text(raw['repoRoot'], 1000);
  const startedAt = text(raw['startedAt'], 100);
  const place = raw['place'];
  const head = hashOrNull(raw['head']);
  const headAtEnd = hashOrNull(raw['headAtEnd']);
  const startTree = hashOrNull(raw['startTree']);
  const endTree = hashOrNull(raw['endTree']);
  const startDirty = count(raw['startDirty']);
  const hiddenCount = count(raw['hiddenCount']);
  const endedAt = raw['endedAt'] === null ? null : text(raw['endedAt'], 100);
  if (jobId === null || repoRoot === null || startedAt === null || (place !== 'repo' && place !== 'worktree') || startDirty === null || hiddenCount === null) return null;
  if (head === undefined || headAtEnd === undefined || startTree === undefined || endTree === undefined || (raw['endedAt'] !== null && endedAt === null)) return null;
  let branch: string | null = null;
  if (raw['branch'] !== null) {
    try {
      branch = BranchName.parse(String(raw['branch'])).value;
    } catch {
      return null;
    }
  }
  let workBranch: string | null = null;
  if (raw['workBranch'] !== null) {
    try {
      workBranch = BranchName.parse(String(raw['workBranch'])).value;
    } catch {
      return null;
    }
  }
  if (!Array.isArray(raw['files']) || typeof raw['branchDiscarded'] !== 'boolean') return null;
  const files = raw['files'].slice(0, CHECKPOINT_LIMITS.files).map(fileOf);
  if (files.some((f) => f === null)) return null;
  return { jobId, repoRoot, place, startedAt, endedAt, head, headAtEnd, branch, startTree, endTree, startDirty, workBranch, branchDiscarded: raw['branchDiscarded'], files: files as FileChange[], hiddenCount };
}

/** checkpoints.json ↔ CheckpointBook. 깨진 항목은 건너뛰고 몇 개였는지 알려 준다(저장소가 원본을 .bak 으로 보존한다). */
export class CheckpointBookDto {
  private constructor(
    private readonly items: readonly Checkpoint[],
    readonly skipped: number,
  ) {}

  static from(raw: unknown): CheckpointBookDto {
    const list = isObject(raw) && Array.isArray(raw['items']) ? raw['items'] : [];
    const good: Checkpoint[] = [];
    let skipped = isObject(raw) && Array.isArray(raw['items']) ? 0 : 1;
    for (const item of list) {
      const data = dataOf(item);
      if (data === null) skipped += 1;
      else good.push(Checkpoint.restore(data));
    }
    return new CheckpointBookDto(good, skipped);
  }

  toEntity(): CheckpointBook {
    return CheckpointBook.restore(this.items);
  }

  static fromEntity(book: CheckpointBook): { readonly version: 1; readonly items: readonly CheckpointData[] } {
    return { version: 1, items: book.items.map((c) => c.data) };
  }
}

function backupOf(raw: unknown): BackupEntry | null {
  if (!isObject(raw)) return null;
  const id = typeof raw['id'] === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(raw['id']) ? raw['id'] : null;
  const jobId = text(raw['jobId'], 200);
  const repoRoot = text(raw['repoRoot'], 1000);
  const createdAt = text(raw['createdAt'], 100);
  const files = count(raw['files']);
  return id === null || jobId === null || repoRoot === null || createdAt === null || files === null ? null : { id, jobId, repoRoot, createdAt, files };
}

/** undo-backups/index.json ↔ BackupLedger */
export class BackupLedgerDto {
  private constructor(
    private readonly items: readonly BackupEntry[],
    readonly skipped: number,
  ) {}

  static from(raw: unknown): BackupLedgerDto {
    const list = isObject(raw) && Array.isArray(raw['items']) ? raw['items'] : [];
    const good = list.map(backupOf).filter((b): b is BackupEntry => b !== null);
    return new BackupLedgerDto(good, list.length - good.length + (isObject(raw) && Array.isArray(raw['items']) ? 0 : 1));
  }

  toEntity(): BackupLedger {
    return BackupLedger.restore(this.items);
  }

  static fromEntity(ledger: BackupLedger): { readonly version: 1; readonly items: readonly BackupEntry[] } {
    return { version: 1, items: ledger.items };
  }
}
