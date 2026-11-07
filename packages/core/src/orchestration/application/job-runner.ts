import { Job } from '../domain/job.js';
import type { MemberRole } from '../domain/member-role.js';
import { JobBoard } from '../domain/job-board.js';

/** 일하는 쪽이 작업판에 알리는 길 */
export interface JobReport {
  /** 진행 한 줄. role은 그 팀원이 일을 시작했다는 알림일 때만 */
  note(role: MemberRole | null, message: string): void;
  /** 사용자의 허락·선택을 기다리는 중이면 true, 다시 일하면 false */
  waiting(on: boolean): void;
  /** 팀이 돌려준 결과 글 */
  result(text: string): void;
}

/** 작업 하나를 실제로 하는 일. 끝나면 resolve, 실패하면 reject. signal이 꺼지면 바로 그만둔다. */
export type JobWork = (job: Job, signal: AbortSignal, report: JobReport) => Promise<void>;

export interface JobRunnerDeps {
  readonly work: JobWork;
  readonly newId: () => string;
  /** ISO 시각 */
  readonly now: () => string;
  readonly limit?: number;
  /** 판이 바뀔 때마다(넣기·시작·끝·멈춤) 부른다. 화면이 다시 그린다. */
  readonly onChange?: (board: JobBoard) => void;
}

const STOPPED_BY_USER = '사용자가 멈춤';

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * 메인이 넘긴 일을 돌린다. submit은 일이 끝나기를 기다리지 않고 바로 돌아온다(메인이 막히지 않는다).
 * 몇 개를 함께 돌릴지, 다음에 무엇을 시작할지는 작업판(JobBoard)이 정한다.
 */
export class JobRunner {
  private current: JobBoard;
  private readonly controllers = new Map<string, AbortController>();
  private readonly inFlight = new Set<Promise<void>>();

  private constructor(private readonly deps: JobRunnerDeps) {
    this.current = JobBoard.empty(deps.limit);
  }

  static start(deps: JobRunnerDeps): JobRunner {
    return new JobRunner(deps);
  }

  get board(): JobBoard {
    return this.current;
  }

  submit(request: string): Job | null {
    const job = Job.queue({ id: this.deps.newId(), request, at: this.deps.now() });
    if (job === null) return null;
    this.current = this.current.add(job);
    this.pump();
    this.changed();
    return this.current.find(job.id);
  }

  /** 대기·진행·기다림 중인 일을 멈춘다. 끝난 일이나 없는 일은 그대로 둔다. */
  stop(id: string): void {
    const job = this.current.find(id);
    if (job === null) return;
    const stopped = job.stop(STOPPED_BY_USER, this.deps.now());
    if (stopped === job) return;
    this.controllers.get(id)?.abort();
    this.controllers.delete(id);
    this.current = this.current.replace(stopped);
    this.pump();
    this.changed();
  }

  /** 지금 도는 일과 그 뒤에 이어 시작되는 일까지 모두 끝날 때까지 기다린다. */
  async idle(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.allSettled([...this.inFlight]);
  }

  private pump(): void {
    for (const job of this.current.startable()) {
      const running = job.start();
      this.current = this.current.replace(running);
      const controller = new AbortController();
      this.controllers.set(job.id, controller);
      const done = this.call(running, controller.signal).then(
        () => this.settle(job.id, (j) => j.finish(this.deps.now())),
        (error: unknown) => this.settle(job.id, (j) => j.stop(reasonOf(error), this.deps.now())),
      );
      this.inFlight.add(done);
      void done.finally(() => this.inFlight.delete(done));
    }
  }

  /** work가 Promise를 돌려주기 전에 바로 던져도 실패로 받는다. */
  private call(job: Job, signal: AbortSignal): Promise<void> {
    try {
      return this.deps.work(job, signal, this.reportFor(job.id));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  private reportFor(id: string): JobReport {
    return {
      note: (role, message) => this.update(id, (j) => j.noted(role, message, this.deps.now())),
      waiting: (on) => this.update(id, (j) => (on ? (j.status === 'running' ? j.wait() : j) : j.status === 'waiting' ? j.resume() : j)),
      result: (text) => this.update(id, (j) => j.withResult(text)),
    };
  }

  private update(id: string, change: (job: Job) => Job): void {
    const job = this.current.find(id);
    if (job === null) return;
    const next = change(job);
    if (next === job) return;
    this.current = this.current.replace(next);
    this.changed();
  }

  private settle(id: string, end: (job: Job) => Job): void {
    const job = this.current.find(id);
    if (job === null) return;
    this.controllers.delete(id);
    const ended = end(job);
    if (ended === job) return;
    this.current = this.current.replace(ended);
    this.pump();
    this.changed();
  }

  private changed(): void {
    this.deps.onChange?.(this.current);
  }
}
