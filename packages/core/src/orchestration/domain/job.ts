/** 작업 상태. waiting은 진행 중에 사용자의 허락·선택을 기다리는 상태다(자리는 그대로 차지한다). */
export type JobStatus = 'queued' | 'running' | 'waiting' | 'done' | 'stopped';

interface JobState {
  readonly id: string;
  readonly request: string;
  readonly status: JobStatus;
  /** ISO 시각 */
  readonly queuedAt: string;
  readonly endedAt: string | null;
  readonly stopReason: string | null;
}

/**
 * 메인(Delfi)이 팀에 넘긴 일 하나. 메인은 일을 넘기면 바로 다음 입력을 받고, 일은 각자 돈다.
 * 값은 불변이다. 상태를 바꾸는 메서드는 새 작업을 돌려준다.
 */
export class Job {
  private constructor(private readonly state: JobState) {}

  /** 빈 요청(공백만 있는 요청 포함)은 작업이 되지 않는다. */
  static queue(p: { id: string; request: string; at: string }): Job | null {
    const request = p.request.trim();
    if (request === '') return null;
    return new Job({ id: p.id, request, status: 'queued', queuedAt: p.at, endedAt: null, stopReason: null });
  }

  get id(): string {
    return this.state.id;
  }

  get request(): string {
    return this.state.request;
  }

  get status(): JobStatus {
    return this.state.status;
  }

  get queuedAt(): string {
    return this.state.queuedAt;
  }

  get endedAt(): string | null {
    return this.state.endedAt;
  }

  get stopReason(): string | null {
    return this.state.stopReason;
  }

  /** 진행과 기다림은 동시 실행 자리를 차지한다. 기다리던 일이 다시 진행할 자리를 남겨 둔다. */
  get holdsSlot(): boolean {
    return this.state.status === 'running' || this.state.status === 'waiting';
  }

  get isOver(): boolean {
    return this.state.status === 'done' || this.state.status === 'stopped';
  }

  start(): Job {
    return this.move('queued', 'running', '대기 중인 작업만 시작할 수 있다');
  }

  wait(): Job {
    return this.move('running', 'waiting', '진행 중인 작업만 기다릴 수 있다');
  }

  resume(): Job {
    return this.move('waiting', 'running', '기다리는 작업만 다시 진행할 수 있다');
  }

  /** 이미 끝났거나 멈춘 작업은 그대로 둔다. */
  finish(at: string): Job {
    if (this.isOver) return this;
    return new Job({ ...this.state, status: 'done', endedAt: at });
  }

  /** 대기·진행·기다림 어느 때든 멈출 수 있다. 이미 끝났거나 멈춘 작업은 그대로 둔다. */
  stop(reason: string, at: string): Job {
    if (this.isOver) return this;
    return new Job({ ...this.state, status: 'stopped', endedAt: at, stopReason: reason });
  }

  private move(from: JobStatus, to: JobStatus, message: string): Job {
    if (this.state.status !== from) throw new Error(`${message} (지금: ${this.state.status})`);
    return new Job({ ...this.state, status: to });
  }
}
