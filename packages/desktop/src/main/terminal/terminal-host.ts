import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';
import { DomainError } from '@rauha/core';
import type { OpenResult, RunResult, TermEvent, TermRoot } from '../../shared/terminal-api.js';
import { parseInput } from '../../shared/terminal-line.js';
import { childEnv, resolveTarget, shellInvocation } from './shell-command.js';
import { Terminal } from './terminal.js';

/** 명령 하나의 출력 총량 상한(넘으면 멈춘다). 끝없이 쏟는 명령(yes 등)이 화면과 IPC를 막지 않게. */
export const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
/** 출력을 모아서 화면에 보내는 간격 */
const FLUSH_MS = 40;
/** 정중히(SIGTERM) 멈추고 이만큼 기다려도 안 끝나면 강제로 끝낸다 */
const KILL_AFTER_MS = 1500;
/** 한 번에 열어 둘 수 있는 터미널 수 */
export const MAX_TERMINALS = 8;

export interface StartRoot extends TermRoot {
  /** 실제 폴더(절대 경로) */
  readonly abs: string;
}

export interface TerminalHostDeps {
  readonly platform: NodeJS.Platform;
  readonly env: () => NodeJS.ProcessEnv;
  readonly home: string;
  /** 새 터미널을 시작할 수 있는 폴더들(작업 폴더와 그 아래 레포) */
  readonly roots: () => readonly StartRoot[];
  /** 화면에 보일 폴더 이름(작업 폴더 안이면 상대 경로) */
  readonly display: (abs: string) => string;
  /** 실행을 막을 까닭(비밀 파일을 건드리는 명령 등). 막지 않으면 null. */
  readonly guard: (command: string, cwd: string) => string | null;
  readonly emit: (event: TermEvent) => void;
}

interface Live {
  readonly terminal: Terminal;
  child: ChildProcess | null;
  stopping: boolean;
}

/**
 * 터미널 칸의 명령 실행. 명령 하나마다 사용자 셸을 새로 띄우고(진짜 PTY가 아니다), 폴더(cd)는 터미널이 기억한다.
 * 비밀 파일을 건드리는 명령은 guard가 막는다(편집기와 같은 규칙). 이 입력은 사용자가 직접 치는 것이라
 * AI 팀원의 도구 허락 흐름(ToolRisk)은 거치지 않는다.
 */
export class TerminalHost {
  private readonly live = new Map<string, Live>();

  constructor(private readonly deps: TerminalHostDeps) {}

  roots(): readonly TermRoot[] {
    return this.deps.roots().map((r) => ({ path: r.path, label: r.label }));
  }

  open(rootPath: string): OpenResult {
    if (this.live.size >= MAX_TERMINALS) return { ok: false, message: `Up to ${MAX_TERMINALS} terminals can be open.` };
    const root = this.deps.roots().find((r) => r.path === rootPath);
    if (root === undefined) return { ok: false, message: 'Outside the work folder: cannot open.' };
    const id = randomUUID();
    this.live.set(id, { terminal: Terminal.open(id, root.abs), child: null, stopping: false });
    return { ok: true, id, cwd: this.deps.display(root.abs), shell: shellInvocation(this.deps.platform, this.deps.env(), '').label };
  }

  async run(id: string, line: string): Promise<RunResult> {
    const live = this.live.get(id);
    if (live === undefined) return { ok: false, reason: 'unknown', message: 'That terminal is closed.' };
    // 돌고 있는 명령이 있으면 이 줄은 그 명령에게 보내는 입력이다
    if (live.terminal.isRunning()) {
      live.child?.stdin?.write(`${line}\n`);
      return { ok: true };
    }
    const input = parseInput(line);
    switch (input.kind) {
      case 'empty':
      case 'clear':
        return { ok: true };
      case 'cd':
        return this.changeDir(live, input.target);
      case 'cd-back':
        return this.changeDir(live, '-');
      case 'run':
        return this.start(live, input.command);
    }
  }

  async stop(id: string): Promise<void> {
    const live = this.live.get(id);
    if (live?.child === null || live === undefined) return;
    live.stopping = true;
    this.kill(live.child);
  }

  async close(id: string): Promise<void> {
    const live = this.live.get(id);
    if (live === undefined) return;
    this.live.delete(id);
    if (live.child !== null) this.kill(live.child);
  }

