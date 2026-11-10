/**
 * 앱 안에서 새 버전을 내려받아 설치하고 다시 켜는 계획. 파일을 만지거나 프로세스를 띄우는 일은 main이 하고,
 * 여기서는 "무엇을 실행할지"만 순수하게 정한다(경로가 명령 글에 섞여 들어가지 않게 검사한다).
 */

export type InstallPhase = 'idle' | 'checking' | 'downloading' | 'verifying' | 'preparing' | 'installing' | 'failed';

export interface InstallState {
  readonly phase: InstallPhase;
  /** 내려받는 중일 때 0~100, 알 수 없으면 null */
  readonly percent: number | null;
  /** 내려받은 바이트와 전체 바이트(전체를 모르면 null) */
  readonly receivedBytes?: number | null;
  readonly totalBytes?: number | null;
  /** 실패했을 때 사람이 읽는 이유 한 줄 */
  readonly reason?: string | null;
  /** 실패한 단계(모달에서 어느 단계에서 멈췄는지 보이려고) */
  readonly failedAt?: InstallPhase | null;
  /** 설치할 .app 위치와 그 이유 한 줄(맥) */
  readonly target?: string | null;
  readonly targetNote?: string | null;
}

export const IDLE_INSTALL: InstallState = { phase: 'idle', percent: null };

/** 진행 중인 단계인지(이때는 새 설치를 시작하지 않는다) */
export function isInstallBusy(state: InstallState): boolean {
  return state.phase !== 'idle' && state.phase !== 'failed';
}

export type InstallFailureCode =
  | 'missing-checksum'
  | 'bad-address'
  | 'no-download'
  | 'http'
  | 'incomplete'
  | 'checksum'
  | 'stalled'
  | 'network'
  | 'disk'
  | 'target-unwritable'
  | 'plan'
  | 'spawn'
  | 'cancelled';

/** 앱 안 설치가 실패한 이유(코드). 화면에는 failureText로 한 줄만 보인다. */
export class InstallFailure extends Error {
  constructor(
    readonly code: InstallFailureCode,
    readonly detail?: string,
  ) {
    super(detail === undefined ? code : `${code}: ${detail}`);
  }
}

/** 어떤 오류든 사람이 읽는 이유 한 줄로 */
export function failureText(error: unknown): string {
  if (!(error instanceof InstallFailure)) return 'Stopped because of an unexpected error';
  switch (error.code) {
    case 'missing-checksum':
      return 'Not installed: the release has no file checksum (SHA-256)';
    case 'bad-address':
      return 'Not downloaded: the address is not allowed';
    case 'no-download':
      return 'Could not find an installer for this computer';
    case 'http':
      return `The download server returned an error (${error.detail ?? '?'})`;
    case 'incomplete':
      return 'The downloaded file is incomplete (size mismatch)';
    case 'checksum':
      return 'The downloaded file did not match the release SHA-256, so it was deleted. It may be corrupted';
    case 'stalled':
      return 'No data arrived for 30 seconds, so it stopped. Check your network';
    case 'network':
      return 'No internet connection, or the server could not be reached';
    case 'disk':
      return 'Could not save the file. Check disk space and permissions';
    case 'target-unwritable':
      return 'No permission to write to the Applications folder';
    case 'plan':
      return 'In-app install is not supported on this computer';
    case 'spawn':
      return 'Could not start the installer';
    case 'cancelled':
      return 'Cancelled';
  }
}

export interface InstallPlanInput {
  readonly platform: string;
  readonly installerPath: string;
  /** Windows: 지금 실행 중인 앱 exe 경로 */
  readonly appExe?: string;
  /** macOS: 새 앱을 둘 .app 폴더 경로(update-target.ts가 정한 곳) */
  readonly appBundle?: string;
  readonly pid: number;
  /** 설치 스크립트가 남기는 기록 파일 */
  readonly logPath?: string;
  /** 설치 스크립트가 마지막에 "ok" 또는 "fail 이유코드"를 써 두는 파일(다시 켜진 앱이 읽는다) */
  readonly resultPath?: string;
}

export interface InstallPlan {
  readonly command: string;
  readonly args: readonly string[];
  readonly windowsVerbatimArguments?: boolean;
}

/** 스크립트가 결과 파일에 남기는 이유 코드 */
export const SWAP_FAILURES = ['app-running', 'mount', 'attach', 'no-app', 'copy', 'swap'] as const;

/**
 * 맥: 앱이 꺼지길(최대 60초) 기다린 뒤 dmg를 읽기 전용으로 붙여 .app을 덮어쓰고, 격리 표시를 빼고 다시 연다.
 * 새 앱을 옆에 먼저 복사한 뒤 바꿔 끼우므로, 중간에 실패해도 옛 앱이 남는다. 모든 단계가 로그를 남기고
 * 결과 파일에 ok / fail 코드를 쓴다(소리 없이 실패하지 않는다).
 * 경로는 $1(dmg) $2(앱 폴더) $3(pid) $4(로그) $5(결과 파일)로만 받는다. 글 안에 끼우지 않는다.
 */
