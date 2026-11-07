import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { RuleBookDto } from '../application/dto/rule-book.dto.js';
import { RuleBook } from '../domain/rule-book.js';

/** 규칙을 JSON 파일 하나에 둔다(사용자 PC에만). 파일이 없으면 빈 규칙이다. 깨진 파일은 숨기지 않고 오류로 알린다. */
export class FileRuleStore {
  constructor(private readonly file: string) {}

  async load(): Promise<RuleBook> {
    let text: string;
    try {
      text = await readFile(this.file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return RuleBook.empty();
      throw error;
    }
    return RuleBookDto.from(JSON.parse(text)).toEntity();
  }

  async save(book: RuleBook): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(RuleBookDto.fromEntity(book), null, 2), 'utf8');
  }
}
