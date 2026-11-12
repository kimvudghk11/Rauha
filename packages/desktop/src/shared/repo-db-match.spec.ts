import { describe, expect, it } from 'vitest';
import { DbConnections } from './db-connections.js';
import { DbFilePath } from './db-names.js';
import { ConnectionLabel, SavedPassword, ServerTarget } from './db-server.js';
import { RepoDbHints, RepoDbMatch, looksLikeProduction } from './repo-db-match.js';

function server(c: DbConnections, id: string, o: { kind: 'mysql' | 'postgres'; host: string; port?: number; database: string; name?: string }, used: number): void {
  const target = ServerTarget.parse({ kind: o.kind, host: o.host, port: o.port, user: 'app', database: o.database });
  c.addServer(target, ConnectionLabel.parse(o.name ?? '', target), SavedPassword.none(), id, used);
}

const env = (text: string, name = '.env') => RepoDbHints.fromEnvFiles([{ name, text }]);

describe('레포 설정에서 DB 단서 읽기', () => {
  it('DATABASE_URL 에서 종류·호스트·포트·DB 이름만 읽고 비밀번호는 버린다', () => {
    const hints = env('DATABASE_URL="postgresql://app:s3cret@db.local:6543/shop?schema=public"');
    expect(hints.list()).toEqual([{ kind: 'postgres', host: 'db.local', port: 6543, database: 'shop' }]);
    expect(JSON.stringify(hints.list())).not.toContain('s3cret');
  });

  it('DB_HOST·DB_PORT·DB_NAME 같은 낱개 값을 접두어별로 묶는다', () => {
    const hints = env(['export DB_TYPE=mysql', 'DB_HOST=127.0.0.1', 'DB_PORT=3307', "DB_DATABASE='orders'", 'DB_PASSWORD=hunter2', 'READ_DB_HOST=replica', 'READ_DB_NAME=orders_ro', '# DB_NAME=old'].join('\n'));
    expect(hints.list()).toEqual(
      expect.arrayContaining([
        { kind: 'mysql', host: '127.0.0.1', port: 3307, database: 'orders' },
        { kind: null, host: 'replica', port: null, database: 'orders_ro' },
      ]),
    );
    expect(JSON.stringify(hints.list())).not.toContain('hunter2');
  });

  it('POSTGRES_DB·PGDATABASE 처럼 DB 종류가 이름에 든 키는 종류도 정한다', () => {
    expect(env('POSTGRES_DB=app\nPOSTGRES_HOST=localhost').list()).toEqual([{ kind: 'postgres', host: 'localhost', port: null, database: 'app' }]);
    expect(env('MYSQL_DATABASE=app').list()).toEqual([{ kind: 'mysql', host: null, port: null, database: 'app' }]);
  });

  it('DB 이름이 없는 단서(호스트만)는 버린다', () => {
    expect(env('DB_HOST=localhost\nREDIS_URL=redis://x:6379/0').list()).toEqual([]);
  });
});

describe('레포에 맞는 연결 고르기', () => {
  it('DB 이름이 같고 호스트·포트가 맞는 서버 연결을 고른다', () => {
    const c = DbConnections.empty();
    server(c, 'a', { kind: 'postgres', host: 'db.local', port: 6543, database: 'shop' }, 1);
    server(c, 'b', { kind: 'postgres', host: 'db.local', port: 6543, database: 'blog' }, 2);
    expect(RepoDbMatch.pick(c, env('DATABASE_URL=postgres://u:p@db.local:6543/shop'), '/repo')?.id).toBe('a');
  });

  it('주소가 여럿인 연결은 .env 호스트·포트가 그중 하나와 맞으면 고른다', () => {
    const c = DbConnections.empty();
    const t = ServerTarget.parse({ kind: 'postgres', addresses: [{ host: '10.0.0.5', label: 'Private' }, { host: '3.35.12.4', port: 6543, label: 'Public' }], user: 'app', database: 'shop' });
    c.addServer(t, ConnectionLabel.parse('', t), SavedPassword.none(), 'm', 1);
    expect(RepoDbMatch.pick(c, env('DATABASE_URL=postgres://u:p@3.35.12.4:6543/shop'), '/repo')?.id).toBe('m');
    expect(RepoDbMatch.pick(c, env('DATABASE_URL=postgres://u:p@10.0.0.5:5432/shop'), '/repo')?.id).toBe('m');
    expect(RepoDbMatch.pick(c, env('DATABASE_URL=postgres://u:p@3.35.12.4:5432/shop'), '/repo')).toBeNull();
  });

  it('localhost·127.0.0.1·::1 은 같은 호스트로 본다', () => {
    const c = DbConnections.empty();
    server(c, 'a', { kind: 'mysql', host: '127.0.0.1', database: 'shop' }, 1);
    expect(RepoDbMatch.pick(c, env('DB_HOST=localhost\nDB_NAME=shop'), '/repo')?.id).toBe('a');
  });

  it('호스트·포트·종류가 다르면 이름이 같아도 고르지 않는다', () => {
    const c = DbConnections.empty();
    server(c, 'a', { kind: 'mysql', host: 'other', database: 'shop' }, 1);
    expect(RepoDbMatch.pick(c, env('DB_HOST=localhost\nDB_NAME=shop'), '/repo')).toBeNull();
    expect(RepoDbMatch.pick(c, env('DATABASE_URL=postgres://other:5432/shop'), '/repo')).toBeNull();
    expect(RepoDbMatch.pick(c, env('DB_HOST=other\nDB_PORT=3310\nDB_NAME=shop'), '/repo')).toBeNull();
  });

  it('여럿이 맞으면 최근에 쓴 연결을 고른다', () => {
    const c = DbConnections.empty();
    server(c, 'old', { kind: 'mysql', host: 'localhost', database: 'shop', name: 'shop A' }, 1);
    server(c, 'new', { kind: 'mysql', host: 'localhost', port: 3307, database: 'shop', name: 'shop B' }, 5);
    expect(RepoDbMatch.pick(c, env('DB_NAME=shop'), '/repo')?.id).toBe('new');
  });

  it('레포 안에 있는 SQLite 파일 연결을 고른다(밖의 파일은 고르지 않는다)', () => {
    const c = DbConnections.empty();
    c.add(DbFilePath.parse('C:\\work\\other\\x.db'), 'out', 1);
    expect(RepoDbMatch.pick(c, RepoDbHints.fromEnvFiles([]), 'C:/work/app')).toBeNull();
    c.add(DbFilePath.parse('C:\\Work\\App\\prisma\\dev.db'), 'in', 2);
    expect(RepoDbMatch.pick(c, RepoDbHints.fromEnvFiles([]), 'C:/work/app')?.id).toBe('in');
  });

  it('맞는 연결이 없으면 null 이다', () => {
    expect(RepoDbMatch.pick(DbConnections.empty(), env('DB_NAME=shop'), '/repo')).toBeNull();
  });
});

describe('운영 DB 알아보기', () => {
  it('연결 이름이나 호스트에 prod 가 있으면 운영 DB 로 본다', () => {
    expect(looksLikeProduction('shop PROD', 'localhost')).toBe(true);
    expect(looksLikeProduction('shop', 'db.production.internal')).toBe(true);
    expect(looksLikeProduction('운영 DB', 'x')).toBe(true);
    expect(looksLikeProduction('shop dev', 'localhost')).toBe(false);
  });
});
