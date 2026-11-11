import { describe, expect, it } from 'vitest';
import type { DbResultSet } from './db-api.js';
import { cellClass, cellText, formatBytes, nextSort, pageLabel, pageCount, resultLine, sqlPreview, truncationNote } from './db-view-text.js';

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
