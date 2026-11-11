import { basename, posix, win32 } from 'node:path';

export interface ShellChoice {
  readonly file: string;
  readonly args: readonly string[];
  /** 탭 이름에 보일 셸 이름 */
  readonly label: string;
}

/** 대화형 로그인 셸로 열어 줄 알려진 셸. 그 밖의 프로그램은 $SHELL이어도 쓰지 않는다. */
const LOGIN_SHELLS = new Set(['zsh', 'bash', 'fish', 'sh', 'dash', 'ksh', 'nu']);

const envGet = (env: NodeJS.ProcessEnv, name: string): string | undefined => {
  const hit = Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase());
  return hit === undefined ? undefined : env[hit];
};

/**
 * 새 터미널이 띄울 셸. 렌더러는 정할 수 없고 main이 여기서만 정한다.
 * - Windows: PATH의 pwsh(PowerShell 7) → Windows PowerShell → ComSpec(cmd). 프로필은 불러온다(VS Code처럼).
 * - 맥·리눅스: $SHELL(절대 경로이고 알려진 셸이고 실제로 있을 때) 로그인 셸(-l), 아니면 맥 /bin/zsh, 리눅스 /bin/bash.
 */
export function chooseShell(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, exists: (path: string) => boolean): ShellChoice {
  if (platform === 'win32') {
    const dirs = (envGet(env, 'Path') ?? '').split(';').filter((d) => d !== '');
    for (const dir of dirs) {
      const pwsh = win32.join(dir, 'pwsh.exe');
      if (exists(pwsh)) return { file: pwsh, args: ['-NoLogo'], label: 'pwsh' };
    }
    const root = envGet(env, 'SystemRoot') ?? 'C:\\Windows';
    const legacy = win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    if (exists(legacy)) return { file: legacy, args: ['-NoLogo'], label: 'powershell' };
    const cmd = envGet(env, 'ComSpec') ?? win32.join(root, 'System32', 'cmd.exe');
    return { file: cmd, args: [], label: 'cmd' };
  }
  const user = env['SHELL'];
  const name = user === undefined ? '' : basename(user).toLowerCase();
  if (user !== undefined && posix.isAbsolute(user) && LOGIN_SHELLS.has(name) && exists(user)) return { file: user, args: ['-l'], label: name };
  const fallback = platform === 'darwin' ? '/bin/zsh' : '/bin/bash';
  return { file: fallback, args: ['-l'], label: basename(fallback) };
}

/**
 * 셸이 받을 환경 변수. 사용자 환경은 그대로 두되 rauha 내부 값(RAUHA_*)과 Electron 값(ELECTRON_*)은 빼고,
 * 색·커서를 쓰는 프로그램이 알아보도록 TERM 등을 정한다.
 */
export function ptyEnv(base: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) continue;
    const upper = key.toUpperCase();
    if (upper.startsWith('RAUHA_') || upper.startsWith('ELECTRON_') || upper === 'NO_COLOR') continue;
    env[key] = value;
  }
  env['TERM'] = 'xterm-256color';
  env['COLORTERM'] = 'truecolor';
  env['TERM_PROGRAM'] = 'rauha';
  return env;
}

const TERM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** 터미널 id는 main이 만든 UUID 모양만 받는다 */
export const isTermId = (value: unknown): value is string => typeof value === 'string' && TERM_ID.test(value);

export const MAX_COLS = 500;
export const MAX_ROWS = 200;

/** 화면이 알려 준 크기를 정수·허용 범위로 맞춘다. 숫자가 아니면 80x24. */
export function clampSize(cols: number, rows: number): { cols: number; rows: number } {
  const fix = (n: number, max: number, fallback: number): number => (Number.isFinite(n) ? Math.min(max, Math.max(1, Math.floor(n))) : fallback);
  return { cols: fix(cols, MAX_COLS, 80), rows: fix(rows, MAX_ROWS, 24) };
}
