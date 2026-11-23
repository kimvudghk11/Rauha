import { describe, expect, it } from 'vitest';
import { linkOver, type LineSocket } from './management.js';

function fakeSocket() {
  const written: string[] = [];
  const on: Record<string, ((x?: unknown) => void)[]> = {};
  const sock = {
    destroyed: false,
    setEncoding: () => sock,
    write: (t: string) => written.push(t),
    destroy: () => {
      sock.destroyed = true;
    },
    on: (ev: string, fn: (x?: unknown) => void) => {
      (on[ev] ??= []).push(fn);
      return sock;
    },
  };
  return { sock: sock as unknown as LineSocket, written, feed: (s: string) => on['data']?.forEach((f) => f(s)), close: () => on['close']?.forEach((f) => f()) };
}

describe('OpenVPN management 연결', () => {
  it('명령은 앞 명령의 답을 받은 뒤에 하나씩 보낸다', () => {
    const f = fakeSocket();
    const link = linkOver(f.sock, { onLine: () => {}, onClose: () => {} });
    link.send('state on');
    link.send('log on');
    link.send('hold release');
    expect(f.written).toEqual(['state on\n']);
    f.feed('SUCCESS: real-time state notification set to ON\r\n');
    expect(f.written).toEqual(['state on\n', 'log on\n']);
    f.feed('SUCCESS: real-time log notification set to ON\r\nSUCCESS: hold release succeeded\r\n');
    expect(f.written).toEqual(['state on\n', 'log on\n', 'hold release\n']);
  });

  it('ERROR 답도 다음 명령으로 넘어가게 한다', () => {
    const f = fakeSocket();
    const link = linkOver(f.sock, { onLine: () => {}, onClose: () => {} });
    link.send('bogus');
    link.send('log on');
    f.feed('ERROR: unknown command\n');
    expect(f.written.at(-1)).toBe('log on\n');
  });

  it('끊기(signal)는 앞 답을 기다리지 않고 바로 보내고, 남은 명령은 버린다', () => {
    const f = fakeSocket();
    const link = linkOver(f.sock, { onLine: () => {}, onClose: () => {} });
    link.send('state on');
    link.send('hold release');
    link.send('signal SIGTERM');
    expect(f.written).toEqual(['state on\n', 'signal SIGTERM\n']);
    f.feed('SUCCESS: x\n');
    expect(f.written).toEqual(['state on\n', 'signal SIGTERM\n']);
  });

  it('조각나 들어온 줄을 이어 붙여 한 줄씩 넘긴다', () => {
    const f = fakeSocket();
    const lines: string[] = [];
    linkOver(f.sock, { onLine: (l) => lines.push(l), onClose: () => {} });
    f.feed('>STATE:1,CONN');
    f.feed('ECTED,SUCCESS,10.0.0.5,,,,\r\n>BYTE');
    expect(lines).toEqual(['>STATE:1,CONNECTED,SUCCESS,10.0.0.5,,,,']);
  });

  it('소켓이 닫히면 알린다', () => {
    const f = fakeSocket();
    let closed = false;
    linkOver(f.sock, { onLine: () => {}, onClose: () => (closed = true) });
    f.close();
    expect(closed).toBe(true);
  });
});
