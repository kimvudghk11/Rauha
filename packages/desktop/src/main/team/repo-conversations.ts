import { join } from 'node:path';
import { FileChatSnapshots, type ChatSnapshot } from '@rauha/core';
import { ConversationMerge } from './conversation-merge.js';

/** 업무 하나가 연 앞 대화. base: 이어 받은 대화(없으면 null), finish: 끝난 세션의 대화를 레포 대화에 합쳐 저장 */
export interface OpenConversation {
  readonly base: ChatSnapshot | null;
  finish(final: ChatSnapshot): Promise<void>;
}

/**
 * 레포(keyRoot)마다 앞 대화를 파일에 이어 둔다(앱을 다시 켜도 남는다). 합치는 규칙은 ConversationMerge에 있고,
 * 여기서는 불러오기 → 합치기 → 저장만 한다. 같은 레포의 저장은 한 줄로 세워 동시에 끝난 업무가 서로 덮어쓰지 않게 한다.
 */
export class RepoConversations {
  private readonly queues = new Map<string, Promise<void>>();

  /** dir: 대화 파일을 둘 폴더 */
  constructor(private readonly dir: string) {}

  private static readonly shared = new Map<string, RepoConversations>();

  /** 프로필의 sessions 폴더 아래 desktop 폴더. 같은 폴더는 앱 안에서 하나를 나눠 써서 저장 줄이 하나다. */
  static under(sessionsDir: string): RepoConversations {
    const dir = join(sessionsDir, 'desktop');
    const known = RepoConversations.shared.get(dir) ?? new RepoConversations(dir);
    RepoConversations.shared.set(dir, known);
    return known;
  }

  async open(keyRoot: string): Promise<OpenConversation> {
    const files = new FileChatSnapshots(this.dir, keyRoot);
    const base = await files.load();
    const merge = ConversationMerge.startingFrom(base);
    return {
      base,
      finish: (final) => this.inLine(keyRoot, async () => files.save(merge.finishedWith(await files.load(), final))),
    };
  }

  private inLine(keyRoot: string, run: () => Promise<void>): Promise<void> {
    const key = keyRoot.replace(/\\/g, '/').toLowerCase();
    const result = (this.queues.get(key) ?? Promise.resolve()).then(run);
    this.queues.set(key, result.catch(() => undefined));
    return result;
  }
}
