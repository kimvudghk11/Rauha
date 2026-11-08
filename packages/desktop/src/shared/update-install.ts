/**
 * 앱 안에서 새 버전을 내려받아 설치하고 다시 켜는 계획. 파일을 만지거나 프로세스를 띄우는 일은 main이 하고,
 * 여기서는 "무엇을 실행할지"만 순수하게 정한다(경로가 명령 글에 섞여 들어가지 않게 검사한다).
 */

export type InstallPhase = 'idle' | 'downloading' | 'installing' | 'failed';

export interface InstallState {
  readonly phase: InstallPhase;
  /** 내려받는 중일 때 0~100, 알 수 없으면 null */
  readonly percent: number | null;
}

export const IDLE_INSTALL: InstallState = { phase: 'idle', percent: null };

export interface InstallPlanInput {
  readonly platform: string;
  readonly installerPath: string;
  /** Windows: 지금 실행 중인 앱 exe 경로 */
  readonly appExe?: string;
  /** macOS: 지금 실행 중인 .app 폴더 경로 */
  readonly appBundle?: string;
  readonly pid: number;
}

export interface InstallPlan {
  readonly command: string;
  readonly args: readonly string[];
  readonly windowsVerbatimArguments?: boolean;
}

/**
 * 맥: 앱이 꺼지길 기다린 뒤 dmg를 읽기 전용으로 붙여 .app을 덮어쓰고, 격리 표시를 빼고 다시 연다.
 * 경로는 $1(dmg) $2(앱 폴더) $3(pid)로만 받는다. 글 안에 끼우지 않는다.
 */
export const MAC_SWAP_SCRIPT = [
  'dmg="$1"; app="$2"; pid="$3"; mnt="$(mktemp -d)"',
  'i=0; while kill -0 "$pid" 2>/dev/null && [ "$i" -lt 60 ]; do sleep 0.5; i=$((i+1)); done',
  'hdiutil attach "$dmg" -nobrowse -readonly -quiet -mountpoint "$mnt" || exit 1',
  'new="$(find "$mnt" -maxdepth 1 -name "*.app" | head -n 1)"',
  'if [ -n "$new" ]; then rm -rf "$app" && cp -R "$new" "$app"; fi',
  'hdiutil detach "$mnt" -quiet 2>/dev/null',
  'xattr -dr com.apple.quarantine "$app" 2>/dev/null',
  'rm -f "$dmg"',
  'open "$app"',
].join('\n');

const WIN_UNSAFE = /["&|<>^%\r\n]/;

export function installPlan(input: InstallPlanInput): InstallPlan | null {
  if (input.platform === 'win32') {
    const { installerPath, appExe } = input;
    if (appExe === undefined || WIN_UNSAFE.test(installerPath) || WIN_UNSAFE.test(appExe)) return null;
    // 앱이 꺼질 때까지 2초쯤 둔 뒤 조용히 설치하고, 끝나면 다시 켠다.
    const line = `ping -n 3 127.0.0.1 >nul & "${installerPath}" /S & start "" "${appExe}"`;
    return { command: 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], windowsVerbatimArguments: true };
  }
  if (input.platform === 'darwin') {
    const { installerPath, appBundle } = input;
    if (appBundle === undefined || !appBundle.endsWith('.app')) return null;
    return { command: 'sh', args: ['-c', MAC_SWAP_SCRIPT, 'sh', installerPath, appBundle, String(input.pid)] };
  }
  return null;
}

export function installStateText(state: InstallState): string {
  switch (state.phase) {
    case 'downloading':
      return state.percent === null ? '내려받는 중…' : `내려받는 중 ${Math.round(state.percent)}%`;
    case 'installing':
      return '설치하고 다시 켜는 중…';
    case 'failed':
      return '설치하지 못했어요. 브라우저로 내려받아 설치해 주세요';
    case 'idle':
      return '';
  }
}
