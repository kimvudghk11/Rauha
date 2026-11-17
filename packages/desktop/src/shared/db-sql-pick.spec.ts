import { describe, expect, it } from 'vitest';
import { statementAt } from './db-sql-pick.js';

describe('실행할 문장 고르기', () => {
  const text = 'SELECT 1;\nSELECT 2;\n\nSELECT\n  3;';
  it('고른 글이 있으면 그 글만 돌린다', () => {
    expect(statementAt(text, 0, { from: 10, to: 18 })).toBe('SELECT 2');
  });
  it('고른 글이 없으면 커서가 있는 문장 하나만 돌린다(여러 문장이 있는 편집기)', () => {
    expect(statementAt(text, 3, null)).toBe('SELECT 1;');
    expect(statementAt(text, 12, null)).toBe('SELECT 2;');
    expect(statementAt(text, text.length, null)).toBe('SELECT\n  3;');
  });
  it('커서가 세미콜론 바로 뒤(같은 줄)에 있으면 그 앞 문장이다', () => {
    expect(statementAt(text, 9, null)).toBe('SELECT 1;');
  });
  it('따옴표·주석 안의 세미콜론에서는 나누지 않는다', () => {
    const t = "SELECT ';' AS a; -- x;y\nSELECT 2";
    expect(statementAt(t, 3, null)).toBe("SELECT ';' AS a;");
    expect(statementAt(t, t.length, null)).toBe('-- x;y\nSELECT 2');
  });
  it('문장이 하나뿐이면 전부를 돌린다', () => {
    expect(statementAt('  SELECT 1  ', 0, null)).toBe('SELECT 1');
  });
});

describe('빈 줄로 나눈 문장(DBeaver 처럼 세미콜론 없이)', () => {
  const text = 'SELECT * FROM users\nWHERE id = 1\n\nSELECT * FROM orders\n\n-- 메모\nSELECT 3';

  it('커서가 있는 문단의 문장만 돌린다', () => {
    expect(statementAt(text, text.indexOf('users'), null)).toBe('SELECT * FROM users\nWHERE id = 1');
    expect(statementAt(text, text.indexOf('orders'), null)).toBe('SELECT * FROM orders');
    expect(statementAt(text, text.length, null)).toBe('-- 메모\nSELECT 3');
  });

  it('다음 문단이 SQL 낱말로 시작하지 않으면(이어지는 절) 나누지 않는다', () => {
    const one = 'SELECT *\nFROM users\n\nWHERE id = 1\n\nORDER BY id';
    expect(statementAt(one, one.indexOf('ORDER'), null)).toBe(one);
  });

  it('따옴표 안의 빈 줄에서는 나누지 않는다', () => {
    const quoted = "INSERT INTO t VALUES ('a\n\nSELECT b')";
    expect(statementAt(quoted, quoted.indexOf('b'), null)).toBe(quoted);
  });

  it('커서가 빈 줄 위면 바로 위 문장을 돌린다', () => {
    expect(statementAt(text, text.indexOf('\n\nSELECT * FROM orders') + 1, null)).toBe('SELECT * FROM users\nWHERE id = 1');
  });

  it('세미콜론으로 나눈 문장은 지금처럼 그 문장 하나', () => {
    const semi = 'SELECT 1;\nSELECT 2;';
    expect(statementAt(semi, semi.indexOf('2'), null)).toBe('SELECT 2;');
  });
});
