import { createServer, type AddressInfo, type Server } from 'node:net';
import { describe, expect, it } from 'vitest';
import { ServerTarget, type ServerKind } from '../../shared/db-server.js';
import { mysqlDriver, postgresDriver } from './server-drivers.js';

/** 이 컴퓨터에서 아무도 듣지 않는 포트(접속이 바로 거절된다) */
const CLOSED_PORT = 1;

describe('실제 드라이버(서버 없이)', () => {
  for (const [kind, driver] of [['mysql', mysqlDriver], ['postgres', postgresDriver]] as const) {
    it(`${kind}: 닫힌 포트에 접속하면 앱을 죽이지 않고 거절 오류로 끝나며, 오류 글에 비밀번호가 없다`, async () => {
      const target = ServerTarget.parse({ kind: kind satisfies ServerKind, host: '127.0.0.1', port: CLOSED_PORT, user: 'app', database: 'shop' });
      const error = await driver.connect({ target, password: 'NeverShowMe', connectTimeoutMs: 5000, statementTimeoutMs: 1000 }).then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(Error);
      expect(String((error as Error).message)).toMatch(/ECONNREFUSED|connect|timeout/i);
      expect(String((error as Error).message)).not.toContain('NeverShowMe');
    }, 20_000);
  }
});

/**
 * PgBouncer·RDS Proxy 흉내: 시작 파라미터에 statement_timeout 이 있으면 "unsupported startup parameter" 로 끊고,
 * SET 문도 거절한다(풀러가 막는 경우). 비밀번호 없이 바로 AuthenticationOk.
 */
function fakePooler(): Promise<{ server: Server; port: number; startupKeys: string[][] }> {
  const startupKeys: string[][] = [];
  const msg = (type: string, body: Buffer): Buffer => {
    const head = Buffer.alloc(5);
    head.write(type, 0, 'latin1');
    head.writeInt32BE(body.length + 4, 1);
    return Buffer.concat([head, body]);
  };
  const error = (text: string): Buffer => msg('E', Buffer.from(`SERROR\0C08P01\0M${text}\0\0`, 'utf8'));
  const ready = (): Buffer => msg('Z', Buffer.from('I'));
  const server = createServer((sock) => {
    let buf = Buffer.alloc(0);
    let started = false;
    sock.on('error', () => undefined);
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        if (!started) {
          if (buf.length < 4) return;
          const len = buf.readInt32BE(0);
          if (buf.length < len) return;
          const parts = buf.subarray(8, len).toString('utf8').split('\0');
          buf = buf.subarray(len);
          const keys = parts.filter((_, i) => i % 2 === 0 && parts[i] !== '');
          startupKeys.push(keys);
          started = true;
          if (keys.includes('statement_timeout')) {
            sock.end(error('unsupported startup parameter: statement_timeout'));
            return;
          }
          const ok = Buffer.alloc(4);
          sock.write(Buffer.concat([msg('R', ok), ready()]));
          continue;
        }
        if (buf.length < 5) return;
        const type = buf.toString('latin1', 0, 1);
        const len = buf.readInt32BE(1) + 1;
        if (buf.length < len) return;
        buf = buf.subarray(len);
        if (type === 'X') return void sock.end();
        // 단순 질의(Q): SET 은 풀러가 거절, 나머지는 빈 결과
        if (type === 'Q') sock.write(Buffer.concat([error('SET is not allowed through this pooler'), ready()]));
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as AddressInfo).port, startupKeys })));
}

describe('PostgreSQL 커넥션 풀러(PgBouncer 등) 뒤의 서버', () => {
  it('시작 파라미터로 statement_timeout 을 보내지 않아 "unsupported startup parameter" 없이 붙고, SET 이 거절돼도 접속은 산다', async () => {
    const { server, port, startupKeys } = await fakePooler();
    try {
      const target = ServerTarget.parse({ kind: 'postgres', host: '127.0.0.1', port, user: 'app', database: 'shop' });
      const session = await postgresDriver.connect({ target, password: 'x', connectTimeoutMs: 5000, statementTimeoutMs: 1000 });
      expect(startupKeys[0]).not.toContain('statement_timeout');
      session.destroy();
    } finally {
      server.close();
    }
  }, 20_000);
});
