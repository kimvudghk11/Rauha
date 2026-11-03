import { describe, expect, it } from 'vitest';
import { BrowserNeed } from './browser-need.js';

describe('BrowserNeed', () => {
  it('요청에 주소가 있으면 답변 팀원에게 브라우저를 붙인다', () => {
    expect(BrowserNeed.wanted('answerer', 'https://example.com 이 페이지 내용 요약해줘')).toBe(true);
    expect(BrowserNeed.wanted('answerer', 'localhost:5173 지금 어떻게 보여?')).toBe(true);
    expect(BrowserNeed.wanted('answerer', '127.0.0.1:8080/admin 에 뭐 떠?')).toBe(true);
  });

  it('주소 없이 띄워 둔 웹페이지·브라우저를 가리켜도 붙인다', () => {
    expect(BrowserNeed.wanted('answerer', '지금 띄운 웹페이지 읽어줘')).toBe(true);
    expect(BrowserNeed.wanted('answerer', '브라우저에서 로그인 화면 확인해줘')).toBe(true);
    expect(BrowserNeed.wanted('debugger', '열어 둔 페이지에서 버튼이 왜 안 눌려?')).toBe(true);
    expect(BrowserNeed.wanted('answerer', 'dev 서버 화면 봐줘')).toBe(true);
  });

  it('웹페이지와 상관없는 요청에는 붙이지 않는다 (도구 설명만으로 입력이 크게 늘어서)', () => {
    expect(BrowserNeed.wanted('answerer', 'Money.add는 왜 이렇게 짰어?')).toBe(false);
    expect(BrowserNeed.wanted('answerer', '테스트 돌려봐')).toBe(false);
    expect(BrowserNeed.wanted('answerer', 'README 3페이지쯤 내용 뭐야')).toBe(false);
  });

  it('브라우저를 쓰지 않는 역할에는 주소가 있어도 붙이지 않는다', () => {
    expect(BrowserNeed.wanted('router', 'https://example.com 읽어줘')).toBe(false);
    expect(BrowserNeed.wanted('marketer', 'https://example.com 경쟁사 랜딩 보고 문구 써줘')).toBe(false);
  });

  it('화면을 다루는 디자인 팀원은 주소가 있으면 붙인다', () => {
    expect(BrowserNeed.wanted('uxdesigner', 'http://localhost:3000 화면 흐름 검토해줘')).toBe(true);
  });
});
