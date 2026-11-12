import { describe, expect, it } from 'vitest';
import type { DbResultSet } from './db-api.js';
import { cellClass, cellCopyText, cellDetail, cellText, filterTables, formatBytes, nextSort, pageLabel, pageCount, resultLine, rowsAsTsv, sqlPreview, sslHelp, truncationNote, browseSql, viaLine, viaShort } from './db-view-text.js';

const result = (o: Partial<DbResultSet> = {}): DbResultSet => ({ columns: ['a'], rows: [[1], [2], [3]], truncated: null, cellsTruncated: false, bytes: 120, elapsedMs: 12, changes: null, kind: 'read', verb: 'SELECT', ...o });

describe('칸 표시', () => {
  it('NULL·숫자·글·BLOB 을 글로 바꾸고 종류별 클래스를 준다', () => {
    expect(cellText(null)).toBe('NULL');
    expect(cellText(5)).toBe('5');
    expect(cellText('a')).toBe('a');
    expect(cellText({ blob: 3, preview: "x'00'" })).toBe('<BLOB 3 bytes>');
    expect(cellClass(null)).toBe('null');
    expect(cellClass(5)).toBe('num');
    expect(cellClass('a')).toBe('text');
    expect(cellClass({ blob: 1, preview: '' })).toBe('blob');
  });
  it('빈 글은 빈 칸으로 보이지 않게 (empty) 대신 그대로 두되 NULL 과 구별된다', () => {
    expect(cellText('')).toBe('');
    expect(cellText(null)).not.toBe(cellText(''));
  });
});

