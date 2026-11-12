import { describe, expect, it } from 'vitest';
import type { LinkedDatabase } from '../application/linked-database.js';
import { DB_SERVER, DB_TOOLS, dbToolDescription, dbToolHandlers, dbToolServer, withDatabase } from './db-mcp.js';
import { createFetchLog } from './fetch-log.js';

function fakeDb(over: Partial<LinkedDatabase> = {}): LinkedDatabase & { calls: string[] } {
  const calls: string[] = [];
  const reply = (what: string) => async (...args: unknown[]) => {
    calls.push(`${what} ${args.map((a) => (typeof a === 'object' && a !== null ? (a as { value: string }).value : String(a))).join(' ')}`.trim());
    return { ok: true, text: `${what} done` };
  };
  return {
    dialect: 'postgres',
    name: 'shop',
    production: false,
    tables: reply('tables'),
    describe: reply('describe'),
    indexes: reply('indexes'),
    sample: reply('sample'),
    select: reply('select'),
    explain: reply('explain'),
    calls,
    ...over,
  };
}

const text = (r: { content: readonly { type: string; text?: string }[] }) => r.content.map((c) => c.text ?? '').join('');

describe('DB 도구 처리', () => {
  it('입력을 검사한 뒤에만 DB 에 묻는다', async () => {
    const db = fakeDb();
    const h = dbToolHandlers(db);
    const bad = await h.sample_rows({ table: "users'; DROP TABLE x", rows: 5 });
    expect(bad.isError).toBe(true);
    const tooMany = await h.sample_rows({ table: 'users', rows: 500 });
    expect(tooMany.isError).toBe(true);
    expect(db.calls).toEqual([]);
    await h.sample_rows({ table: 'users', rows: 3 });
    expect(db.calls).toEqual(['sample users 3']);
  });

  it('조회 도구는 EXPLAIN ANALYZE 를 DB 에 보내지 않는다', async () => {
    const db = fakeDb();
    const r = await dbToolHandlers(db).select({ sql: 'EXPLAIN ANALYZE SELECT * FROM users' });
    expect(r.isError).toBe(true);
    expect(db.calls).toEqual([]);
  });

  it('explain 은 DB 문법에 맞는 EXPLAIN 을 붙여 보낸다', async () => {
    const db = fakeDb({ dialect: 'mysql' });
    await dbToolHandlers(db).explain({ sql: 'SELECT * FROM orders WHERE user_id = 3' });
    expect(db.calls).toEqual(['explain EXPLAIN FORMAT=JSON SELECT * FROM orders WHERE user_id = 3']);
  });

  it('DB 가 실패를 돌려주면 오류로 표시한다', async () => {
    const db = fakeDb({ tables: async () => ({ ok: false, text: 'permission denied' }) });
    const r = await dbToolHandlers(db).tables({});
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('permission denied');
  });

  it('DB 가 던져도 접속 정보 없이 짧은 오류만 돌려준다', async () => {
    const db = fakeDb({ tables: async () => Promise.reject(new Error('connect ECONNREFUSED postgres://app:s3cretpw@db.internal:5432/shop')) });
    const r = await dbToolHandlers(db).tables({});
    expect(r.isError).toBe(true);
    expect(text(r)).not.toContain('s3cretpw');
    expect(text(r)).not.toContain('db.internal');
  });
});

describe('DB 도구 설명', () => {
  it('운영 DB 면 설명에 가벼운 쿼리만 쓰라고 적는다', () => {
    expect(dbToolDescription(fakeDb({ production: true }), 'Run a query.')).toMatch(/PRODUCTION/);
    expect(dbToolDescription(fakeDb(), 'Run a query.')).not.toMatch(/PRODUCTION/);
  });

  it('설명에는 DB 이름과 종류만 있다', () => {
    expect(dbToolDescription(fakeDb(), 'x')).toContain('shop');
    expect(dbToolDescription(fakeDb(), 'x')).toContain('PostgreSQL');
  });
});

describe('dbToolServer · withDatabase', () => {
  it('in-process MCP 서버 하나와 그 도구 이름들을 만든다', () => {
    const s = dbToolServer(fakeDb());
    expect(Object.keys(s.servers)).toEqual([DB_SERVER]);
    expect(s.tools).toEqual(DB_TOOLS.map((n) => `mcp__${DB_SERVER}__${n}`));
    expect((s.servers[DB_SERVER] as { type: string }).type).toBe('sdk');
  });

  it('연결된 DB 가 없으면 도구 묶음을 그대로 둔다(비용 0)', () => {
    const kits = { servers: {}, tools: [] as string[], connectorNames: [] as string[] };
    expect(withDatabase(kits, null)).toBe(kits);
  });

  it('연결된 DB 가 있으면 기존 묶음에 DB 서버와 도구를 더한다', () => {
    const kits = { servers: { aws: { type: 'http' as const, url: 'https://x' } }, tools: ['mcp__aws__a'], connectorNames: [] as string[] };
    const merged = withDatabase(kits, fakeDb());
    expect(Object.keys(merged.servers)).toEqual(['aws', DB_SERVER]);
    expect(merged.tools).toContain('mcp__aws__a');
    expect(merged.tools).toContain(`mcp__${DB_SERVER}__explain`);
  });
});

describe('DB 결과는 기록에 남지 않는다', () => {
  it('fetch 기록 훅은 DB 도구 결과(샘플 행)를 남기지 않는다', async () => {
    const log = createFetchLog();
    await log.hook({ hook_event_name: 'PostToolUse', tool_name: `mcp__${DB_SERVER}__sample_rows`, tool_input: { table: 'users' }, tool_response: [{ type: 'text', text: 'kim@example.com' }] } as never, undefined, { signal: new AbortController().signal });
    expect(log.entries()).toEqual([]);
  });
});
