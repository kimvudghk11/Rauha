import { connect, createServer, type Socket } from 'node:net';

/** OpenVPN management 인터페이스(127.0.0.1)와 주고받는 줄 단위 연결 */
export interface ManagementLink {
  send(command: string): void;
  close(): void;
}

export interface ManagementHandlers {
  readonly onLine: (line: string) => void;
  readonly onClose: () => void;
}

/** 비어 있는 로컬 포트 하나 */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      srv.close(() => (port > 0 ? resolve(port) : reject(new Error('no free port'))));
    });
  });
}

/** 줄을 읽고 쓰는 최소한의 소켓 모양(시험에서 가짜로 바꾼다) */
export interface LineSocket {
  readonly destroyed: boolean;
  setEncoding(enc: 'utf8'): unknown;
  write(text: string): unknown;
  destroy(): unknown;
  on(event: 'data', fn: (d: string) => void): unknown;
  on(event: 'error', fn: (e: Error) => void): unknown;
  on(event: 'close', fn: () => void): unknown;
}

/**
 * 명령은 한 번에 하나씩: 앞 명령의 답(SUCCESS:/ERROR:)을 받은 뒤 다음을 보낸다.
 * Windows 의 OpenVPN 은 한 번에 붙여 보낸 명령 중 첫 줄만 읽고 나머지를 버리는 일이 있다(실제로 "hold release" 가 사라져 연결이 멈췄다).
 */
export function linkOver(sock: LineSocket, handlers: ManagementHandlers): ManagementLink {
  let buf = '';
  const queue: string[] = [];
  let waiting = false;
  const pump = (): void => {
    if (waiting || sock.destroyed) return;
    const next = queue.shift();
    if (next === undefined) return;
    waiting = true;
    sock.write(`${next}\n`);
  };
  sock.setEncoding('utf8');
  sock.on('data', (d: string) => {
    buf += d;
    let at: number;
    while ((at = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, at).replace(/\r$/, '');
      buf = buf.slice(at + 1);
      if (line === '') continue;
      if (/^(SUCCESS|ERROR):/.test(line)) {
        waiting = false;
        pump();
      }
      handlers.onLine(line);
    }
  });
  sock.on('error', () => {});
  sock.on('close', () => handlers.onClose());
  return {
    send: (command) => {
      // 끊기(signal)는 줄 서지 않고 바로: 앱이 꺼지는 중이면 앞 답을 기다릴 틈이 없다
      if (command.startsWith('signal ')) {
        queue.length = 0;
        if (!sock.destroyed) sock.write(`${command}\n`);
        return;
      }
      queue.push(command);
      pump();
    },
    close: () => {
      sock.destroy();
    },
  };
}

/** OpenVPN 이 management 포트를 열 때까지 잠깐씩 다시 붙어 본다. 끝내 못 붙으면 던진다 */
export async function attachManagement(port: number, handlers: ManagementHandlers, waitMs = 20_000): Promise<ManagementLink> {
  const until = Date.now() + waitMs;
  for (;;) {
    try {
      const sock = await new Promise<Socket>((resolve, reject) => {
        const s = connect(port, '127.0.0.1');
        s.once('connect', () => resolve(s));
        s.once('error', reject);
      });
      return linkOver(sock, handlers);
    } catch {
      if (Date.now() > until) throw new Error('OpenVPN did not open its control port in time.');
      await new Promise((r) => setTimeout(r, 300));
    }
  }
}
