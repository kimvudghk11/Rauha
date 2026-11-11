/** 화면이 아직 소화하지 못한 출력이 이만큼 쌓이면 PTY 읽기를 멈춘다 */
export const FLOW_HIGH = 512 * 1024;
/** 소화 못 한 양이 이만큼 아래로 내려오면 다시 읽는다 */
export const FLOW_LOW = 128 * 1024;

export type FlowAction = 'pause' | 'resume' | null;

/**
 * PTY 출력의 흐름 제어. main이 화면으로 보낸 양과 화면이 "다 그렸다"고 알려 온 양의 차이(inFlight)를 세어,
 * 화면이 못 따라가면 PTY를 멈춘다(`yes` 같은 끝없는 출력이 메모리와 IPC를 채우지 못하게).
 */
export class OutputFlow {
  private pending = 0;
  private stopped = false;

  private constructor(
    private readonly high: number,
    private readonly low: number,
  ) {}

  static create(high: number = FLOW_HIGH, low: number = FLOW_LOW): OutputFlow {
    return new OutputFlow(high, low);
  }

  get inFlight(): number {
    return this.pending;
  }

  get paused(): boolean {
    return this.stopped;
  }

  /** n 글자를 화면으로 보냈다. 멈춰야 하면 'pause'. */
  sent(n: number): FlowAction {
    this.pending += n;
    if (!this.stopped && this.pending >= this.high) {
      this.stopped = true;
      return 'pause';
    }
    return null;
  }

  /** 화면이 n 글자를 그렸다고 알려 왔다. 보낸 양보다 많거나 정수가 아닌 값은 믿지 않는다. 다시 읽어도 되면 'resume'. */
  acked(n: number): FlowAction {
    if (!Number.isSafeInteger(n) || n < 0) return null;
    this.pending -= Math.min(n, this.pending);
    if (this.stopped && this.pending <= this.low) {
      this.stopped = false;
      return 'resume';
    }
    return null;
  }
}
