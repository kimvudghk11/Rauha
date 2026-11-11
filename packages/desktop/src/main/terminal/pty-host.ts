import { randomUUID } from 'node:crypto';
import { MAX_WRITE_CHARS, type OpenRequest, type OpenResult, type TermEvent, type TermRoot } from '../../shared/terminal-api.js';
import { OutputFlow } from '../../shared/pty-flow.js';
import { chooseShell, clampSize, isTermId, ptyEnv } from '../../shared/pty-shell.js';

/** 한 번에 열어 둘 수 있는 터미널 수 */
export const MAX_TERMINALS = 8;
/** 출력을 모아서 화면에 보내는 간격(ms) */
const FLUSH_MS = 8;
/** 화면으로 한 번에 보내는 출력 조각의 최대 글자 수 */
const MAX_CHUNK = 64 * 1024;

/** node-pty IPty 중 쓰는 부분만(시험에서는 가짜로 바꾼다) */
export interface PtyLike {
  readonly pid: number;
  onData(listener: (data: string) => void): unknown;
  onExit(listener: (event: { exitCode: number }) => void): unknown;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  pause(): void;
  resume(): void;
  kill(): void;
}

export interface StartRoot extends TermRoot {
  /** 실제 폴더(절대 경로) */
  readonly abs: string;
}

export interface SpawnOptions {
  readonly cwd: string;
  readonly env: Record<string, string>;
  readonly cols: number;
  readonly rows: number;
}

export interface PtyHostDeps {
  readonly platform: NodeJS.Platform;
  readonly env: () => NodeJS.ProcessEnv;
  /** 새 터미널을 시작할 수 있는 폴더들(작업 폴더와 그 아래 레포) */
  readonly roots: () => readonly StartRoot[];
  /** 화면에 보일 폴더 이름(작업 폴더 안이면 상대 경로) */
  readonly display: (abs: string) => string;
  readonly exists: (path: string) => boolean;
  readonly spawn: (file: string, args: readonly string[], options: SpawnOptions) => PtyLike;
  /** 셸과 그 자식들을 끝낸다 */
  readonly killTree: (pid: number) => void;
  readonly emit: (event: TermEvent) => void;
}

interface Live {
  readonly pty: PtyLike;
  readonly flow: OutputFlow;
  pending: string;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * 터미널 탭들의 PTY. 셸은 여기서만 정하고(화면은 폴더 목록 중 하나와 크기만 말한다), 출력은 잠깐 모아 조각내어 보내며,
 * 화면이 못 따라가면 PTY를 멈춘다. 이 입력은 사람이 직접 치는 것이라 AI 팀원의 허락 흐름은 거치지 않고,
 * AI 팀원이 이 터미널에 쓸 길은 없다.
 */
export class PtyHost {
  private readonly live = new Map<string, Live>();

  constructor(private readonly deps: PtyHostDeps) {}

  roots(): readonly TermRoot[] {
    return this.deps.roots().map((r) => ({ path: r.path, label: r.label }));
  }

  open(req: OpenRequest): OpenResult {
    if (this.live.size >= MAX_TERMINALS) return { ok: false, message: `Up to ${MAX_TERMINALS} terminals can be open.` };
    const root = this.deps.roots().find((r) => r.path === req.rootPath);
    if (root === undefined) return { ok: false, message: 'Outside the work folder: cannot open.' };
    const shell = chooseShell(this.deps.platform, this.deps.env(), this.deps.exists);
    const { cols, rows } = clampSize(req.cols, req.rows);
    let pty: PtyLike;
    try {
      pty = this.deps.spawn(shell.file, shell.args, { cwd: root.abs, env: ptyEnv(this.deps.env()), cols, rows });
    } catch (e) {
      return { ok: false, message: `Could not start the shell: ${e instanceof Error ? e.message : String(e)}` };
    }
    const id = randomUUID();
    const live: Live = { pty, flow: OutputFlow.create(), pending: '', timer: null };
    this.live.set(id, live);
    pty.onData((data) => {
      if (this.live.get(id) !== live) return;
      live.pending += data;
      if (live.timer === null) live.timer = setTimeout(() => this.flush(id, live), FLUSH_MS);
    });
    pty.onExit(({ exitCode }) => {
      if (this.live.get(id) !== live) return;
      this.flush(id, live);
      this.live.delete(id);
      this.deps.emit({ type: 'exit', id, code: Number.isInteger(exitCode) ? exitCode : null });
    });
    return { ok: true, id, shell: shell.label, cwd: this.deps.display(root.abs) };
  }

  write(id: string, data: string): void {
    if (data.length > MAX_WRITE_CHARS) return;
    this.get(id)?.pty.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    const size = clampSize(cols, rows);
    try {
      this.get(id)?.pty.resize(size.cols, size.rows);
    } catch {
      /* 이미 끝난 PTY의 크기 조절은 무시한다 */
    }
  }

  /** 화면이 n 글자를 그렸다. 멈춰 둔 PTY를 다시 읽게 한다. */
  ack(id: string, n: number): void {
    const live = this.get(id);
    if (live !== undefined && live.flow.acked(n) === 'resume') live.pty.resume();
  }

  close(id: string): void {
    const live = this.get(id);
    if (live === undefined) return;
    this.live.delete(id);
    if (live.timer !== null) clearTimeout(live.timer);
    this.deps.killTree(live.pty.pid);
    try {
      live.pty.kill();
    } catch {
      /* 이미 끝났다 */
    }
  }

  /** 열린 터미널을 전부 닫는다(앱 종료, 작업 폴더 변경, 화면 다시 열림) */
  disposeAll(): void {
    for (const id of [...this.live.keys()]) this.close(id);
  }

  private get(id: string): Live | undefined {
    return isTermId(id) ? this.live.get(id) : undefined;
  }

  private flush(id: string, live: Live): void {
    live.timer = null;
    while (live.pending !== '') {
      const chunk = live.pending.slice(0, MAX_CHUNK);
      live.pending = live.pending.slice(chunk.length);
      this.deps.emit({ type: 'data', id, data: chunk });
      if (live.flow.sent(chunk.length) === 'pause') live.pty.pause();
    }
  }
}
