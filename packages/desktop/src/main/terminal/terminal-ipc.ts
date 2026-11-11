import { execFile } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { relative } from 'node:path';
import type { IpcMain } from 'electron';
import { discoverRepos } from '@rauha/core';
import { TERM_IPC, type OpenResult, type TermEvent } from '../../shared/terminal-api.js';
import { isTermId } from '../../shared/pty-shell.js';
import { isInside } from '../code/code-path.js';
import { PtyHost, type PtyLike, type StartRoot } from './pty-host.js';

export interface TerminalIpcDeps {
  readonly workFolder: () => string | null;
  readonly send: (channel: string, event: TermEvent) => void;
}

const slash = (p: string): string => p.split(/[\/]+/).join('/');
/** 정중히 끝내고(SIGHUP) 이만큼 기다려도 남아 있으면 강제로 끝낸다 */
const KILL_AFTER_MS = 1500;

/** 셸과 그 자식 프로세스들을 끝낸다. Windows는 taskkill /T, 그 밖은 프로세스 그룹(PTY의 셸은 세션 리더다)에 신호를 보낸다. */
function killTree(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (process.platform === 'win32') {
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => undefined);
    return;
  }
  const signal = (s: NodeJS.Signals): void => {
    try {
      process.kill(-pid, s);
    } catch {
      /* 이미 끝났다 */
    }
  };
  signal('SIGHUP');
  setTimeout(() => signal('SIGKILL'), KILL_AFTER_MS).unref();
}

type PtyModule = typeof import('@lydell/node-pty');
let loaded: PtyModule | string | null = null;

/** 네이티브 PTY 모듈은 처음 터미널을 열 때 불러온다(못 불러와도 앱의 다른 부분은 멀쩡하다). */
async function loadPty(): Promise<PtyModule | string> {
  if (loaded !== null) return loaded;
  try {
    loaded = await import('@lydell/node-pty');
  } catch (e) {
    loaded = `The terminal engine could not be loaded: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`;
  }
  return loaded;
}

/**
 * 터미널 IPC. 새 터미널은 작업 폴더나 그 아래 레포에서만 시작하고, 어떤 셸을 쓸지는 main이 정한다(화면은 폴더 목록 중 하나와 크기만 보낸다).
 * 모든 채널은 앱의 ipc-guard(믿는 화면에서 온 호출만)를 거친다. id는 UUID 모양만 받는다.
 */
export function registerTerminalIpc(ipc: Pick<IpcMain, 'handle'>, deps: TerminalIpcDeps): PtyHost {
  const real = (p: string): string => {
    try {
      return realpathSync.native(p);
    } catch {
      return p;
    }
  };
  const roots = (): StartRoot[] => {
    const work = deps.workFolder();
    if (work === null) return [];
    const workReal = real(work);
    const list: StartRoot[] = [{ path: '', label: 'Work folder', abs: workReal }];
    for (const repo of discoverRepos(work)) {
      const abs = real(repo);
      const rel = slash(relative(workReal, abs));
      if (rel !== '' && !rel.startsWith('..')) list.push({ path: rel, label: rel, abs });
    }
    return list;
  };
  let pty: PtyModule | null = null;
  const host = new PtyHost({
    platform: process.platform,
    env: () => process.env,
    roots,
    display: (abs) => {
      const work = deps.workFolder();
      if (work === null) return abs;
      const workReal = real(work);
      if (!isInside(workReal, abs, process.platform === 'win32')) return abs;
      return slash(relative(workReal, abs)) || 'Work folder';
    },
    exists: (p) => existsSync(p),
    spawn: (file, args, options) => {
      if (pty === null) throw new Error('The terminal engine is not loaded.');
      return pty.spawn(file, [...args], { name: 'xterm-256color', cols: options.cols, rows: options.rows, cwd: options.cwd, env: options.env }) as PtyLike;
    },
    killTree,
    emit: (event) => deps.send(TERM_IPC.event, event),
  });
  const num = (v: unknown): number => (typeof v === 'number' ? v : Number.NaN);
  ipc.handle(TERM_IPC.roots, () => host.roots());
  ipc.handle(TERM_IPC.open, async (_e, req: unknown): Promise<OpenResult> => {
    const r = typeof req === 'object' && req !== null ? (req as Record<string, unknown>) : {};
    if (typeof r['rootPath'] !== 'string') return { ok: false, message: 'Invalid request.' };
    const mod = await loadPty();
    if (typeof mod === 'string') return { ok: false, message: mod };
    pty = mod;
    return host.open({ rootPath: r['rootPath'], cols: num(r['cols']), rows: num(r['rows']) });
  });
  ipc.handle(TERM_IPC.write, (_e, id: unknown, data: unknown) => {
    if (isTermId(id) && typeof data === 'string') host.write(id, data);
  });
  ipc.handle(TERM_IPC.resize, (_e, id: unknown, cols: unknown, rows: unknown) => {
    if (isTermId(id)) host.resize(id, num(cols), num(rows));
  });
  ipc.handle(TERM_IPC.ack, (_e, id: unknown, n: unknown) => {
    if (isTermId(id)) host.ack(id, num(n));
  });
  ipc.handle(TERM_IPC.close, (_e, id: unknown) => {
    if (isTermId(id)) host.close(id);
  });
  ipc.handle(TERM_IPC.closeAll, () => host.disposeAll());
  return host;
}
