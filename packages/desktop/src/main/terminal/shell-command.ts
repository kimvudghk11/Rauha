import { basename, posix, win32 } from 'node:path';

export interface ShellInvocation {
  readonly file: string;
  readonly args: readonly string[];
  /** 사람이 읽는 셸 이름(화면 안내용) */
  readonly label: string;
}

/** 명령을 `-c`로 받아 돌릴 수 있는 셸. 그 밖(fish·nu 등)은 문법이 달라 쓰지 않는다. */
const POSIX_SHELLS = new Set(['zsh', 'bash', 'sh', 'dash', 'ksh']);

/**
 * 한 줄 명령을 돌릴 셸 실행 방법.
 * - macOS·Linux: 사용자 셸($SHELL)이 zsh·bash 같은 것이면 그걸로, 아니면 macOS는 /bin/zsh, Linux는 /bin/bash. `-c 명령`.
 *   로그인 셸 PATH는 앱이 시작할 때 이미 process.env.PATH에 합쳐 두었다(adoptShellPath).
 * - Windows: PowerShell. 따옴표 문제를 피하려고 명령을 UTF-16LE base64로 넘기고(-EncodedCommand),
 *   출력은 UTF-8로 맞추며, 마지막 명령의 성공/실패가 종료 코드가 되게 한다.
 */
export function shellInvocation(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, command: string): ShellInvocation {
  if (platform === 'win32') {
    const script = `$ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $OutputEncoding=[System.Text.Encoding]::UTF8; ${command}\nif ($?) { exit 0 } elseif ($LASTEXITCODE) { exit $LASTEXITCODE } else { exit 1 }`;
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    return { file: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-EncodedCommand', encoded], label: 'PowerShell' };
  }
  const user = env['SHELL'];
  const name = user === undefined ? '' : basename(user).toLowerCase();
  const file = user !== undefined && posix.isAbsolute(user) && POSIX_SHELLS.has(name) ? user : platform === 'darwin' ? '/bin/zsh' : '/bin/bash';
  return { file, args: ['-c', command], label: basename(file) };
}

/**
 * 명령이 받을 환경 변수. 색·페이저·비밀번호 창처럼 터미널이 없으면 멈추는 것을 끈다.
 * ELECTRON_RUN_AS_NODE는 빼서 자식이 Electron을 노드로 오해하지 않게 한다.
 */
export function childEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, TERM: 'dumb', NO_COLOR: '1', GIT_PAGER: 'cat', PAGER: 'cat', GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true' };
  delete env['ELECTRON_RUN_AS_NODE'];
  return env;
}

/**
 * cd 대상을 절대 경로로 바꾼다. `~`는 홈, 상대 경로는 지금 폴더 기준. 존재 여부는 호출한 쪽이 본다.
 * previous가 없는 `cd -`는 null.
 */
export function resolveTarget(platform: NodeJS.Platform, cwd: string, target: string | null | '-', home: string, previous: string | null): string | null {
  const p = platform === 'win32' ? win32 : posix;
  if (target === null) return home;
  if (target === '-') return previous;
  if (target === '~') return home;
  if (target.startsWith('~/') || target.startsWith('~\\')) return p.join(home, target.slice(2));
  return p.resolve(cwd, target);
}
