import { spawn, type ChildProcess } from 'node:child_process';
import { DB_LIMITS } from '../../shared/db-api.js';
import type { EngineRequest, EngineResponse } from './sqlite-engine.js';

/** 자식 프로세스 실행 결과. 쿼리가 끝났거나, 시간이 지났거나, 멈췄거나, 너무 많이 내보냈거나, 비정상으로 끝났다. */
export type RunOutcome =
  | { readonly kind: 'done'; readonly response: EngineResponse }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'too-large' }
  | { readonly kind: 'crashed'; readonly detail: string };

export interface EngineRunner {
  run(req: EngineRequest, o: { readonly timeoutMs: number; readonly key?: string | null }): Promise<RunOutcome>;
  /** 돌고 있는 실행 하나를 멈춘다(프로세스를 죽인다). 그런 실행이 없으면 false. */
  cancel(key: string): boolean;
  stopAll(): void;
}

export interface RunnerDeps {
  /** 실행 파일. Electron 에서는 process.execPath(ELECTRON_RUN_AS_NODE=1 로 Node 처럼 돈다) */
  readonly execPath: string;
  /** 자식이 실행할 코드(sqlite-child 를 묶은 것) */
  readonly childSource: () => string;
}

/** 자식 프로세스가 내보낼 수 있는 응답 크기 상한(결과 상한 + JSON 덧붙임). 넘으면 죽인다. */
const MAX_OUTPUT = DB_LIMITS.maxBytes * 4 + 2 * 1024 * 1024;
const MAX_STDERR = 8 * 1024;
/** 윈도우의 명령줄 상한(32767자)보다 한참 작게 */
const MAX_SOURCE = 24_000;

/** 자식에게 줄 환경: 실행에 꼭 필요한 것만(API 키·토큰 같은 환경 변수는 넘기지 않는다) */
function childEnv(): NodeJS.ProcessEnv {
  const keep = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'LANG', 'LC_ALL'];
  const env: NodeJS.ProcessEnv = {};
  for (const k of keep) {
    const v = process.env[k];
    if (v !== undefined) env[k] = v;
  }
  env['ELECTRON_RUN_AS_NODE'] = '1';
  return env;
}

/**
 * SQLite 는 쿼리 하나가 영원히 도는 것을 안에서 끊을 수단이 없다(재귀 CTE 같은). 그래서 요청마다 자식 프로세스를 하나 띄워
 * 시간이 지나면 프로세스째 죽인다. 요청은 표준 입력, 응답은 표준 출력(JSON 한 개)으로 주고받는다.
 */
export class ProcessRunner implements EngineRunner {
  private readonly live = new Map<string, { readonly child: ChildProcess; cancelled: boolean }>();
  private readonly all = new Set<ChildProcess>();

  constructor(private readonly deps: RunnerDeps) {}

  run(req: EngineRequest, o: { readonly timeoutMs: number; readonly key?: string | null }): Promise<RunOutcome> {
    const source = this.deps.childSource();
    if (source.length > MAX_SOURCE) return Promise.resolve({ kind: 'crashed', detail: 'The SQLite helper is too large to start.' });
    return new Promise<RunOutcome>((resolve) => {
      let settled = false;
      const child = spawn(this.deps.execPath, ['-e', source], { env: childEnv(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      const entry = { child, cancelled: false };
      this.all.add(child);
      if (o.key !== undefined && o.key !== null) this.live.set(o.key, entry);
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      let outSize = 0;
      let errSize = 0;
      let timedOut = false;
      let tooLarge = false;
      const finish = (outcome: RunOutcome): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.all.delete(child);
        if (o.key !== undefined && o.key !== null && this.live.get(o.key) === entry) this.live.delete(o.key);
        resolve(outcome);
      };
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, o.timeoutMs);
      child.stdout?.on('data', (c: Buffer) => {
        outSize += c.length;
        if (outSize > MAX_OUTPUT) {
          tooLarge = true;
          child.kill('SIGKILL');
          return;
        }
        out.push(c);
      });
      child.stderr?.on('data', (c: Buffer) => {
        if (errSize < MAX_STDERR) {
          err.push(c);
          errSize += c.length;
        }
      });
      child.on('error', (e) => finish({ kind: 'crashed', detail: e.message }));
      child.on('close', (code) => {
        if (entry.cancelled) return finish({ kind: 'cancelled' });
        if (timedOut) return finish({ kind: 'timeout' });
        if (tooLarge) return finish({ kind: 'too-large' });
        const text = Buffer.concat(out).toString('utf8');
        try {
          finish({ kind: 'done', response: JSON.parse(text) as EngineResponse });
        } catch {
          finish({ kind: 'crashed', detail: `The SQLite helper stopped (exit ${code ?? '?'}). ${Buffer.concat(err).toString('utf8').slice(0, 300)}`.trim() });
        }
      });
      child.stdin?.on('error', () => undefined);
      child.stdin?.end(JSON.stringify(req));
    });
  }

  cancel(key: string): boolean {
    const entry = this.live.get(key);
    if (entry === undefined) return false;
    entry.cancelled = true;
    entry.child.kill('SIGKILL');
    return true;
  }

  stopAll(): void {
    for (const child of this.all) child.kill('SIGKILL');
  }
}
