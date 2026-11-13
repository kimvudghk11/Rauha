import type { ServerDriver, ServerSession } from './server-engine.js';
import { sslOptionsFor } from './server-tls.js';

/**
 * 실제 드라이버(mysql2 · pg)를 ServerSession 모양으로 감싼다. 둘 다 순수 JS 라 main 번들(esbuild)에 함께 묶이고, 처음 쓸 때 불러온다.
 * - 비밀번호는 드라이버 설정에만 넘긴다(로그·오류 글로 내보내지 않는다).
 * - 접속은 10초(connectTimeoutMs)에 끊고, 결과는 행 단위 이벤트로 받아 상한에서 멈춘다(연결째 끊는다).
 * - 오류 이벤트를 늘 받아 둔다: 받는 곳이 없는 'error' 이벤트는 main 프로세스를 죽인다.
 * - SSL: off · require(암호화만, 인증서는 보지 않음) · verify(Node 기본 CA 로 인증서 확인, RDS 호스트면 Amazon RDS CA 도 믿는다: server-tls.ts)
 */

type Sink = Parameters<ServerSession['run']>[2];
type RunResult = { readonly changes: number | null; readonly stopped: boolean };

export const mysqlDriver: ServerDriver = {
  async connect(o) {
    const mysql = await import('mysql2');
    const t = o.target;
    const ssl = sslOptionsFor(t);
    const conn = mysql.createConnection({
      host: t.host.replace(/^\[|\]$/g, ''),
      port: t.port,
      user: t.user,
      password: o.password,
      database: t.database,
      connectTimeout: o.connectTimeoutMs,
      ...(ssl === null ? {} : { ssl: { rejectUnauthorized: ssl.rejectUnauthorized, ...(ssl.ca === undefined ? {} : { ca: [...ssl.ca] }) } }),
      // 날짜는 서버가 준 글 그대로, 큰 수는 글로(자릿수를 잃지 않게)
      dateStrings: true,
      supportBigNumbers: true,
      bigNumberStrings: true,
      // 한 번에 한 문장만. 서버가 내 컴퓨터 파일을 달라고 하는 LOAD DATA LOCAL 도 받지 않는다
      multipleStatements: false,
      flags: ['-LOCAL_FILES', '-MULTI_STATEMENTS'],
      charset: 'utf8mb4',
    });
    conn.on('error', () => undefined);
    await new Promise<void>((resolve, reject) => conn.connect((e) => (e === null ? resolve() : reject(e))));
    let dead = false;
    const destroy = (): void => {
      dead = true;
      conn.destroy();
    };
    const run = (sql: string, params: readonly unknown[], sink: Sink): Promise<RunResult> =>
      new Promise<RunResult>((resolve, reject) => {
        if (dead) return reject(new Error('Connection is closed.'));
        let settled = false;
        let sawColumns = false;
        let extraResult = false;
        let changes: number | null = null;
        const finish = (r: RunResult | Error): void => {
          if (settled) return;
          settled = true;
          if (r instanceof Error) reject(r);
          else resolve(r);
        };
        // 값이 없으면 values 를 넘기지 않는다(사용자 SQL 의 ? 글자를 건드리지 않게)
        const q = conn.query({ sql, ...(params.length > 0 ? { values: [...params] } : {}), rowsAsArray: true });
        q.on('fields', (fields: readonly { readonly name: string }[]) => {
          // 저장 프로시저는 결과를 여러 개 줄 수 있다: 첫 결과만 보인다
          if (sawColumns) {
            extraResult = true;
            return;
          }
          sawColumns = true;
          sink.columns(fields.map((f) => f.name));
        });
        q.on('result', (row: unknown) => {
          if (settled) return;
          if (!Array.isArray(row)) {
            const affected = (row as { affectedRows?: unknown }).affectedRows;
            if (typeof affected === 'number') changes = (changes ?? 0) + affected;
            return;
          }
          if (extraResult) return;
          if (!sink.row(row)) {
            destroy();
            finish({ changes: null, stopped: true });
          }
        });
        q.on('error', (e: Error) => finish(e));
        q.on('end', () => finish({ changes, stopped: false }));
      });
    // SELECT 가 서버에서도 시간 제한에 멈추게 한다(MySQL 5.7.8+. MariaDB 등 없는 서버는 넘어간다)
    await run(`SET SESSION max_execution_time = ${Math.max(1, Math.floor(o.statementTimeoutMs))}`, [], { columns: () => undefined, row: () => true }).catch(() => undefined);
    return {
      run,
      close: () =>
        new Promise<void>((resolve) => {
          if (dead) return resolve();
          dead = true;
          conn.end(() => resolve());
        }),
      destroy,
    };
  },
};

