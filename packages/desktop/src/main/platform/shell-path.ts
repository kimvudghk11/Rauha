import { execFile } from 'node:child_process';
import { delimiter } from 'node:path';

/** 로그인 셸이 PATH를 돌려줄 때 앞뒤에 찍는 표시. rc 파일이 다른 글을 출력해도 PATH만 골라 읽으려고 쓴다. */
export const PATH_MARK = '__RAUHA_PATH__';

/** 로그인 셸에서 PATH를 읽는 명령 인자. zsh·bash 모두 -ilc(로그인+대화형+명령)로 rc 파일을 읽게 한다. */
export function loginShellArgs(): string[] {
  return ['-ilc', `printf '%s%s%s' '${PATH_MARK}' "$PATH" '${PATH_MARK}'`];
}

/** 셸 출력에서 표시 사이의 PATH만 꺼낸다. 표시가 없거나 비었으면 null. */
export function parseShellPath(output: string): string | null {
  const start = output.indexOf(PATH_MARK);
  if (start < 0) return null;
  const end = output.indexOf(PATH_MARK, start + PATH_MARK.length);
  if (end < 0) return null;
  const value = output.slice(start + PATH_MARK.length, end).trim();
  return value === '' ? null : value;
}

/**
 * 지금 PATH에 셸 PATH를 합친다. 셸 쪽 순서를 앞에 두고(brew 등이 먼저 보이게) 겹치는 폴더는 한 번만 둔다.
 * 지금 PATH에만 있던 폴더는 뒤에 남는다. 셸 PATH가 없으면 지금 PATH 그대로다.
 */
export function mergePath(current: string, fromShell: string | null, separator: string = delimiter, fallback: readonly string[] = []): string {
  if (fromShell === null && fallback.length === 0) return current;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const dir of [...(fromShell === null ? [] : fromShell.split(separator)), ...current.split(separator), ...fallback]) {
    if (dir === '' || seen.has(dir)) continue;
    seen.add(dir);
    out.push(dir);
  }
  return out.join(separator);
}

/** 로그인 셸을 못 읽었을 때도 도구(brew의 aws·gh·node)를 찾도록 PATH 뒤에 붙여 두는 맥의 흔한 폴더 */
export const fallbackDirs = (platform: NodeJS.Platform): readonly string[] => (platform === 'darwin' ? ['/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin'] : []);

/** 셸 PATH를 읽어야 하는 플랫폼인가. Windows는 앱이 이미 사용자 PATH를 받는다. */
export const needsShellPath = (platform: NodeJS.Platform): boolean => platform === 'darwin' || platform === 'linux';

/**
 * Finder·Dock으로 연 앱은 셸의 PATH를 못 받는다. 시작할 때 로그인 셸에서 PATH를 읽어 process.env.PATH에 합친다.
 * 시간 제한 안에 못 읽거나 실패하면 지금 PATH를 그대로 둔다. Windows에서는 아무것도 하지 않는다.
 */
export async function adoptShellPath(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, timeoutMs = 4000): Promise<void> {
  if (!needsShellPath(platform)) return;
  const shell = env['SHELL'] ?? (platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
  const out = await new Promise<string>((resolve) => {
    try {
      execFile(shell, loginShellArgs(), { timeout: timeoutMs, windowsHide: true }, (_error, stdout) => resolve(String(stdout ?? '')));
    } catch {
      resolve('');
    }
  });
  env['PATH'] = mergePath(env['PATH'] ?? '', parseShellPath(out), delimiter, fallbackDirs(platform));
}
