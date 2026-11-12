/** 맨 아래에서 이만큼(px) 안이면 맨 아래에 붙어 있다고 본다 */
const NEAR_BOTTOM = 40;

/**
 * 채팅 스크롤 위치 기억. 탭을 바꾸면 채팅 화면이 DOM에서 떨어졌다 붙으며 스크롤이 맨 위(0)로 돌아가서,
 * 떨어지기 전 자리를 기억해 두었다가 돌아올 때 되돌린다. 맨 아래에 있었으면 그사이 늘어난 내용까지 맨 아래로 간다.
 */
export class ChatScroll {
  private constructor(
    private top: number,
    private atBottom: boolean,
  ) {}

  static start(): ChatScroll {
    return new ChatScroll(0, true);
  }

  get pinned(): boolean {
    return this.atBottom;
  }

  /** 사용자가 스크롤할 때마다 지금 자리를 기억한다 */
  observe(at: { readonly top: number; readonly client: number; readonly height: number }): void {
    this.top = at.top;
    this.atBottom = at.height - at.client - at.top <= NEAR_BOTTOM;
  }

  /** 다시 보일 때 돌아갈 scrollTop */
  restoreTop(size: { readonly client: number; readonly height: number }): number {
    return this.atBottom ? Math.max(0, size.height - size.client) : this.top;
  }
}
