import { ROLE_INFO } from '@rauha/core/jobs';
import { ChatHistory, HISTORY_LIMITS, type HistoryEntry } from './chat-history.js';

export interface ChatHistoryJson {
  readonly version: 1;
  readonly jobs: readonly HistoryEntry[];
}

const STATUSES = ['done', 'stopped', 'running'] as const;
const text = (v: unknown, max = 100_000): string | null => (typeof v === 'string' && v.length <= max ? v : null);

/** 저장 파일(바깥 입력)을 믿지 않고 읽어 ChatHistory로 바꾸는 경계. 깨진 항목은 세고 건너뛴다. */
export class ChatHistoryDto {
  private constructor(
    private readonly entries: readonly HistoryEntry[],
    readonly skipped: number,
  ) {}

  static from(input: unknown): ChatHistoryDto {
    const jobs = typeof input === 'object' && input !== null ? (input as { jobs?: unknown }).jobs : undefined;
    if (!Array.isArray(jobs)) return new ChatHistoryDto([], 1);
    const entries: HistoryEntry[] = [];
    let skipped = 0;
    for (const item of jobs as unknown[]) {
      const entry = ChatHistoryDto.entryOf(item);
      if (entry === null) skipped += 1;
      else entries.push(entry);
    }
    return new ChatHistoryDto(entries, skipped);
  }

  private static entryOf(item: unknown): HistoryEntry | null {
    if (typeof item !== 'object' || item === null) return null;
    const o = item as Record<string, unknown>;
    const id = text(o['id'], 200);
    const request = text(o['request']);
    const queuedAt = text(o['queuedAt'], 100);
    const status = STATUSES.find((s) => s === o['status']);
    if (id === null || id === '' || request === null || queuedAt === null || status === undefined) return null;
    const cast = Array.isArray(o['cast']) ? (o['cast'] as unknown[]).filter((r): r is string => typeof r === 'string' && Object.hasOwn(ROLE_INFO, r)).slice(-HISTORY_LIMITS.cast) : [];
    // thread·inTask 는 나중에 생긴 칸: 예전 파일에는 없다(없으면 이어진 작업이 아님)
    const thread = text(o['thread'], 200);
    const linked = thread !== null && thread !== '';
    // talk 는 나중에 생긴 칸: 모르는 역할·깨진 줄은 버린다
    const talk = Array.isArray(o['talk'])
      ? (o['talk'] as unknown[]).flatMap((t) => {
          const line = typeof t === 'object' && t !== null ? (t as Record<string, unknown>) : {};
          const role = line['role'];
          const message = text(line['message'], 2000);
          return typeof role === 'string' && Object.hasOwn(ROLE_INFO, role) && message !== null ? [{ role, message }] : [];
        })
      : [];
    return { id, request, status, stopReason: text(o['stopReason']), result: text(o['result']), toolsLine: text(o['toolsLine']), cast, queuedAt, endedAt: text(o['endedAt'], 100), thread: linked ? thread : null, inTask: linked && o['inTask'] === true, talk };
  }

  toEntity(): ChatHistory {
    return ChatHistory.restore(this.entries);
  }

  static fromEntity(history: ChatHistory): ChatHistoryJson {
    return { version: 1, jobs: history.items };
  }
}
