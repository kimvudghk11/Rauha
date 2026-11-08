import { titleBarHeight, titleBarText, trafficLightsRightEdge } from '../shared/title-bar.js';

/** 제목줄 치수와 글을 화면에 반영한다. 높이·신호등 여백은 CSS 변수로, 전체 화면은 data-fullscreen으로 넘긴다. */
export function createChrome(root: HTMLElement, textNode: HTMLElement, platform: string, appName = 'rauha') {
  let fullScreen = false;
  let folder: string | null = null;
  const paint = (): void => {
    root.style.setProperty('--titlebar-h', `${titleBarHeight(platform, fullScreen)}px`);
    root.style.setProperty('--traffic-edge', `${trafficLightsRightEdge()}px`);
    root.toggleAttribute('data-fullscreen', fullScreen);
    textNode.textContent = titleBarText(appName, folder);
  };
  paint();
  return {
    setFullScreen(on: boolean): void {
      fullScreen = on;
      paint();
    },
    setFolder(next: string | null): void {
      folder = next;
      paint();
    },
  };
}