/** 날짜·시간 형식(OID)은 서버가 준 글 그대로 둔다(시간대를 바꾸지 않게) */
const PG_DATE_TYPES: ReadonlySet<number> = new Set([1082, 1083, 1114, 1184, 1266]);

export const postgresDriver: ServerDriver = {
  async connect(o) {
    const pg = (await import('pg')).default;
    const t = o.target;
    const ssl = sslOptionsFor(t);
    const client = new pg.Client({
      host: t.host.replace(/^\[|\]$/g, ''),
      port: t.port,
      user: t.user,
      password: o.password,
      database: t.database,
      ssl: ssl === null ? false : { rejectUnauthorized: ssl.rejectUnauthorized, ...(ssl.ca === undefined ? {} : { ca: [...ssl.ca] }) },
      connectionTimeoutMillis: o.connectTimeoutMs,
      // statement_timeout 은 시작 파라미터로 보내지 않는다: PgBouncer·RDS Proxy 같은 풀러가
      // "unsupported startup parameter: statement_timeout" 으로 접속째 거절한다. 붙은 뒤 SET 으로 건다(아래)
      application_name: 'rauha',
      types: { getTypeParser: ((oid: number, format?: 'text' | 'binary') => (PG_DATE_TYPES.has(oid) ? (v: string) => v : pg.types.getTypeParser(oid, format ?? 'text'))) as typeof pg.types.getTypeParser },
    });
    client.on('error', () => undefined);
    await client.connect();
    // 서버에서도 문장을 시간 제한에 멈춘다. 풀러가 SET 을 막으면 건너뛴다(앱 쪽 시간 제한은 그대로 걸린다)
    await client.query(`SET statement_timeout = ${Math.max(1, Math.floor(o.statementTimeoutMs))}`).catch(() => undefined);
    let dead = false;
    const destroy = (): void => {
      dead = true;
      (client as unknown as { connection?: { stream?: { destroy(): void } } }).connection?.stream?.destroy();
      void client.end().catch(() => undefined);
    };
    return {
      run: (sql, params, sink) =>
        new Promise<RunResult>((resolve, reject) => {
          if (dead) return reject(new Error('Connection is closed.'));
          let settled = false;
          let sawColumns = false;
          const finish = (r: RunResult | Error): void => {
            if (settled) return;
            settled = true;
            if (r instanceof Error) reject(r);
            else resolve(r);
          };
          // extended: 서버가 여러 문장을 한 번에 받지 않는다
          const q = new pg.Query({ text: sql, ...(params.length > 0 ? { values: [...params] } : {}), rowMode: 'array', queryMode: 'extended' } as ConstructorParameters<typeof pg.Query>[0]);
          q.on('row', (row: unknown, result?: { readonly fields?: readonly { readonly name: string }[] }) => {
            if (settled) return;
            if (!sawColumns) {
              sawColumns = true;
              sink.columns((result?.fields ?? []).map((f) => f.name));
            }
            if (!sink.row(row as readonly unknown[])) {
              destroy();
              finish({ changes: null, stopped: true });
            }
          });
          q.on('error', (e: Error) => finish(e));
          q.on('end', (result: { readonly fields?: readonly { readonly name: string }[]; readonly rowCount?: number | null }) => {
            if (!sawColumns && (result.fields?.length ?? 0) > 0) sink.columns(result.fields!.map((f) => f.name));
            finish({ changes: typeof result.rowCount === 'number' ? result.rowCount : null, stopped: false });
          });
          client.query(q);
        }),
      close: async () => {
        if (dead) return;
        dead = true;
        await client.end().catch(() => undefined);
      },
      destroy,
    };
  },
};
