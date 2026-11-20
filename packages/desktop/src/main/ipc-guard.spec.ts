import { describe, expect, it } from 'vitest';
import { guardIpcMain, isPetChannel, isTrustedSender, type GuardableIpc } from './ipc-guard.js';

const page = 'file:///app/dist/renderer/index.html?platform=win32';
const good = { fromWindow: true, frameUrl: 'file:///app/dist/renderer/index.html', isTopFrame: true };

describe('IPC 보낸 곳 확인', () => {
  it('우리 창의 최상위 앱 화면에서 온 호출만 믿는다', () => {
    expect(isTrustedSender(good, page)).toBe(true);
  });
  it('다른 창·하위 프레임·다른 주소·주소 없음은 믿지 않는다', () => {
    expect(isTrustedSender({ ...good, fromWindow: false }, page)).toBe(false);
    expect(isTrustedSender({ ...good, isTopFrame: false }, page)).toBe(false);
    expect(isTrustedSender({ ...good, frameUrl: 'https://evil.example/' }, page)).toBe(false);
    expect(isTrustedSender({ ...good, frameUrl: 'file:///other/evil.html' }, page)).toBe(false);
    expect(isTrustedSender({ ...good, frameUrl: undefined }, page)).toBe(false);
    expect(isTrustedSender(good, '')).toBe(false);
  });
});

type Fake = GuardableIpc & { invoke: (channel: string, e: unknown, ...args: unknown[]) => unknown; send: (channel: string, e: unknown, ...args: unknown[]) => void };

const fake = (): Fake => {
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const listeners = new Map<string, (e: unknown, ...a: unknown[]) => void>();
  const ipc = {
    handle: (c: string, l: (e: unknown, ...a: unknown[]) => unknown) => void handlers.set(c, l),
    on: (c: string, l: (e: unknown, ...a: unknown[]) => void) => (listeners.set(c, l), ipc),
    invoke: (c: string, e: unknown, ...a: unknown[]) => handlers.get(c)?.(e, ...a),
    send: (c: string, e: unknown, ...a: unknown[]) => listeners.get(c)?.(e, ...a),
  };
  return ipc as unknown as Fake;
};

describe('ipcMain 감싸기', () => {
  it('믿는 곳이면 원래 처리기가 인자를 그대로 받는다', () => {
    const ipc = fake();
    guardIpcMain(ipc, (e) => (e as { ok: boolean }).ok);
    ipc.handle('a', (_e, x) => `got ${String(x)}`);
    expect(ipc.invoke('a', { ok: true }, 7)).toBe('got 7');
  });
  it('믿지 않는 곳이면 handle 은 오류로 거절하고 처리기를 부르지 않는다', () => {
    const ipc = fake();
    let called = false;
    guardIpcMain(ipc, () => false);
    ipc.handle('a', () => ((called = true), 1));
    expect(() => ipc.invoke('a', {})).toThrow(/untrusted/i);
    expect(called).toBe(false);
  });
  it('믿지 않는 곳의 send(on)는 조용히 버린다', () => {
    const ipc = fake();
    let called = false;
    guardIpcMain(ipc, () => false);
    ipc.on('b', () => void (called = true));
    ipc.send('b', {});
    expect(called).toBe(false);
  });
  it('감싼 뒤에 새로 등록하는 채널도 모두 보호된다', () => {
    const ipc = fake();
    guardIpcMain(ipc, () => false);
    for (const c of ['x', 'y', 'z']) ipc.handle(c, () => 1);
    for (const c of ['x', 'y', 'z']) expect(() => ipc.invoke(c, {})).toThrow();
  });
  it('믿을지 가를 때 어느 통로로 왔는지도 함께 본다(델피 창은 pet: 통로만)', () => {
    const ipc = fake();
    const got: string[] = [];
    guardIpcMain(ipc, (e, channel) => ((e as { pet: boolean }).pet ? isPetChannel(channel) : !isPetChannel(channel)));
    ipc.on('pet:click', () => void got.push('pet:click'));
    ipc.on('job:submit', () => void got.push('job:submit'));
    ipc.send('pet:click', { pet: true });
    ipc.send('job:submit', { pet: true });
    ipc.send('pet:click', { pet: false });
    ipc.send('job:submit', { pet: false });
    expect(got).toEqual(['pet:click', 'job:submit']);
  });
});
