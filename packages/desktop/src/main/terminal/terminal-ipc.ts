import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { relative } from 'node:path';
import type { IpcMain } from 'electron';
import { discoverRepos } from '@rauha/core';
import { TERM_IPC, type TermEvent } from '../../shared/terminal-api.js';
import { isInside } from '../code/code-path.js';
import type { SecretSource } from '../code/secret-cache.js';
import { TerminalHost, type StartRoot } from './terminal-host.js';

export interface TerminalIpcDeps {
  readonly workFolder: () => string | null;
  readonly secrets: SecretSource;
  readonly send: (channel: string, event: TermEvent) => void;
}

const slash = (p: string): string => p.split(/[\/]+/).join('/');

/**
 * 터미널 IPC. 새 터미널은 작업 폴더나 그 아래 레포에서만 시작하고, 비밀 파일을 건드리는 명령은 편집기와 같은 규칙(core SecretPolicy)으로 막는다.
 * 팀원(AI)이 이 입력창에 쓸 길은 없다. 화면에서 사람이 치는 줄만 들어온다.
 */
export function registerTerminalIpc(ipc: Pick<IpcMain, 'handle'>, deps: TerminalIpcDeps): TerminalHost {
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
  const host = new TerminalHost({
    platform: process.platform,
    env: () => process.env,
    home: homedir(),
    roots,
    display: (abs) => {
      const work = deps.workFolder();
      if (work === null) return abs;
      const workReal = real(work);
      if (!isInside(workReal, abs, process.platform === 'win32')) return abs;
      return slash(relative(workReal, abs)) || 'Work folder';
    },
    guard: (command) => {
      const work = deps.workFolder();
      const policy = deps.secrets.policy();
      if (work === null || policy === null) return null;
      const hit = policy.secretIn(command, { root: work, secretFiles: deps.secrets.files() });
      return hit === null ? null : `Commands that touch secret files (${hit}) are not run here. If you really need it, run it in a terminal you open yourself.`;
    },
    emit: (event) => deps.send(TERM_IPC.event, event),
  });
  ipc.handle(TERM_IPC.roots, () => host.roots());
  ipc.handle(TERM_IPC.open, (_e, path: unknown) => (typeof path === 'string' ? host.open(path) : { ok: false, message: 'Invalid request.' }));
  ipc.handle(TERM_IPC.run, (_e, id: unknown, line: unknown) =>
    typeof id === 'string' && typeof line === 'string' && line.length <= 8000 ? host.run(id, line) : { ok: false, reason: 'error', message: 'Invalid input.' },
  );
  ipc.handle(TERM_IPC.stop, (_e, id: unknown) => (typeof id === 'string' ? host.stop(id) : undefined));
  ipc.handle(TERM_IPC.close, (_e, id: unknown) => (typeof id === 'string' ? host.close(id) : undefined));
  return host;
}
