import { describe, expect, it } from 'vitest';
import { isAppPage, isSafeExternalUrl } from './navigation-guard.js';

describe('isSafeExternalUrl', () => {
  it('https 주소만 기본 브라우저로 연다', () => {
    expect(isSafeExternalUrl('https://github.com/a/b/compare/x...y?expand=1')).toBe(true);
    for (const bad of ['http://example.com', 'file:///C:/Windows/System32/calc.exe', 'javascript:alert(1)', 'ms-msdt:/id x', 'vscode://file/x', 'smb://host/share', '\\\\host\\share\\x.exe', '']) {
      expect(isSafeExternalUrl(bad), bad).toBe(false);
    }
  });

  it('사용자 정보가 든 주소와 문자열이 아닌 값, 너무 긴 주소는 열지 않는다', () => {
    expect(isSafeExternalUrl('https://github.com@evil.example/x')).toBe(false);
    expect(isSafeExternalUrl('https://user:pw@example.com/')).toBe(false);
    expect(isSafeExternalUrl(null)).toBe(false);
    expect(isSafeExternalUrl({})).toBe(false);
    expect(isSafeExternalUrl(`https://example.com/${'a'.repeat(3000)}`)).toBe(false);
  });
});

describe('isAppPage', () => {
  const page = 'file:///C:/Program%20Files/Rauha/resources/app/dist/renderer/index.html';

  it('앱 화면 파일을 다시 읽는 것(쿼리·해시만 다른 것)만 허용한다', () => {
    expect(isAppPage(`${page}?platform=darwin`, page)).toBe(true);
    expect(isAppPage(`${page}#x`, page)).toBe(true);
  });

  it('다른 파일, 웹 주소, 깨진 주소는 허용하지 않는다', () => {
    expect(isAppPage('file:///C:/Users/me/evil.html', page)).toBe(false);
    expect(isAppPage('https://example.com/', page)).toBe(false);
    expect(isAppPage('not a url', page)).toBe(false);
  });
});