describe('크기·결과 줄', () => {
  it('바이트를 B · KB · MB 로 줄여 쓴다', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(999)).toBe('999 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
  it('읽기 결과는 행 수·시간·크기, 쓰기 결과는 바뀐 행 수와 시간이다', () => {
    expect(resultLine(result())).toBe('3 rows · 12 ms · 120 B');
    expect(resultLine(result({ rows: [[1]] }))).toBe('1 row · 12 ms · 120 B');
    expect(resultLine(result({ rows: [], columns: [], kind: 'write', changes: 4, verb: 'DELETE' }))).toBe('DELETE: 4 rows changed · 12 ms');
    expect(resultLine(result({ rows: [], columns: [], kind: 'write', changes: 1, verb: 'INSERT' }))).toBe('INSERT: 1 row changed · 12 ms');
    expect(resultLine(result({ rows: [], columns: [], kind: 'schema', changes: 0, verb: 'CREATE' }))).toBe('CREATE: done · 12 ms');
  });
  it('잘린 결과는 이유와 해결 방법을 알려 준다', () => {
    expect(truncationNote(result())).toBeNull();
    expect(truncationNote(result({ truncated: 'rows' }))).toMatch(/first 5,000 rows/);
    expect(truncationNote(result({ truncated: 'bytes' }))).toMatch(/5 MB/);
    expect(truncationNote(result({ cellsTruncated: true }))).toMatch(/long values/);
  });
});

describe('쪽 표시와 정렬 순환', () => {
  it('행 범위와 쪽 수를 보인다', () => {
    expect(pageCount(0, 100)).toBe(1);
    expect(pageCount(250, 100)).toBe(3);
    expect(pageLabel(0, 250, 100)).toBe('Rows 1–100 of 250 · page 1 of 3');
    expect(pageLabel(2, 250, 100)).toBe('Rows 201–250 of 250 · page 3 of 3');
    expect(pageLabel(0, 0, 100)).toBe('No rows');
  });
  it('열 머리를 누를 때마다 오름 → 내림 → 정렬 없음, 다른 열이면 오름부터', () => {
    expect(nextSort(null, 'a')).toEqual({ column: 'a', dir: 'asc' });
    expect(nextSort({ column: 'a', dir: 'asc' }, 'a')).toEqual({ column: 'a', dir: 'desc' });
    expect(nextSort({ column: 'a', dir: 'desc' }, 'a')).toBeNull();
    expect(nextSort({ column: 'a', dir: 'desc' }, 'b')).toEqual({ column: 'b', dir: 'asc' });
  });
});

describe('확인 창 SQL 미리보기', () => {
  it('길면 앞부분만 보이고 줄임 표시를 붙인다', () => {
    expect(sqlPreview('DELETE FROM t')).toBe('DELETE FROM t');
    const long = sqlPreview('x'.repeat(2000));
    expect(long.length).toBeLessThan(700);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('테이블 찾기', () => {
  const list = [
    { name: 'users', kind: 'table' as const },
    { name: 'user_roles', kind: 'table' as const },
    { name: 'Orders', kind: 'table' as const },
    { name: 'active_users', kind: 'view' as const },
  ];
  it('대소문자를 무시하고 이름에 글이 들어간 것만, 이름 앞부분이 맞는 것을 먼저 보인다', () => {
    expect(filterTables(list, 'USER').map((t) => t.name)).toEqual(['users', 'user_roles', 'active_users']);
    expect(filterTables(list, 'ord').map((t) => t.name)).toEqual(['Orders']);
  });
  it('빈 글이면 그대로 둔다', () => {
    expect(filterTables(list, '  ')).toEqual(list);
  });
});

describe('SSL 설명', () => {
  it('고른 SSL 마다 무엇을 하는지 한 줄로 알려 준다', () => {
    expect(sslHelp('off', 'localhost')).toMatch(/not encrypted/i);
    expect(sslHelp('require', 'db.example.com')).toMatch(/does not check/i);
    expect(sslHelp('verify', 'db.example.com')).toMatch(/certificate/i);
  });
  it('RDS 호스트면 SSL 을 권하고, 인증서 확인을 고르면 Amazon RDS CA 를 믿는다고 알려 준다', () => {
    expect(sslHelp('off', 'a.b.ap-northeast-2.rds.amazonaws.com')).toMatch(/RDS/);
    expect(sslHelp('verify', 'a.b.ap-northeast-2.rds.amazonaws.com')).toMatch(/Amazon RDS/);
  });
});

describe('칸 상세', () => {
  it('JSON 글이면 보기 좋게 펼치고, 아니면 그대로 둔다', () => {
    expect(cellDetail('{"a":1,"b":[1,2]}')).toBe('{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}');
    expect(cellDetail('plain text')).toBe('plain text');
    expect(cellDetail('{broken')).toBe('{broken');
    expect(cellDetail(null)).toBe('NULL');
    expect(cellDetail(42)).toBe('42');
  });
  it('복사할 글: NULL 은 빈 글이 아니라 NULL, BLOB 은 미리보기', () => {
    expect(cellCopyText(null)).toBe('NULL');
    expect(cellCopyText({ blob: 3, preview: "x'010203'" })).toBe("x'010203'");
    expect(cellCopyText('a')).toBe('a');
  });
});

describe('행 복사', () => {
  it('고른 행을 탭으로 나눈 글로 만든다(엑셀·시트에 붙여 넣기)', () => {
    expect(rowsAsTsv(['a', 'b'], [[1, null], ['x\ty', 'z']], true)).toBe('a\tb\n1\tNULL\nx y\tz');
    expect(rowsAsTsv(['a'], [[1]], false)).toBe('1');
  });
});

describe('테이블을 누르면 넣을 SQL', () => {
  it('방언에 맞게 이름을 감싸 SELECT * … LIMIT 100 을 만든다', () => {
    expect(browseSql('sqlite', 'users')).toBe('SELECT * FROM "users" LIMIT 100;');
    expect(browseSql('postgres', 'Order "x"')).toBe('SELECT * FROM "Order ""x""" LIMIT 100;');
    expect(browseSql('mysql', 'we`ird')).toBe('SELECT * FROM `we``ird` LIMIT 100;');
    expect(browseSql('mysql', 'users', 20)).toBe('SELECT * FROM `users` LIMIT 20;');
  });
});

describe('붙은 주소 표시', () => {
  it('주소가 여럿이면 몇 번째·이름표·주소를, 하나면 주소만 보인다', () => {
    expect(viaLine({ index: 1, total: 2, label: 'Public', endpoint: '3.35.12.4:5432' })).toBe('Connected via #2 Public · 3.35.12.4:5432');
    expect(viaLine({ index: 0, total: 3, label: null, endpoint: '10.0.0.5:5432' })).toBe('Connected via #1 · 10.0.0.5:5432');
    expect(viaLine({ index: 0, total: 1, label: null, endpoint: 'db.local:3306' })).toBe('Connected via db.local:3306');
    expect(viaShort({ index: 1, total: 2, label: 'Public', endpoint: '3.35.12.4:5432' })).toBe('via #2 Public · 3.35.12.4:5432');
  });
});
