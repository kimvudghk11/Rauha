/**
 * macOS 제목줄 치수. 창 맨 위 전체 너비의 얇은 줄(VS Code 맥처럼)이고, 신호등 버튼은 그 줄의 세로 가운데에 놓는다.
 * main(창 옵션)과 화면(CSS 변수)이 같은 숫자를 쓰도록 한곳에 둔다.
 *
 * 값의 근거(VS Code가 쓰는 규격을 그대로 따른다):
 * - 제목줄 높이 35: microsoft/vscode src/vs/platform/window/common/window.ts 의 DEFAULT_CUSTOM_TITLEBAR_HEIGHT = 35
 *   https://github.com/microsoft/vscode/blob/main/src/vs/platform/window/common/window.ts
 * - 신호등 위치: 같은 파일 getMacOSWindowControlsPosition — 버튼 칸 높이 16(macOS 26 Tahoe 이상은 14),
 *   y = floor((제목줄 높이 - 칸 높이) / 2), x = y + 1. 높이 35면 y 9·x 10(Tahoe는 y 10·x 11).
 * - trafficLightPosition은 Electron 옵션이고 titleBarStyle 'hidden'·'hiddenInset'에서 쓴다(둘 다 신호등은 OS가 그림).
 *   https://www.electronjs.org/docs/latest/tutorial/custom-title-bar
 * - 신호등 원 지름 12, 원 사이 간격 8은 macOS 표준 창 버튼 치수(세 개 합 52). 앞쪽 글 시작 여백은 Zed가 쓰는 값
 *   (신호등 왼쪽 여백 71, macOS 26 SDK에서 78)과 맞춰 약 78~79로 둔다.
 *   https://github.com/zed-industries/zed (Fix title bar spacing when building on the macOS Tahoe SDK, #45351)
 * - 전체 화면에서는 OS가 신호등을 숨긴다. Electron은 'enter-full-screen'·'leave-full-screen' 이벤트를 낸다(전환은 비동기).
 *   https://www.electronjs.org/docs/latest/api/browser-window
 */
export const TITLE_BAR_HEIGHT = 35;

/** 맥 신호등 치수(px): 원 지름·원 사이 간격·글까지 비워 둘 여백. box는 VS Code가 쓰는 버튼 칸 높이(Tahoe 이전 16, 이후 14). */
export const TRAFFIC_LIGHT = { diameter: 12, gap: 8, clearance: 16, box: 16, boxTahoe: 14 } as const;

/** Darwin 커널 버전(os.release())이 macOS 26(Tahoe) 이상인지. macOS 26 = Darwin 25. */
export function isTahoeOrNewer(darwinRelease: string): boolean {
  const major = Number.parseInt(darwinRelease, 10);
  return Number.isFinite(major) && major >= 25;
}

/** 화면 안 제목줄 높이. 맥이 아니거나 전체 화면(신호등이 사라진 상태)이면 0. */
export function titleBarHeight(platform: string, fullScreen: boolean): number {
  return platform === 'darwin' && !fullScreen ? TITLE_BAR_HEIGHT : 0;
}

/** 신호등 왼쪽 위 좌표(VS Code 방식). 버튼 칸을 제목줄 세로 가운데에 놓고 x는 y + 1. */
export function trafficLightPosition(height: number, tahoe = false): { x: number; y: number } {
  const y = Math.floor((height - (tahoe ? TRAFFIC_LIGHT.boxTahoe : TRAFFIC_LIGHT.box)) / 2);
  return { x: y + 1, y };
}

/** 신호등 세 개가 끝나는 가로 위치 + 여백. 제목줄 글이 이 안쪽을 침범하지 않게 하는 기준(Tahoe 쪽 더 큰 x 기준). */
export function trafficLightsRightEdge(): number {
  const { x } = trafficLightPosition(TITLE_BAR_HEIGHT, true);
  return x + 3 * TRAFFIC_LIGHT.diameter + 2 * TRAFFIC_LIGHT.gap + TRAFFIC_LIGHT.clearance;
}

/** 제목줄 가운데 글: "작업폴더 — 앱이름". 폴더를 안 골랐으면 앱 이름만. */
export function titleBarText(appName: string, workFolder: string | null): string {
  const name = (workFolder ?? '').split(/[\\/]/).filter((part) => part !== '').pop();
  return name === undefined ? appName : `${name} — ${appName}`;
}
