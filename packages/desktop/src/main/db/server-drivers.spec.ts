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
