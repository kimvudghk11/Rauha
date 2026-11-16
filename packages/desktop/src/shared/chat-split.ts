/** 채팅 화면 Main · 팀 목록 비율(넓은 화면). 사용자가 가운데 손잡이를 끌어 정하고, 다음에 열 때도 그대로 쓴다. */
export class ChatSplit {
  static readonly MIN = 35;
  static readonly MAX = 85;
  static readonly DEFAULT = 70;

  private constructor(readonly mainPercent: number) {}

  private static clamped(n: number): ChatSplit {
    if (!Number.isFinite(n)) return new ChatSplit(ChatSplit.DEFAULT);
    return new ChatSplit(Math.round(Math.min(ChatSplit.MAX, Math.max(ChatSplit.MIN, n))));
  }

  /** 저장해 둔 글(없거나 망가졌으면 기본값) */
  static fromStored(raw: string | null): ChatSplit {
    if (raw === null || raw.trim() === '') return new ChatSplit(ChatSplit.DEFAULT);
    return ChatSplit.clamped(Number(raw));
  }

  /** 손잡이를 놓은 자리: 채팅 칸 왼쪽에서 떨어진 거리와 채팅 칸 전체 폭 */
  static fromDrag(offset: number, width: number): ChatSplit {
    if (!(width > 0)) return new ChatSplit(ChatSplit.DEFAULT);
    return ChatSplit.clamped((offset / width) * 100);
  }

  nudge(delta: number): ChatSplit {
    return ChatSplit.clamped(this.mainPercent + delta);
  }

  columns(): { readonly main: string; readonly rooms: string } {
    return { main: `${this.mainPercent}fr`, rooms: `${100 - this.mainPercent}fr` };
  }

  toStored(): string {
    return String(this.mainPercent);
  }
}
