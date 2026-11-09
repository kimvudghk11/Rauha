import { join } from 'node:path';
import { FileChatSnapshots, type ChatSnapshot } from '@rauha/core';
import { DoubtedAnswers } from './doubted-answers.js';
import { ConversationMerge } from './conversation-merge.js';
import { ConversationResets } from './conversation-resets.js';

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
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly resets = new ConversationResets();

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

  /**
   * others: 같은 작업 공간의 다른 레포. 그 레포들의 앞 대화도 최근 순으로 함께 이어 받는다(읽기만 하고 저장은 이 레포 파일에만 한다).
   * 이어 일할 파일 목록은 레포 기준이라 이 레포 것만 받는다.
   */
  async open(keyRoot: string, others: readonly { readonly name: string; readonly root: string }[] = []): Promise<OpenConversation> {
    const files = new FileChatSnapshots(this.dir, keyRoot);
    // 초기화 표식을 먼저 받고, 대화는 저장 줄을 거쳐 읽는다(앞서 요청된 초기화가 끝난 뒤의 모습을 본다).
    const mark = this.resets.watch(keyRoot);
    const loaded = await this.inLine(keyRoot, () => files.load());
    const own = loaded !== null && !ConversationMerge.isBlank(loaded) ? loaded : null;
    const beside = await Promise.all(others.map(async ({ name, root }) => ({ name, snapshot: await new FileChatSnapshots(this.dir, root).load() })));
    const seen = ConversationMerge.alongside(own, beside.filter((o): o is { name: string; snapshot: ChatSnapshot } => o.snapshot !== null && !ConversationMerge.isBlank(o.snapshot)));
    // 합치는 규칙은 사실 그대로의 대화로 세고, 다음 업무에는 믿으면 안 되는 답을 걸러서 싣는다(턴 수는 같다).
    const base = seen === null ? null : { ...seen, turns: DoubtedAnswers.mark(seen.turns) };
    const merge = ConversationMerge.startingFrom(seen);
    return {
      base,
      finish: (final) => this.inLine(keyRoot, () => mark.ifCurrent(async () => files.save(merge.finishedWith(await files.load(), final)))),
    };
  }

  /** 레포 하나의 앞 대화와 이어 일할 파일 목록을 비운다. 이미 도는 업무의 결과는 이후 합치지 않는다. */
  async clear(keyRoot: string): Promise<void> {
    this.resets.reset(keyRoot);
    const files = new FileChatSnapshots(this.dir, keyRoot);
    await this.inLine(keyRoot, () => files.save(ConversationMerge.blank(new Date().toISOString())));
  }

  async clearAll(keyRoots: readonly string[]): Promise<void> {
    await Promise.all(keyRoots.map((root) => this.clear(root)));
  }

  private inLine<T>(keyRoot: string, run: () => Promise<T>): Promise<T> {
    const key = keyRoot.replace(/\\/g, '/').toLowerCase();
    const result = (this.queues.get(key) ?? Promise.resolve()).then(run);
    this.queues.set(key, result.catch(() => undefined));
    return result;
  }
}
