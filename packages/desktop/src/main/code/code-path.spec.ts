import { describe, expect, it } from 'vitest';
import { cleanRelative, isInside } from './code-path.js';

describe('코드 탭 경로 정리', () => {
  it('빈 문자열은 작업 폴더 자신이다', () => {
    expect(cleanRelative('')).toBe('');
    expect(cleanRelative('.')).toBe('');
  });

  it('슬래시·역슬래시를 슬래시 하나로 맞추고 . 과 빈 조각을 없앤다', () => {
    expect(cleanRelative('a\\b//./c.ts')).toBe('a/b/c.ts');
  });

  it('문자열이 아니면 받지 않는다', () => {
    expect(cleanRelative(42)).toBeNull();
    expect(cleanRelative(undefined)).toBeNull();
    expect(cleanRelative({})).toBeNull();
  });

  it('위로 올라가는 .. 는 받지 않는다', () => {
    expect(cleanRelative('..')).toBeNull();
    expect(cleanRelative('a/../../b')).toBeNull();
    expect(cleanRelative('a\\..\\b')).toBeNull();
  });

  it('절대 경로·드라이브·UNC는 받지 않는다', () => {
    expect(cleanRelative('/etc/passwd')).toBeNull();
    expect(cleanRelative('C:\\Users\\x')).toBeNull();
    expect(cleanRelative('c:/x')).toBeNull();
    expect(cleanRelative('\\\\server\\share\\x')).toBeNull();
  });

  it('NUL 문자가 든 경로는 받지 않는다', () => {
    expect(cleanRelative('a\0b')).toBeNull();
  });

  it('.git 폴더 안은 대소문자와 상관없이 받지 않는다(훅 같은 실행 파일을 건드리지 못하게)', () => {
    expect(cleanRelative('.git/hooks/pre-commit')).toBeNull();
    expect(cleanRelative('repo/.GIT/config')).toBeNull();
  });

  it('.gitignore 같은 .git 으로 시작하는 다른 이름은 받는다', () => {
    expect(cleanRelative('.gitignore')).toBe('.gitignore');
    expect(cleanRelative('.github/workflows/ci.yml')).toBe('.github/workflows/ci.yml');
  });

  it('Windows가 끝의 점·공백을 지워서 .git 이 되는 우회도 막는다', () => {
    expect(cleanRelative('.git./config')).toBeNull();
    expect(cleanRelative('.git /config')).toBeNull();
  });
});

describe('작업 폴더 안인지 판정', () => {
  it('같은 폴더와 그 아래는 안이다', () => {
    expect(isInside('/w/proj', '/w/proj', false)).toBe(true);
    expect(isInside('/w/proj', '/w/proj/src/a.ts', false)).toBe(true);
  });

  it('이름만 닮은 옆 폴더는 밖이다', () => {
    expect(isInside('/w/proj', '/w/proj-other/a.ts', false)).toBe(false);
  });

  it('위 폴더나 다른 곳은 밖이다', () => {
    expect(isInside('/w/proj', '/w', false)).toBe(false);
    expect(isInside('/w/proj', '/etc/passwd', false)).toBe(false);
  });

  it('대소문자를 구분하는 곳에서는 대문자 소문자가 다른 폴더다', () => {
    expect(isInside('/w/Proj', '/w/proj/a.ts', false)).toBe(false);
  });

  it('대소문자를 무시하는 곳(Windows)에서는 같은 폴더다', () => {
    expect(isInside('C:\\w\\Proj', 'c:\\w\\proj\\a.ts', true)).toBe(true);
    expect(isInside('C:\\w\\Proj', 'D:\\w\\Proj\\a.ts', true)).toBe(false);
  });
});

describe('Windows 이름 우회 막기', () => {
  it('Windows에서는 대체 데이터 스트림(콜론)이 든 이름을 받지 않는다', () => {
    expect(cleanRelative('a/.git::$INDEX_ALLOCATION', true)).toBeNull();
    expect(cleanRelative('a/file.txt:hidden', true)).toBeNull();
    expect(cleanRelative('a/.env::$DATA', true)).toBeNull();
  });
  it('Windows에서는 CON·NUL 같은 예약 장치 이름을 받지 않는다(확장자·끝 점이 붙어도)', () => {
    for (const n of ['CON', 'nul', 'a/Aux.txt', 'COM1', 'lpt9.log', 'con.', 'COM¹', 'CONIN$']) expect(cleanRelative(n, true), n).toBeNull();
    expect(cleanRelative('console.ts', true)).toBe('console.ts');
    expect(cleanRelative('communism', true)).toBe('communism');
  });
  it('다른 OS에서는 콜론이 든 이름도 평범한 이름이지만 .git으로 이어지는 스트림 이름은 막는다', () => {
    expect(cleanRelative('a/b:c', false)).toBe('a/b:c');
    expect(cleanRelative('a/CON', false)).toBe('a/CON');
    expect(cleanRelative('a/.git::$INDEX_ALLOCATION', false)).toBeNull();
  });
});
