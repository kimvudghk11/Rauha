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
