import { BugListDto } from '../../shared/bug-note-dto.js';
import type { BugNoteList } from '../../shared/bug-note.js';
import { JsonFile } from '../data/json-file.js';

/** 답답한 점 메모를 앱 데이터 폴더의 JSON 파일 하나에 둔다. 인터넷이 없어도 여기 먼저 저장된다. */
export interface BugStorePort {
  load(): Promise<BugNoteList>;
  save(list: BugNoteList): Promise<void>;
}

export class BugStore implements BugStorePort {
  private readonly json: JsonFile;
  constructor(file: string, private readonly now: () => string = () => new Date().toISOString()) {
    this.json = new JsonFile(file);
  }

  /** 없으면 빈 모음. 깨졌거나 일부가 깨졌으면 원본을 옆에 복사해 두고 읽을 수 있는 만큼 연다. */
  async load(): Promise<BugNoteList> {
    const read = await this.json.read();
    if (read.kind === 'missing') return BugListDto.from({ items: [] }).toEntity();
    if (read.kind === 'broken') {
      await this.json.keepCopy(this.now());
      return BugListDto.from({ items: [] }).toEntity();
    }
    const dto = BugListDto.from(read.value);
    if (dto.skipped > 0) await this.json.keepCopy(this.now());
    return dto.toEntity();
  }

  async save(list: BugNoteList): Promise<void> {
    await this.json.write(BugListDto.fromEntity(list).toJSON());
  }
}
