import { describe, expect, it } from 'vitest';
import { ConnectionId, DbFilePath, DbInputError, PageNumber, quoteIdent, SortSpec, TableName } from './db-names.js';

describe('DB 파일 경로 값 객체', () => {
  it('절대 경로(윈도우 드라이브·POSIX)만 받는다', () => {
    expect(DbFilePath.parse('C:\\Users\\me\\data\\app.db').value).toBe('C:\\Users\\me\\data\\app.db');
    expect(DbFilePath.parse('C:/data/app.sqlite').value).toBe('C:/data/app.sqlite');
    expect(DbFilePath.parse('/home/me/app.db').value).toBe('/home/me/app.db');
    expect(DbFilePath.parse('  /home/me/app.db  ').value).toBe('/home/me/app.db');
  });
  it('상대 경로·.. 조각·옵션처럼 읽히는 값은 거절한다', () => {
    for (const bad of ['app.db', './app.db', '../app.db', '/a/../b/app.db', 'C:\\a\\..\\b.db', '-f', '~/app.db', 'C:app.db']) expect(() => DbFilePath.parse(bad), bad).toThrow(DbInputError);
  });
  it('네트워크(UNC)·장치·확장 경로·주소(URL·연결 문자열)는 거절한다(SMB 로 자격 증명이 새는 것을 막는다)', () => {
    for (const bad of ['\\\\server\\share\\a.db', '//server/share/a.db', '\\\\?\\C:\\a.db', '\\\\.\\PhysicalDrive0', '//./pipe/x', 'file:///etc/passwd', 'http://x/a.db', 'postgres://u:p@h/db']) expect(() => DbFilePath.parse(bad), bad).toThrow(DbInputError);
  });
  it('NUL·제어 문자·빈 값·글이 아닌 값·너무 긴 값은 거절한다', () => {
    for (const bad of ['/a/b\0.db', '/a/b\n.db', '/a/b\t.db', '', '   ', undefined, 5, null, {}, '/' + 'a'.repeat(1100)]) expect(() => DbFilePath.parse(bad), String(bad)).toThrow(DbInputError);
  });
  it('폴더처럼 끝나거나 이름이 없는 경로는 거절한다', () => {
    for (const bad of ['/home/me/', 'C:\\data\\', 'C:\\', '/']) expect(() => DbFilePath.parse(bad), bad).toThrow(DbInputError);
  });
  it('보이는 이름은 파일 이름만이다', () => {
    expect(DbFilePath.parse('C:\\data\\shop.db').fileName()).toBe('shop.db');
    expect(DbFilePath.parse('/data/shop.sqlite3').fileName()).toBe('shop.sqlite3');
  });
});

describe('연결 id', () => {
  it('영문·숫자·-·_ 로 된 짧은 값만 받는다', () => {
    expect(ConnectionId.parse('a1-b2_c3').value).toBe('a1-b2_c3');
    for (const bad of ['', 'a b', '../x', 'a/b', 'x'.repeat(80), 5, undefined, 'a\0']) expect(() => ConnectionId.parse(bad), String(bad)).toThrow(DbInputError);
  });
});

describe('테이블 이름·정렬·쪽', () => {
  it('테이블 이름은 어떤 글자든 받되(SQLite 가 그렇다) NUL·빈 값·너무 긴 값은 거절한다', () => {
    expect(TableName.parse('order items').value).toBe('order items');
    expect(TableName.parse('주문"; DROP TABLE x;--').value).toBe('주문"; DROP TABLE x;--');
    for (const bad of ['', '   ', 'a\0b', 'x'.repeat(300), 5, undefined]) expect(() => TableName.parse(bad), String(bad)).toThrow(DbInputError);
  });
  it('식별자 인용은 따옴표를 두 번 쓴다', () => {
    expect(quoteIdent('a')).toBe('"a"');
    expect(quoteIdent('a"b')).toBe('"a""b"');
    expect(quoteIdent('x"; DROP TABLE t;--')).toBe('"x""; DROP TABLE t;--"');
    expect(() => quoteIdent('a\0b')).toThrow(DbInputError);
  });
  it('쪽 번호는 0 이상 정수만 받고 비어 있으면 0이다', () => {
    expect(PageNumber.parse(undefined).value).toBe(0);
    expect(PageNumber.parse(3).value).toBe(3);
    for (const bad of [-1, 1.5, '2', NaN, Infinity, 10_000_000]) expect(() => PageNumber.parse(bad), String(bad)).toThrow(DbInputError);
  });
  it('정렬은 열 이름과 방향(asc·desc)만 받고 없으면 null 이다', () => {
    expect(SortSpec.parse(undefined)).toBeNull();
    expect(SortSpec.parse(null)).toBeNull();
    expect(SortSpec.parse({ column: 'name', dir: 'desc' })).toMatchObject({ column: 'name', dir: 'desc' });
    for (const bad of [{ column: 'name', dir: 'DESC; DROP' }, { column: '', dir: 'asc' }, { dir: 'asc' }, 'name', { column: 'a\0', dir: 'asc' }]) expect(() => SortSpec.parse(bad), JSON.stringify(bad)).toThrow(DbInputError);
  });
});
