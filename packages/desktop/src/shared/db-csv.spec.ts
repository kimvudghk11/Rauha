import { describe, expect, it } from 'vitest';
import { csvFileName, toCsv } from './db-csv.js';

describe('CSV 내보내기', () => {
  it('머리줄 + 행을 CRLF 로 잇고, 쉼표·따옴표·줄바꿈이 든 칸은 따옴표로 감싼다', () => {
    const csv = toCsv(['id', 'name'], [[1, 'a,b'], [2, 'say "hi"'], [3, 'two\nlines'], [4, null]]);
    expect(csv).toBe('id,name\r\n1,"a,b"\r\n2,"say ""hi"""\r\n3,"two\nlines"\r\n4,\r\n');
  });
  it('엑셀이 수식으로 읽는 글(= + - @ 탭 CR 로 시작하는 문자열)은 작은따옴표를 앞에 붙여 무력화한다', () => {
    const csv = toCsv(['x'], [['=HYPERLINK("http://evil","x")'], ['+1+1'], ['-2+3'], ['@SUM(A1)'], ['\tcmd'], ['normal']]);
    const lines = csv.split('\r\n');
    expect(lines[1]).toBe(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(lines[2]).toBe("'+1+1");
    expect(lines[3]).toBe("'-2+3");
    expect(lines[4]).toBe("'@SUM(A1)");
    expect(lines[5]).toBe("'\tcmd");
    expect(lines[6]).toBe('normal');
  });
  it('진짜 숫자(음수 포함)는 그대로 두고, BLOB 은 크기 표시로 쓴다', () => {
    expect(toCsv(['n', 'b'], [[-5, { blob: 3, preview: 'x\'0A0B0C\'' }]])).toBe("n,b\r\n-5,<BLOB 3 bytes>\r\n");
  });
  it('머리줄(열 이름)에도 같은 수식 무력화를 쓴다', () => {
    expect(toCsv(['=evil'], [])).toBe("'=evil\r\n");
  });
  it('파일 이름은 안전한 글자만 남기고 .csv 로 끝낸다', () => {
    expect(csvFileName('users')).toBe('users.csv');
    expect(csvFileName('a/b\\c:d*?"<>|')).toBe('a_b_c_d______.csv');
    expect(csvFileName('')).toBe('result.csv');
    expect(csvFileName('x'.repeat(200)).length).toBeLessThanOrEqual(84);
  });
});