  /** 앱을 끌 때: 돌고 있는 명령을 모두 끝낸다(자식 프로세스를 남기지 않는다) */
  disposeAll(): void {
    for (const live of this.live.values()) if (live.child !== null) this.kill(live.child, true);
    this.live.clear();
  }

  private async changeDir(live: Live, target: string | null): Promise<RunResult> {
    const { terminal } = live;
    const next = resolveTarget(this.deps.platform, terminal.cwd, target, this.deps.home, terminal.previous);
    if (next === null) return { ok: false, reason: 'bad-dir', message: 'There is no previous folder.' };
    try {
      if (!(await stat(next)).isDirectory()) return { ok: false, reason: 'bad-dir', message: `Not a folder: ${next}` };
    } catch {
      return { ok: false, reason: 'bad-dir', message: `No such folder: ${next}` };
    }
    terminal.movedTo(next);
    this.deps.emit({ type: 'exit', id: terminal.id, code: 0, cwd: this.deps.display(next), note: null });
    return { ok: true };
  }

  private start(live: Live, command: string): RunResult {
    const { terminal } = live;
    const blocked = this.deps.guard(command, terminal.cwd);
    if (blocked !== null) return { ok: false, reason: 'blocked', message: blocked };
    try {
      terminal.started();
    } catch (e) {
      if (e instanceof DomainError) return { ok: false, reason: 'busy', message: e.message };
      throw e;
    }
    const sh = shellInvocation(this.deps.platform, this.deps.env(), command);
    let child: ChildProcess;
    try {
      child = spawn(sh.file, [...sh.args], { cwd: terminal.cwd, env: childEnv(this.deps.env()), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: this.deps.platform !== 'win32' });
    } catch (e) {
      terminal.finished();
      return { ok: false, reason: 'error', message: e instanceof Error ? e.message : 'Could not start the command.' };
    }
    live.child = child;
    live.stopping = false;
    this.deps.emit({ type: 'start', id: terminal.id });
    this.pump(live, child);
    return { ok: true };
  }

  /** 출력을 모아 40ms마다 한 번씩 화면에 보낸다. 총량이 상한을 넘으면 멈춘다. */
  private pump(live: Live, child: ChildProcess): void {
    const { terminal } = live;
    const decoders = [new StringDecoder('utf8'), new StringDecoder('utf8')];
    let pending = '';
    let total = 0;
    let tooMuch = false;
    let ended = false;
    const flush = (): void => {
      if (pending === '') return;
      this.deps.emit({ type: 'out', id: terminal.id, data: pending });
      pending = '';
    };
    const timer = setInterval(flush, FLUSH_MS);
    const take = (i: number) => (chunk: Buffer): void => {
      total += chunk.length;
      if (tooMuch) return;
      if (total > MAX_OUTPUT_BYTES) {
        tooMuch = true;
        this.kill(child);
        return;
      }
      pending += decoders[i]?.write(chunk) ?? '';
    };
    child.stdout?.on('data', take(0));
    child.stderr?.on('data', take(1));
    child.stdin?.on('error', () => undefined);
    const end = (code: number | null, note: string | null): void => {
      if (ended) return;
      ended = true;
      clearInterval(timer);
      pending += decoders.map((d) => d.end()).join('');
      flush();
      live.child = null;
      terminal.finished();
      const why = tooMuch ? 'Stopped: too much output.' : live.stopping ? 'Stopped.' : note;
      this.deps.emit({ type: 'exit', id: terminal.id, code, cwd: this.deps.display(terminal.cwd), note: why });
    };
    child.on('error', (e) => {
      pending += `${e.message}\n`;
      end(null, null);
    });
    child.on('close', (code) => end(code, null));
  }

  /** 명령과 그 자식들을 끝낸다. Windows는 taskkill /T, 그 밖은 프로세스 그룹에 신호를 보낸다. */
  private kill(child: ChildProcess, now = false): void {
    const pid = child.pid;
    if (pid === undefined) return;
    if (this.deps.platform === 'win32') {
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => undefined);
      return;
    }
    const signal = (s: NodeJS.Signals): void => {
      try {
        process.kill(-pid, s);
      } catch {
        try {
          child.kill(s);
        } catch {
          /* 이미 끝났다 */
        }
      }
    };
    signal(now ? 'SIGKILL' : 'SIGTERM');
    if (!now) setTimeout(() => (child.exitCode === null && child.signalCode === null ? signal('SIGKILL') : undefined), KILL_AFTER_MS).unref();
  }
}
