import { describe, expect, it } from 'vitest';
import { externalUrlOf, isAppPage, isSafeExternalUrl } from './navigation-guard.js';

describe('바깥 링크 열기: 열기 직전 주소를 다듬는다', () => {
  it('열 때는 사용자가 넘긴 글이 아니라 파싱한 주소(href)를 쓴다', () => {
    expect(externalUrlOf('https://github.com/a/b?x=1')).toBe('https://github.com/a/b?x=1');
    expect(externalUrlOf('https://example.com/a b"c')).toBe('https://example.com/a%20b%22c');
    expect(externalUrlOf('HTTPS://EXAMPLE.com')).toBe('https://example.com/');
  });
  it('안전하지 않은 주소는 null 이다', () => {
    for (const bad of ['http://a.com', 'file:///x', 'https://u:p@a.com/', 'https://a.com/\nx', 'https://a.com\\@evil.example/', 'https://a.com/\u0000', 'ms-msdt:x', 5, null]) {
      expect(externalUrlOf(bad), String(bad)).toBeNull();
      expect(isSafeExternalUrl(bad), String(bad)).toBe(false);
    }
  });
});

describe('앱 화면 판별: 다른 호스트의 같은 경로는 앱 화면이 아니다', () => {
  const page = 'file:///C:/Program%20Files/Rauha/resources/app/dist/renderer/index.html';
  it('윈도우 공유 폴더(file://호스트/...)로 같은 경로를 흉내 내도 거절한다', () => {
    expect(isAppPage('file://evil.example/C:/Program%20Files/Rauha/resources/app/dist/renderer/index.html', page)).toBe(false);
    expect(isAppPage('file://localhost/C:/Program%20Files/Rauha/resources/app/dist/renderer/index.html', page)).toBe(true);
  });
  it('점 경로(..)로 돌아 들어가거나 인코딩한 슬래시로 다른 파일을 가리키면 거절한다', () => {
    expect(isAppPage('file:///C:/Program%20Files/Rauha/resources/app/dist/renderer/../evil.html', page)).toBe(false);
    expect(isAppPage('file:///C:/Program%20Files/Rauha/resources/app/dist/renderer/index.html/../../evil.html', page)).toBe(false);
  });
});
