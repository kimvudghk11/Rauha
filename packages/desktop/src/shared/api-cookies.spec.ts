import { describe, expect, it } from 'vitest';
import { CookieJar } from './api-cookies.js';

const T = Date.parse('2026-11-14T00:00:00Z');

describe('CookieJar — Postman 처럼 도메인별로 쿠키를 기억해 다음 요청에 붙인다', () => {
  it('응답의 Set-Cookie 를 기억했다가 같은 호스트로 가는 요청에 붙인다', () => {
    const jar = CookieJar.empty().store('http://localhost:4510/login', ['sid=abc; Path=/; HttpOnly', 'theme=dark'], T);
    expect(jar.header('http://localhost:4510/me', T)).toBe('sid=abc; theme=dark');
    expect(jar.header('http://127.0.0.1:4510/me', T)).toBeNull();
  });

  it('같은 이름은 새 값으로 바꾸고, Max-Age=0 이나 지난 Expires 는 지운다', () => {
    let jar = CookieJar.empty().store('http://a.test/', ['sid=1'], T);
    jar = jar.store('http://a.test/', ['sid=2'], T);
    expect(jar.header('http://a.test/', T)).toBe('sid=2');
    jar = jar.store('http://a.test/', ['sid=; Max-Age=0'], T);
    expect(jar.header('http://a.test/', T)).toBeNull();
    jar = jar.store('http://a.test/', ['old=1; Expires=Wed, 21 Oct 2015 07:28:00 GMT'], T);
    expect(jar.size(T)).toBe(0);
  });

  it('Max-Age 가 지나면 보내지 않는다', () => {
    const jar = CookieJar.empty().store('http://a.test/', ['s=1; Max-Age=60'], T);
    expect(jar.header('http://a.test/', T + 59_000)).toBe('s=1');
    expect(jar.header('http://a.test/', T + 61_000)).toBeNull();
  });

  it('Domain 이 있으면 하위 도메인에도 보내고, 남의 도메인 Domain 은 받지 않는다', () => {
    const jar = CookieJar.empty().store('https://api.shop.test/login', ['a=1; Domain=.shop.test', 'evil=1; Domain=other.test'], T);
    expect(jar.header('https://www.shop.test/', T)).toBe('a=1');
    expect(jar.header('https://other.test/', T)).toBeNull();
  });

  it('Path 아래로만 보내고, 긴 경로 쿠키를 먼저 쓴다', () => {
    const jar = CookieJar.empty().store('http://a.test/api/login', ['x=root; Path=/', 'y=api; Path=/api'], T);
    expect(jar.header('http://a.test/api/users', T)).toBe('y=api; x=root');
    expect(jar.header('http://a.test/web', T)).toBe('x=root');
    expect(jar.header('http://a.test/apiary', T)).toBe('x=root');
  });

  it('Secure 쿠키는 https 로만 보낸다(이 컴퓨터 주소는 예외)', () => {
    const jar = CookieJar.empty().store('https://a.test/', ['s=1; Secure'], T).store('http://localhost/', ['l=1; Secure'], T);
    expect(jar.header('http://a.test/', T)).toBeNull();
    expect(jar.header('https://a.test/', T)).toBe('s=1');
    expect(jar.header('http://localhost/', T)).toBe('l=1');
  });

  it('목록은 도메인·이름·만료를 보이고 값은 앞부분만, 비우기와 도메인별 지우기가 된다', () => {
    const jar = CookieJar.empty().store('http://a.test/', ['sid=abcdefghijklmnop; HttpOnly'], T).store('http://b.test/', ['k=v'], T);
    expect(jar.list(T)).toEqual([
      { domain: 'a.test', name: 'sid', value: 'abcd…', path: '/', expires: null, httpOnly: true, secure: false },
      { domain: 'b.test', name: 'k', value: 'v', path: '/', expires: null, httpOnly: false, secure: false },
    ]);
    expect(jar.removeDomain('a.test').size(T)).toBe(1);
    expect(jar.clear().size(T)).toBe(0);
  });

  it('깨진 Set-Cookie 는 버리고, 한 도메인에 너무 많이 쌓이지 않는다', () => {
    let jar = CookieJar.empty().store('http://a.test/', ['', '=novalue', 'ok=1'], T);
    expect(jar.header('http://a.test/', T)).toBe('ok=1');
    jar = jar.store('http://a.test/', Array.from({ length: 80 }, (_, i) => `c${i}=1`), T);
    expect(jar.size(T)).toBeLessThanOrEqual(50);
  });
});
