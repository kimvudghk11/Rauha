/**
 * API 탭의 쿠키 저장소(Postman 의 Cookie jar). 응답의 Set-Cookie 를 도메인·경로별로 기억했다가 맞는 요청에 붙인다.
 * 앱을 끄면 사라진다(디스크에 남기지 않는다: 세션 쿠키는 비밀이다). 불변 값 객체.
 */

export interface StoredCookie {
  readonly name: string;
  readonly value: string;
  /** 소문자 호스트(앞 점 없음) */
  readonly domain: string;
  /** Domain 속성이 없었다: 정확히 그 호스트에만 보낸다 */
  readonly hostOnly: boolean;
  readonly path: string;
  /** 만료 시각(ms). null 이면 앱이 켜져 있는 동안 */
  readonly expires: number | null;
  readonly secure: boolean;
  readonly httpOnly: boolean;
}

export interface CookieView {
  readonly domain: string;
  readonly name: string;
  /** 앞 4글자만(비밀일 수 있다) */
  readonly value: string;
  readonly path: string;
  readonly expires: string | null;
  readonly httpOnly: boolean;
  readonly secure: boolean;
}

const LIMITS = { perDomain: 50, total: 500, value: 4096 } as const;
const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|::1)$/i;

const parseUrl = (url: string): URL | null => {
  try {
    return new URL(url);
  } catch {
    return null;
  }
};

/** 요청 경로의 "디렉터리"(RFC 6265 기본 경로) */
const defaultPath = (pathname: string): string => {
  if (!pathname.startsWith('/')) return '/';
  const i = pathname.lastIndexOf('/');
  return i <= 0 ? '/' : pathname.slice(0, i);
};

const domainMatch = (host: string, domain: string): boolean => host === domain || (host.endsWith(`.${domain}`) && !/^\d+\.\d+\.\d+\.\d+$/.test(host));
const pathMatch = (reqPath: string, cookiePath: string): boolean => reqPath === cookiePath || (reqPath.startsWith(cookiePath) && (cookiePath.endsWith('/') || reqPath[cookiePath.length] === '/'));

function parseSetCookie(line: string, url: URL, now: number): StoredCookie | null {
  const [pair = '', ...attrs] = line.split(';');
  const eq = pair.indexOf('=');
  if (eq <= 0) return null;
  const name = pair.slice(0, eq).trim();
  const value = pair.slice(eq + 1).trim();
  if (name === '' || value.length > LIMITS.value) return null;
  const host = url.hostname.toLowerCase();
  let domain = host;
  let hostOnly = true;
  let path = defaultPath(url.pathname);
  let expires: number | null = null;
  let maxAge: number | null = null;
  let secure = false;
  let httpOnly = false;
  for (const a of attrs) {
    const i = a.indexOf('=');
    const k = (i === -1 ? a : a.slice(0, i)).trim().toLowerCase();
    const v = i === -1 ? '' : a.slice(i + 1).trim();
    if (k === 'domain' && v !== '') {
      const d = v.replace(/^\./, '').toLowerCase();
      if (!domainMatch(host, d)) return null;
      domain = d;
      hostOnly = false;
    } else if (k === 'path' && v.startsWith('/')) path = v;
    else if (k === 'expires') {
      const t = Date.parse(v);
      if (!Number.isNaN(t)) expires = t;
    } else if (k === 'max-age' && /^-?\d+$/.test(v)) maxAge = Number(v);
    else if (k === 'secure') secure = true;
    else if (k === 'httponly') httpOnly = true;
  }
  if (maxAge !== null) expires = now + maxAge * 1000;
  return { name, value, domain, hostOnly, path, expires, secure, httpOnly };
}

const sameKey = (a: StoredCookie, b: StoredCookie): boolean => a.name === b.name && a.domain === b.domain && a.path === b.path;
const alive = (c: StoredCookie, now: number): boolean => c.expires === null || c.expires > now;

export class CookieJar {
  private constructor(private readonly cookies: readonly StoredCookie[]) {}

  static empty(): CookieJar {
    return new CookieJar([]);
  }

  /** 응답(리다이렉트 포함)의 Set-Cookie 줄들을 기억한다. 만료된 쿠키는 그 자리에서 지운다 */
  store(url: string, setCookies: readonly string[], now: number): CookieJar {
    const u = parseUrl(url);
    if (u === null || setCookies.length === 0) return this;
    let list = this.cookies.filter((c) => alive(c, now));
    for (const line of setCookies) {
      const c = parseSetCookie(line, u, now);
      if (c === null) continue;
      list = list.filter((x) => !sameKey(x, c));
      if (alive(c, now)) list.push(c);
    }
    // 도메인마다·전체 개수 상한: 오래된 것부터 버린다
    const counts = new Map<string, number>();
    const kept: StoredCookie[] = [];
    for (let i = list.length - 1; i >= 0; i--) {
      const c = list[i] as StoredCookie;
      const n = counts.get(c.domain) ?? 0;
      if (n >= LIMITS.perDomain || kept.length >= LIMITS.total) continue;
      counts.set(c.domain, n + 1);
      kept.unshift(c);
    }
    return new CookieJar(kept);
  }

  /** 이 주소로 갈 Cookie 헤더 값(없으면 null). 긴 경로 쿠키가 앞이다 */
  header(url: string, now: number): string | null {
    const u = parseUrl(url);
    if (u === null) return null;
    const host = u.hostname.toLowerCase();
    const https = u.protocol === 'https:' || LOCAL_HOST.test(host);
    const match = this.cookies
      .filter((c) => alive(c, now) && (c.hostOnly ? host === c.domain : domainMatch(host, c.domain)) && pathMatch(u.pathname || '/', c.path) && (!c.secure || https))
      .sort((a, b) => b.path.length - a.path.length);
    return match.length === 0 ? null : match.map((c) => `${c.name}=${c.value}`).join('; ');
  }

  size(now: number): number {
    return this.cookies.filter((c) => alive(c, now)).length;
  }

  /** 화면용 목록: 값은 앞 4글자만 */
  list(now: number): CookieView[] {
    return this.cookies
      .filter((c) => alive(c, now))
      .map((c) => ({ domain: c.domain, name: c.name, value: c.value.length > 4 ? `${c.value.slice(0, 4)}…` : c.value, path: c.path, expires: c.expires === null ? null : new Date(c.expires).toISOString(), httpOnly: c.httpOnly, secure: c.secure }))
      .sort((a, b) => a.domain.localeCompare(b.domain) || a.name.localeCompare(b.name));
  }

  removeDomain(domain: string): CookieJar {
    return new CookieJar(this.cookies.filter((c) => c.domain !== domain.toLowerCase()));
  }

  clear(): CookieJar {
    return CookieJar.empty();
  }
}
