import { Worker } from 'node:worker_threads';
import type { LineHit } from '../../shared/text-search.js';
import { scanFiles, type ScanJob, type ScanMessage } from './search-scan.js';

/** 끝난 까닭. null 이면 끝까지 훑었다. */
export type StopReason = 'limit' | 'timeout' | 'cancelled' | 'stalled';

export interface RunOutcome {
  readonly files: { readonly path: string; readonly hits: readonly LineHit[] }[];
  readonly scanned: number;
  readonly skipped: number;
  readonly stopped: StopReason | null;
}

export interface SearchRunner {
  run(key: string, job: ScanJob): Promise<RunOutcome>;
  /** 돌고 있는 검색을 멈춘다. 그런 검색이 없으면 false */
  cancel(key: string): boolean;
}

/** 검색 하나의 전체 시간 상한 */
export const SEARCH_DEADLINE_MS = 10_000;
/** 일꾼이 이 시간 동안 아무 소식도 없으면 정규식이 멈춘 것으로 보고 끊는다 */
export const SEARCH_STALL_MS = 2500;
/** 동시에 돌 수 있는 검색 수. 넘으면 가장 오래된 것을 멈춘다. */
const MAX_LIVE = 2;

interface Live {
  readonly stop: (why: StopReason) => void;
}

/**
 * 전체 찾기를 worker 스레드에서 돌린다. 사용자가 쓴 정규식은 끝나지 않을 수 있어서(ReDoS) main 에서는 절대 돌리지 않고,
 * 전체 시간 상한과 "소식 끊김" 상한을 넘으면 worker 를 terminate 한다. 그때까지 모은 결과는 돌려준다.
 */
export class WorkerSearchRunner implements SearchRunner {
  private readonly live = new Map<string, Live>();

  /** @param source worker 가 실행할 코드(search-worker 를 CJS 로 묶은 것) */
  constructor(
    private readonly source: () => string,
    private readonly limits: { readonly deadlineMs: number; readonly stallMs: number } = { deadlineMs: SEARCH_DEADLINE_MS, stallMs: SEARCH_STALL_MS },
  ) {}

  run(key: string, job: ScanJob): Promise<RunOutcome> {
    this.live.get(key)?.stop('cancelled');
    while (this.live.size >= MAX_LIVE) {
      const oldest = this.live.keys().next();
      if (oldest.done === true) break;
      this.live.get(oldest.value)?.stop('cancelled');
      this.live.delete(oldest.value);
    }
    return new Promise<RunOutcome>((resolve) => {
      const files: RunOutcome['files'] = [];
      let scanned = 0;
      let skipped = 0;
      let settled = false;
      let worker: Worker | null = null;
      let stallTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = (stopped: StopReason | null): void => {
        if (settled) return;
        settled = true;
        clearTimeout(stallTimer);
        clearTimeout(deadlineTimer);
        if (this.live.get(key) === entry) this.live.delete(key);
        void worker?.terminate();
        resolve({ files, scanned, skipped, stopped });
      };
      const entry: Live = { stop: finish };
      const deadlineTimer = setTimeout(() => finish('timeout'), this.limits.deadlineMs);
      const armStall = (): void => {
        clearTimeout(stallTimer);
        stallTimer = setTimeout(() => finish('stalled'), this.limits.stallMs);
      };
      this.live.set(key, entry);
      try {
        worker = new Worker(this.source(), { eval: true, workerData: job, env: {}, resourceLimits: { maxOldGenerationSizeMb: 256 } });
      } catch {
        finish('stalled');
        return;
      }
      armStall();
      worker.on('message', (m: ScanMessage) => {
        armStall();
        if (m.t === 'file') files.push({ path: m.path, hits: m.hits });
        else if (m.t === 'beat') scanned = m.scanned;
        else {
          scanned = m.scanned;
          skipped = m.skipped;
          finish(m.limited ? 'limit' : null);
        }
      });
      worker.on('error', () => finish('stalled'));
      worker.on('exit', () => finish(null));
    });
  }

  cancel(key: string): boolean {
    const entry = this.live.get(key);
    if (entry === undefined) return false;
    entry.stop('cancelled');
    return true;
  }
}

/**
 * worker 코드가 없을 때(단위 시험·묶지 않은 개발 실행) 쓰는 대체 실행기. main 스레드에서 돌아 정규식 보호가 없으므로
 * 전체 시간 상한만 건다. 실제 앱 빌드에서는 쓰지 않는다.
 */
export class InlineSearchRunner implements SearchRunner {
  private readonly cancelled = new Set<string>();

  async run(key: string, job: ScanJob): Promise<RunOutcome> {
    const files: RunOutcome['files'] = [];
    let scanned = 0;
    let skipped = 0;
    let limited = false;
    const deadline = Date.now() + SEARCH_DEADLINE_MS;
    let stopped: StopReason | null = null;
    await scanFiles(
      job,
      (m) => {
        if (m.t === 'file') files.push({ path: m.path, hits: m.hits });
        else if (m.t === 'done') {
          scanned = m.scanned;
          skipped = m.skipped;
          limited = m.limited;
        }
      },
      () => {
        if (this.cancelled.has(key)) stopped = 'cancelled';
        else if (Date.now() > deadline) stopped = 'timeout';
        return stopped !== null;
      },
    );
    this.cancelled.delete(key);
    return { files, scanned, skipped, stopped: stopped ?? (limited ? 'limit' : null) };
  }

  cancel(key: string): boolean {
    this.cancelled.add(key);
    return true;
  }
}
