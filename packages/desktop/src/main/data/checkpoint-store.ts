import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BackupLedgerDto, CheckpointBookDto } from '../../shared/checkpoint-dto.js';
import { BackupLedger, CheckpointBook } from '../../shared/checkpoint.js';
import { JsonFile } from './json-file.js';

export interface CheckpointStorePort {
  loadBook(): Promise<CheckpointBook>;
  saveBook(book: CheckpointBook): Promise<void>;
  loadLedger(): Promise<BackupLedger>;
  saveLedger(ledger: BackupLedger): Promise<void>;
  writePatch(id: string, patch: Buffer): Promise<void>;
  readPatch(id: string): Promise<Buffer | null>;
  removePatch(id: string): Promise<void>;
}

const PATCH_ID = /^[A-Za-z0-9-]{8,64}$/;

/**
 * 작업 체크포인트(checkpoints.json)와 되돌리기 전 안전 백업(undo-backups/)을 앱 데이터 폴더에 둔다.
 * 깨진 파일은 `.bak-<시각>` 으로 보존하고 빈 상태로 시작한다(대화 복원 chat-history 와 같은 방식).
 */
export class CheckpointStore implements CheckpointStorePort {
  private readonly book: JsonFile;
  private readonly ledger: JsonFile;
  private readonly dir: string;

  constructor(dataDir: string, private readonly now: () => string = () => new Date().toISOString()) {
    this.book = new JsonFile(join(dataDir, 'checkpoints.json'));
    this.dir = join(dataDir, 'undo-backups');
    this.ledger = new JsonFile(join(this.dir, 'index.json'));
  }

  async loadBook(): Promise<CheckpointBook> {
    const read = await this.book.read();
    if (read.kind === 'missing') return CheckpointBook.empty();
    if (read.kind === 'broken') {
      await this.book.keepCopy(this.now(), 'bak');
      return CheckpointBook.empty();
    }
    const dto = CheckpointBookDto.from(read.value);
    if (dto.skipped > 0) await this.book.keepCopy(this.now(), 'bak');
    return dto.toEntity();
  }

  saveBook(book: CheckpointBook): Promise<void> {
    return this.book.write(CheckpointBookDto.fromEntity(book));
  }

  async loadLedger(): Promise<BackupLedger> {
    const read = await this.ledger.read();
    if (read.kind === 'missing') return BackupLedger.empty();
    if (read.kind === 'broken') {
      await this.ledger.keepCopy(this.now(), 'bak');
      return BackupLedger.empty();
    }
    const dto = BackupLedgerDto.from(read.value);
    if (dto.skipped > 0) await this.ledger.keepCopy(this.now(), 'bak');
    return dto.toEntity();
  }

  saveLedger(ledger: BackupLedger): Promise<void> {
    return this.ledger.write(BackupLedgerDto.fromEntity(ledger));
  }

  private patchFile(id: string): string {
    if (!PATCH_ID.test(id)) throw new Error('The backup id is not valid.');
    return join(this.dir, `${id}.patch`);
  }

  async writePatch(id: string, patch: Buffer): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.patchFile(id), patch);
  }

  async readPatch(id: string): Promise<Buffer | null> {
    return readFile(this.patchFile(id)).catch(() => null);
  }

  async removePatch(id: string): Promise<void> {
    await rm(this.patchFile(id), { force: true }).catch(() => undefined);
  }
}
