import { redactSecrets } from './chat-redact.js';

/** 채팅 말풍선으로 다시 그릴 일 하나. 돌던 일은 'running'으로만 남긴다(이유·결과를 아직 모른다). */
export interface HistoryEntry {
  readonly id: string;
  readonly request: string;
  readonly status: 'done' | 'stopped' | 'running';
  readonly stopReason: string | null;
  readonly result: string | null;
  readonly toolsLine: string | null;
  /** 일에 나온 팀원 역할(많아야 셋) */
  readonly cast: readonly string[];
  readonly queuedAt: string;
  readonly endedAt: string | null;
}

/** 앱을 다시 켰을 때 화면에 올릴 일: 끝난 것은 그대로, 돌던 것은 중단됨 */
export interface RestoredEntry extends Omit<HistoryEntry, 'status'> {
  readonly status: 'done' | 'stopped';
}

export const HISTORY_LIMITS = { jobs: 50, request: 4000, result: 20000, reason: 500, tools: 200, cast: 3 } as const;
export const INTERRUPTED_REASON = '앱이 꺼져서 중단됐어요.';

const cut = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * 채팅 말풍선 기록(재시작 뒤 복원용). 불변. 최근 50개만 두고 글자 수를 제한하며 비밀 값은 가려서 담는다.
 * 대화 초기화·/clear 때는 cleared()로 비운다.
 */
export class ChatHistory {
  private constructor(private readonly entries: readonly HistoryEntry[]) {}

  static empty(): ChatHistory {
    return new ChatHistory([]);
  }

  /** 저장된 항목에서 만든다(상한·크기 규칙을 다시 적용한다) */
  static restore(entries: readonly HistoryEntry[]): ChatHistory {
    return ChatHistory.empty().remember(entries);
  }

  /** 작업 판의 지금 모습을 합친다. 같은 id는 덮어쓰고 새 id는 뒤에 붙이며, 상한을 넘으면 오래된 것부터 뺀다. */
  remember(jobs: readonly HistoryEntry[]): ChatHistory {
    const merged = [...this.entries];
    for (const job of jobs) {
      const entry = ChatHistory.tidy(job);
      const at = merged.findIndex((e) => e.id === entry.id);
      if (at >= 0) merged[at] = entry;
      else merged.push(entry);
    }
    return new ChatHistory(merged.slice(-HISTORY_LIMITS.jobs));
  }

  /** 이 id들은 기록에서 뺀다(초기화한 뒤에도 도는 일이 다시 담기지 않게) */
  without(ids: ReadonlySet<string>): ChatHistory {
    return new ChatHistory(this.entries.filter((e) => !ids.has(e.id)));
  }

  cleared(): ChatHistory {
    return ChatHistory.empty();
  }

  get isEmpty(): boolean {
    return this.entries.length === 0;
  }

  get items(): readonly HistoryEntry[] {
    return this.entries;
  }

  /** 앱을 켤 때 화면에 올릴 목록: 돌던 일은 중단됨으로 */
  restored(): readonly RestoredEntry[] {
    return this.entries.map((e): RestoredEntry =>
      e.status === 'running'
        ? { ...e, status: 'stopped', stopReason: INTERRUPTED_REASON, result: null, endedAt: e.endedAt ?? e.queuedAt }
        : { ...e, status: e.status },
    );
  }

  private static tidy(job: HistoryEntry): HistoryEntry {
    const over = job.status !== 'running';
    const clean = (text: string | null, max: number): string | null => (text === null ? null : cut(redactSecrets(text), max));
    return {
      id: job.id,
      request: cut(redactSecrets(job.request), HISTORY_LIMITS.request),
      status: job.status,
      stopReason: over ? clean(job.stopReason, HISTORY_LIMITS.reason) : null,
      result: over ? clean(job.result, HISTORY_LIMITS.result) : null,
      toolsLine: over ? clean(job.toolsLine, HISTORY_LIMITS.tools) : null,
      cast: over ? job.cast.slice(-HISTORY_LIMITS.cast) : [],
      queuedAt: job.queuedAt,
      endedAt: over ? job.endedAt : null,
    };
  }
}
