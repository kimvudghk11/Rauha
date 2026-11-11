import { isAppPage } from '../shared/navigation-guard.js';

/** IPC 를 보낸 쪽이 우리 창의 최상위 앱 화면인지 가르는 데 필요한 사실들(Electron 이벤트에서 뽑아 온다) */
export interface SenderFacts {
  /** 보낸 webContents 가 우리 창의 것인지 */
  readonly fromWindow: boolean;
  /** 보낸 프레임의 주소 */
  readonly frameUrl: string | undefined;
  /** 최상위 프레임인지(하위 프레임이 아닌지) */
  readonly isTopFrame: boolean;
}

/** 우리 창의 최상위 앱 화면(파일 하나)에서 온 호출만 믿는다. 다른 창·하위 프레임·바깥 주소에서 온 호출은 믿지 않는다. */
export function isTrustedSender(facts: SenderFacts, appPageUrl: string): boolean {
  return facts.fromWindow && facts.isTopFrame && facts.frameUrl !== undefined && appPageUrl !== '' && isAppPage(facts.frameUrl, appPageUrl);
}

/** ipcMain 중 감쌀 두 함수만 */
/* eslint-disable @typescript-eslint/no-explicit-any -- Electron 의 처리기 인자는 채널마다 달라 any 로 받는다 */
export interface GuardableIpc {
  handle(channel: string, listener: (event: any, ...args: any[]) => unknown): unknown;
  on(channel: string, listener: (event: any, ...args: any[]) => void): unknown;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * ipcMain.handle / ipcMain.on 을 제자리에서 감싼다: 믿는 곳에서 온 호출만 원래 처리기로 보낸다.
 * 감싼 뒤에 등록하는 채널(다른 파일에서 ipcMain 을 넘겨받아 등록하는 것 포함)도 모두 같은 확인을 거친다.
 * handle 은 오류로 거절하고, on(보내고 끝) 은 조용히 버린다.
 */
export function guardIpcMain(ipc: GuardableIpc, trusted: (event: unknown) => boolean): void {
  const handle = ipc.handle.bind(ipc) as (c: string, l: (e: unknown, ...a: unknown[]) => unknown) => unknown;
  const on = ipc.on.bind(ipc) as (c: string, l: (e: unknown, ...a: unknown[]) => void) => unknown;
  const mutable = ipc as unknown as { handle: typeof handle; on: typeof on };
  mutable.handle = (channel, listener) =>
    handle(channel, (event, ...args) => {
      if (!trusted(event)) throw new Error('Blocked an IPC call from an untrusted page.');
      return listener(event, ...args);
    });
  mutable.on = (channel, listener) =>
    on(channel, (event, ...args) => {
      if (trusted(event)) listener(event, ...args);
    });
}
