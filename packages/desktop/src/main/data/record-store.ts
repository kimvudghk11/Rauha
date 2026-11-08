import { RecordBookDto, type RecordBookJson } from '../../shared/record-dto.js';
import { RecordBook, type RecordEntry } from '../../shared/record-book.js';
import { JsonFile } from './json-file.js';

export interface RecordStorePort {
  load(): Promise<RecordBook>;
  save(book: RecordBook): Promise<void>;
  /** 화면에 보이는 상한을 넘은 오래된 기록을 지우지 않고 보관 파일로 옮긴다 */
  archive(entries: readonly RecordEntry[]): Promise<void>;
}

/** 기록은 이 PC의 JSON 파일에만 둔다(AWS S3 전송은 아직 없다). */
export class RecordStore implements RecordStorePort {
  private readonly json: JsonFile;
  private readonly archiveFile: JsonFile;
  constructor(file: string, private readonly now: () => string = () => new Date().toISOString()) {
    this.json = new JsonFile(file);
    this.archiveFile = new JsonFile(`${file}.archive.jsonl`);
  }

  async load(): Promise<RecordBook> {
    const read = await this.json.read();
    if (read.kind === 'missing') return RecordBook.empty();
    if (read.kind === 'broken') {
      await this.json.keepCopy(this.now());
      return RecordBook.empty();
    }
    const dto = RecordBookDto.from(read.value);
    if (dto.skipped > 0) await this.json.keepCopy(this.now());
    return dto.toEntity();
  }

  async save(book: RecordBook): Promise<void> {
    await this.json.write(RecordBookDto.fromEntity(book).toJSON() satisfies RecordBookJson);
  }

  async archive(entries: readonly RecordEntry[]): Promise<void> {
    for (const e of entries) await this.archiveFile.append(RecordBookDto.fromEntity(RecordBook.restore([e])).toJSON().entries[0]);
  }
}