export const MAC_SWAP_SCRIPT = [
  'dmg="$1"; app="$2"; pid="$3"; log="$4"; res="$5"; mnt=""; reopen=0; stage="$app.rauha-new"; old="$app.rauha-old"',
  'mkdir -p "$(dirname "$log")" "$(dirname "$app")" 2>/dev/null',
  `say() { printf '%s %s\\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$log"; }`,
  'cleanup() { if [ -n "$mnt" ]; then hdiutil detach "$mnt" -quiet 2>/dev/null; fi; rm -rf "$stage" 2>/dev/null; }',
  `fail() { say "실패 $1: $2"; printf 'fail %s\\n' "$1" > "$res"; if [ "$reopen" = 1 ] && [ -d "$app" ]; then open "$app"; fi; exit 1; }`,
  'trap cleanup EXIT',
  'say "시작: 앱($pid)이 닫히길 기다려요 -> $app"',
  'i=0; while kill -0 "$pid" 2>/dev/null && [ "$i" -lt 120 ]; do sleep 0.5; i=$((i+1)); done',
  'if kill -0 "$pid" 2>/dev/null; then fail app-running "앱이 60초 안에 닫히지 않았어요"; fi',
  'reopen=1',
  'mnt="$(mktemp -d)" || fail mount "임시 폴더를 만들지 못했어요"',
  'hdiutil attach "$dmg" -nobrowse -readonly -quiet -mountpoint "$mnt" >> "$log" 2>&1 || fail attach "설치 파일(dmg)을 열지 못했어요"',
  'new="$(find "$mnt" -maxdepth 1 -name "*.app" | head -n 1)"',
  '[ -n "$new" ] || fail no-app "dmg 안에 앱이 없어요"',
  'rm -rf "$stage" "$old"',
  'cp -R "$new" "$stage" >> "$log" 2>&1 || fail copy "새 앱을 복사하지 못했어요(디스크 공간이나 권한)"',
  'if [ -d "$app" ]; then mv "$app" "$old" >> "$log" 2>&1 || fail swap "옛 앱을 치우지 못했어요(권한)"; fi',
  'mv "$stage" "$app" >> "$log" 2>&1 || { if [ -d "$old" ]; then mv "$old" "$app"; fi; fail swap "새 앱을 제자리에 두지 못했어요"; }',
  'rm -rf "$old"',
  'xattr -dr com.apple.quarantine "$app" 2>/dev/null',
  'rm -f "$dmg"',
  `printf 'ok\\n' > "$res"`,
  'say "성공: $app"',
  'open "$app"',
].join('\n');

const WIN_UNSAFE = /["&|<>^%\r\n]/;

export function installPlan(input: InstallPlanInput): InstallPlan | null {
  const { logPath, resultPath } = input;
  if (logPath === undefined || resultPath === undefined) return null;
  if (input.platform === 'win32') {
    const { installerPath, appExe } = input;
    if (appExe === undefined || [installerPath, appExe, logPath, resultPath].some((p) => WIN_UNSAFE.test(p))) return null;
    // 앱이 꺼질 때까지 5초쯤 둔 뒤 조용히 설치하고(끝날 때까지 기다린다), 결과를 파일에 남기고, 다시 켠다.
    // 설치가 실패해도 옛 앱은 그대로 있으니 다시 켠다.
    const line = [
      'ping -n 6 127.0.0.1 >nul',
      `echo install begin>>"${logPath}"`,
      `start "" /wait "${installerPath}" /S && (echo ok>"${resultPath}" & echo install ok>>"${logPath}") || (echo fail>"${resultPath}" & echo install failed>>"${logPath}")`,
      `start "" "${appExe}"`,
    ].join(' & ');
    return { command: 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], windowsVerbatimArguments: true };
  }
  if (input.platform === 'darwin') {
    const { installerPath, appBundle } = input;
    if (appBundle === undefined || !appBundle.endsWith('.app')) return null;
    return { command: 'sh', args: ['-c', MAC_SWAP_SCRIPT, 'sh', installerPath, appBundle, String(input.pid), logPath, resultPath] };
  }
  return null;
}

export function installStateText(state: InstallState): string {
  switch (state.phase) {
    case 'checking':
      return 'Checking…';
    case 'downloading':
      return state.percent === null ? 'Downloading…' : `Downloading ${Math.round(state.percent)}%`;
    case 'verifying':
      return 'Verifying file…';
    case 'preparing':
      return 'Preparing to install…';
    case 'installing':
      return 'Installing and restarting…';
    case 'failed':
      return 'Could not install. Download it in your browser and install it manually';
    case 'idle':
      return '';
  }
}
