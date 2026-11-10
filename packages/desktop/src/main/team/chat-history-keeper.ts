import type { ChatHistoryStorePort } from '../data/chat-history-store.js';
import { ChatHistory, type HistoryEntry } from '../../shared/chat-history.js';
import { restoredView } from '../../shared/chat-history-view.js';
import type { JobView } from '../../shared/ipc.js';

/** 작업 판의 일 하나를 기록 항목으로 옮긴다(끝나지 않은 일은 모두 'running') */
export function entryOfView(view: JobView): HistoryEntry {
  const over = view.status === 'done' || view.status === 'stopped';
  return {
    id: view.id,
    request: view.request,
    status: over ? view.status : 'running',
    stopReason: view.stopReason,
    result: view.result,
    toolsLine: view.toolsLine,
    cast: view.cast,
    queuedAt: view.queuedAt,
    endedAt: view.endedAt,
  };
}

/**
 * 채팅 말풍선 기록의 서비스: 불러오기 → 합치기 → 저장만 한다(규칙은 ChatHistory에 있다).
 * 저장 실패는 앱을 멈추지 않는다(다음 변경 때 다시 쓴다).
 */
export class ChatHistoryKeeper {
  private history = ChatHistory.empty();
  private hidden = new Set<string>();
  /** 이번에 앱을 켤 때 읽은 지난 일(창을 다시 열어도 같은 것만 돌려준다. 이번에 도는 일은 판이 알려 준다) */
  private startup: readonly JobView[] = [];
  private lastSaved = '';

  constructor(private readonly store: ChatHistoryStorePort) {}

  /** 앱을 켤 때 한 번 읽는다. 돌던 일은 중단됨으로 바꿔 다시 저장한다. */
  async load(): Promise<void> {
    const loaded = await this.store.load().catch(() => ChatHistory.empty());
    const restored = loaded.restored();
    this.history = ChatHistory.restore(restored);
    this.startup = restored.map(restoredView);
    await this.persist();
  }

  /** 화면에 올릴 지난 말풍선 */
  restored(): readonly JobView[] {
    return this.startup;
  }

  /** 작업 판이 바뀔 때마다 부른다. 바뀐 것이 있을 때만 파일에 쓴다. */
  observe(views: readonly JobView[]): Promise<void> {
    this.history = this.history.remember(views.filter((v) => !this.hidden.has(v.id)).map(entryOfView));
    return this.persist();
  }

  /** 대화 초기화·/clear: 기록을 비운다. 이 시점에 판에 있던 일(도는 중인 것 포함)은 이후에도 담지 않는다. */
  async clear(boardIds: readonly string[]): Promise<void> {
    for (const id of boardIds) this.hidden.add(id);
    this.history = this.history.cleared();
    this.startup = [];
    await this.persist();
  }

  private async persist(): Promise<void> {
    const key = JSON.stringify(this.history.items);
    if (key === this.lastSaved) return;
    const snapshot = this.history;
    try {
      await this.store.save(snapshot);
      this.lastSaved = key;
    } catch {
      /* 다음 변경 때 다시 쓴다 */
    }
  }
}
