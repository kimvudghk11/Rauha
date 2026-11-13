import { connect } from 'node:net';
import { explainNetworkError } from '../../shared/api-guard.js';

/**
 * 서버가 듣고 있는지 TCP 연결만 해 본다(HTTP 요청은 보내지 않는다).
 * 듣고 있으면 null, 아니면 사람이 읽을 이유 글. localhost 는 IPv4·IPv6 를 둘 다 시도한다.
 */
export function probeServer(url: string, timeoutMs = 2_000): Promise<string | null> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return Promise.resolve('The address is not a valid URL.');
  }
  const port = u.port !== '' ? Number(u.port) : u.protocol === 'https:' ? 443 : 80;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  return new Promise((resolve) => {
    const sock = connect({ host, port, autoSelectFamily: true, timeout: timeoutMs });
    const done = (v: string | null): void => {
      sock.destroy();
      resolve(v);
    };
    sock.once('connect', () => done(null));
    sock.once('timeout', () => done('The connection timed out.'));
    sock.once('error', (e: NodeJS.ErrnoException) => done(explainNetworkError(e.code, e.message)));
  });
}
