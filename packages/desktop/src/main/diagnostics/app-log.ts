import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { LogRing, LOG_FILE_MAX_BYTES, LOG_RING_MAX, logLinesOf, type Redactor } from '../../shared/diagnostics.js';

export interface AppLogDeps {
  /** 로그 폴더(userData/logs) */
  readonly dir: string;
  readonly now: () => Date;
  readonly redactor: Redactor;
  readonly maxBytes?: number;
}

/**
 * 앱 오류 로그. main의 처리 안 된 오류·renderer 콘솔 error를 가린 채 최근 200줄 메모리 링 버퍼에 쌓고,
 * 같은 줄을 app.log에 이어 쓴다(1MB를 넘으면 app.log.1로 돌려 쓴다). 파일에 못 써도 던지지 않는다.
 * 켤 때 지난번 파일의 끝 줄을 이어받아, 지난번에 죽은 이유도 진단에 남는다.
 */
export class AppLog {
  private readonly ring = new LogRing();
  private readonly file: string;
  private readonly maxBytes: number;

  constructor(private readonly deps: AppLogDeps) {
    this.file = join(deps.dir, 'app.log');
    this.maxBytes = deps.maxBytes ?? LOG_FILE_MAX_BYTES;
    this.inherit();
  }

  /** 오류 한 건을 가려서 쌓는다. */
  record(source: string, message: string): void {
    const clean = this.deps.redactor.text(message);
    const lines = logLinesOf(this.deps.now().toISOString(), source, clean);
    for (const line of lines) this.ring.push(line);
    this.append(lines);
  }

  lines(): readonly string[] {
    return this.ring.all();
  }

  private inherit(): void {
    try {
      const text = readFileSync(this.file, 'utf8');
      for (const line of text.split(/\r?\n/).filter((l) => l !== '').slice(-LOG_RING_MAX)) this.ring.push(this.deps.redactor.text(line));
    } catch {
      /* 지난 파일이 없거나 못 읽어도 새로 시작한다 */
    }
  }

  private append(lines: readonly string[]): void {
    try {
      mkdirSync(this.deps.dir, { recursive: true });
      if (existsSync(this.file) && statSync(this.file).size > this.maxBytes) this.rotate();
      appendFileSync(this.file, `${lines.join('\n')}\n`);
    } catch {
      /* 로그를 못 써도 앱은 계속 돈다 */
    }
  }

  private rotate(): void {
    const old = `${this.file}.1`;
    try {
      unlinkSync(old);
    } catch {
      /* 이전 돌린 파일이 없을 수 있다 */
    }
    renameSync(this.file, old);
  }
}
