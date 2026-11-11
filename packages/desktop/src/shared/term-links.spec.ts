import { describe, expect, it } from 'vitest';
import { findPathLinks, resolveTermPath } from './term-links.js';

describe('터미널 출력의 파일 경로 링크 찾기', () => {
  it('경로:줄:칸 을 찾아 경로·줄·칸으로 나눈다', () => {
    const [l] = findPathLinks('error in src/main/main.ts:12:5 here');
    expect(l).toMatchObject({ path: 'src/main/main.ts', line: 12, column: 5, start: 9 });
    expect(l?.end).toBe(9 + 'src/main/main.ts:12:5'.length);
  });

  it('TypeScript 컴파일러 형식 경로(줄,칸)도 읽는다', () => {
    const [l] = findPathLinks('src/a.ts(10,3): error TS2322');
    expect(l).toMatchObject({ path: 'src/a.ts', line: 10, column: 3 });
  });

  it('Windows 절대 경로와 ./ 상대 경로를 찾는다', () => {
    const links = findPathLinks('C:\\work\\app\\a.ts:3 and ./b.js:4:1');
    expect(links.map((l) => l.path)).toEqual(['C:\\work\\app\\a.ts', './b.js']);
  });

  it('경로 구분자가 없으면 알려진 코드 확장자일 때만 링크로 본다', () => {
    expect(findPathLinks('open index.ts now').map((l) => l.path)).toEqual(['index.ts']);
    expect(findPathLinks('e.g. version 1.2.3 and foo.bar')).toEqual([]);
  });

  it('URL 안의 경로는 파일 링크로 보지 않는다', () => {
    expect(findPathLinks('see https://example.com/docs/a.html:80 ok')).toEqual([]);
  });

  it('줄 번호가 없어도 경로만으로 링크가 된다', () => {
    expect(findPathLinks('wrote dist/app.js')[0]).toMatchObject({ path: 'dist/app.js', line: 1, column: 1 });
  });
});

describe('터미널 링크 경로를 작업 폴더 기준 상대 경로로 바꾸기', () => {
  it('상대 경로는 터미널을 연 폴더(베이스) 기준으로 합친다', () => {
    expect(resolveTermPath('src/a.ts', 'C:\\work', 'repo', 'win32')).toBe('repo/src/a.ts');
    expect(resolveTermPath('./a.ts', 'C:\\work', '', 'win32')).toBe('a.ts');
  });

  it('작업 폴더 밖으로 나가는 ..는 거절한다', () => {
    expect(resolveTermPath('../../etc/passwd', '/w', 'repo', 'linux')).toBeNull();
  });

  it('절대 경로는 작업 폴더 안일 때만 상대 경로로 바꾼다(Windows는 대소문자·역슬래시 무시)', () => {
    expect(resolveTermPath('C:\\Work\\app\\a.ts', 'c:\\work', '', 'win32')).toBe('app/a.ts');
    expect(resolveTermPath('C:\\other\\a.ts', 'C:\\work', '', 'win32')).toBeNull();
    expect(resolveTermPath('/w/repo/a.ts', '/w', '', 'darwin')).toBe('repo/a.ts');
    expect(resolveTermPath('/W/repo/a.ts', '/w', '', 'darwin')).toBeNull();
  });

  it('작업 폴더 이름만 앞부분이 같은 다른 폴더(/work2)는 안으로 보지 않는다', () => {
    expect(resolveTermPath('/work2/a.ts', '/work', '', 'linux')).toBeNull();
  });

  it('홈(~) 경로와 빈 경로는 거절한다', () => {
    expect(resolveTermPath('~/a.ts', '/w', '', 'linux')).toBeNull();
    expect(resolveTermPath('', '/w', '', 'linux')).toBeNull();
  });
});
