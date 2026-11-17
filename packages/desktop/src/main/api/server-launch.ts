import { execFile, spawn } from 'node:child_process';
import type { ServerLaunch } from '../../shared/api-auto.js';
import type { StartedServer } from './auto-api-check.js';

const LOG_LINES = 20;
const POLL_MS = 1_500;

/** 프로세스와 그 자식까지 끈다(개발 서버는 watch·자식 프로세스를 띄운다) */
function killTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    if (process.platform === 'win32') execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve());
    else {
      try {
        process.kill(-pid, 'SIGTERM');
      } catch {
        /* 이미 끝났다 */
      }
      resolve();
    }
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 허락받은 명령으로 서버를 띄우고 baseUrl 이 들을 때까지 기다린다. 못 띄우면(먼저 끝남·시간 초과) 끄고 이유 글을 돌려준다.
 * local: 명령 프로세스를 띄우고 끝낼 때 프로세스 묶음을 끈다. compose: up -d 가 끝나길 기다리고 끝낼 때 stop(지우지 않는다).
 */
export async function launchServer(root: string, how: ServerLaunch, baseUrl: string, probe: (url: string) => Promise<string | null>, timeoutMs = 120_000): Promise<StartedServer | string> {
  const log: string[] = [];
  const keep = (chunk: Buffer): void => {
    for (const line of chunk.toString('utf8').split(/\r?\n/)) if (line.trim() !== '') log.push(line.trim().slice(0, 300));
    while (log.length > LOG_LINES) log.shift();
  };
  const lastLine = (): string => (log.length > 0 ? ` 마지막 출력: ${log[log.length - 1]}` : '');

  if (how.kind === 'compose') {
    const code = await new Promise<number>((resolve) => {
      const child = spawn(how.command, { cwd: root, shell: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.on('data', keep);
      child.stderr.on('data', keep);
      child.on('error', () => resolve(-1));
      child.on('exit', (c) => resolve(c ?? -1));
    });
    const stop = async (): Promise<void> => {
      if (how.stop !== null) await new Promise<void>((resolve) => spawn(how.stop!, { cwd: root, shell: true, windowsHide: true, stdio: 'ignore' }).on('exit', () => resolve()).on('error', () => resolve()));
    };
    if (code !== 0) return `docker compose 가 실패했어요(종료 코드 ${code}).${lastLine()}`;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if ((await probe(baseUrl)) === null) return { stop };
      await sleep(POLL_MS);
    }
    await stop();
    return `${Math.round(timeoutMs / 1000)}초 안에 ${baseUrl} 가 응답하지 않았어요.${lastLine()}`;
  }

  const child = spawn(how.command, { cwd: root, shell: true, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, BROWSER: 'none' } });
  child.stdout?.on('data', keep);
  child.stderr?.on('data', keep);
  let exited: number | null = null;
  child.on('exit', (c) => (exited = c ?? -1));
  child.on('error', () => (exited = -1));
  const stop = async (): Promise<void> => {
    if (child.pid !== undefined && exited === null) await killTree(child.pid);
  };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exited !== null) return `서버 명령이 먼저 끝났어요(종료 코드 ${exited}).${lastLine()}`;
    if ((await probe(baseUrl)) === null) return { stop };
    await sleep(POLL_MS);
  }
  await stop();
  return `${Math.round(timeoutMs / 1000)}초 안에 ${baseUrl} 가 응답하지 않았어요.${lastLine()}`;
}
