import { RecordBook, RecordEntry, RecordError, type RecordInput } from '../../shared/record-book.js';
import { RecordBookDto, RecordOpDto, type RecordBookJson, type RecordResult } from '../../shared/record-dto.js';
import type { RecordStorePort } from './record-store.js';

/** 화면에 두는 기록 수 상한. 넘치면 오래된 것은 지우지 않고 보관 파일로 옮긴다. */
export const MAX_RECORDS = 2000;

export interface RecordServiceDeps {
  readonly store: RecordStorePort;
  readonly onChange: (book: RecordBookJson) => void;
  readonly max?: number;
}

const MESSAGE_FALLBACK = 'Could not save the record.';

/** 기록 서비스: 불러오기 → 엔티티 메서드 → 저장. 요청은 한 줄로 세워 하나씩 처리한다. */
export class RecordService {
  private book: RecordBook | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: RecordServiceDeps) {}

  private run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async current(): Promise<RecordBook> {
    this.book ??= await this.deps.store.load();
    return this.book;
  }

  private async commit(next: RecordBook): Promise<RecordBookJson> {
    const { kept, overflow } = next.trimmed(this.deps.max ?? MAX_RECORDS);
    if (overflow.length > 0) await this.deps.store.archive(overflow);
    await this.deps.store.save(kept);
    this.book = kept;
    return RecordBookDto.fromEntity(kept).toJSON();
  }

  get(): Promise<RecordBookJson> {
    return this.run(async () => RecordBookDto.fromEntity(await this.current()).toJSON());
  }

  /** 끝난 작업을 기록한다. 같은 작업을 또 알려 와도 한 번만 남는다. 기록하지 못해도 작업은 영향받지 않는다. */
  capture(input: RecordInput): Promise<void> {
    return this.run(async () => {
      const book = await this.current();
      let entry: RecordEntry;
      try {
        entry = RecordEntry.capture(input);
      } catch (error) {
        if (error instanceof RecordError) return;
        throw error;
      }
      const next = book.add(entry);
      if (next === book) return;
      this.deps.onChange(await this.commit(next));
    }).catch(() => undefined);
  }

  apply(raw: unknown): Promise<RecordResult> {
    return this.run(async (): Promise<RecordResult> => {
      try {
        const next = RecordOpDto.from(raw).applyTo(await this.current());
        return { ok: true, book: await this.commit(next) };
      } catch (error) {
        return { ok: false, error: error instanceof RecordError ? error.message : MESSAGE_FALLBACK };
      }
    });
  }
}
