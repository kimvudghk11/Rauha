import { redactSecrets } from './chat-redact.js';
import { isSensitiveHeaderName } from './api-request.js';

/** API 탭이 비밀을 가린 자리에 쓰는 글자 */
export const API_HIDDEN = '[hidden]';

const SENSITIVE_WORD_RE = /(token|secret|passw|api[-_]?key|auth|session|credential)/i;
const SET_COOKIE_RE = /^set-cookie2?$/i;

/** 응답·요청 헤더 이름이 비밀 값을 나르는 것인지(Authorization·Cookie·Set-Cookie·X-Api-Key, 이름에 token·secret 등이 든 것) */
export const isSecretHeader = (name: string): boolean => isSensitiveHeaderName(name) || SET_COOKIE_RE.test(name.trim()) || SENSITIVE_WORD_RE.test(name);

/** 헤더 값 하나를 가린다. Set-Cookie는 쿠키 이름과 속성(Path 등)은 남기고 값만 가린다. */
export function maskHeaderValue(name: string, value: string): string {
  if (!isSecretHeader(name)) return value;
  if (SET_COOKIE_RE.test(name.trim())) {
    return value.replace(/^\s*([^=;\s]+)=[^;]*/, (_m, cookie: string) => `${cookie}=${API_HIDDEN}`);
  }
  if (/^cookie$/i.test(name.trim())) return value.replace(/([^=;\s]+)=[^;]*/g, (_m, cookie: string) => `${cookie}=${API_HIDDEN}`);
  const scheme = /^(Bearer|Basic|Digest|Token)\s+\S/i.exec(value.trim());
  return scheme !== null ? `${scheme[1]} ${API_HIDDEN}` : API_HIDDEN;
}

export function maskHeaders(headers: readonly (readonly [string, string])[]): [string, string][] {
  return headers.map(([k, v]) => [k, maskHeaderValue(k, v)]);
}

/**
 * 글 안에서 우리가 아는 비밀 값(환경의 비밀 변수 값·인증 값)과 토큰처럼 생긴 값을 가린다.
 * 응답 본문이 보낸 값을 그대로 돌려주는 서버(echo)가 있어도 기록·복사에 값이 남지 않게 한다.
 */
export function hideSecrets(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const s of [...secrets].filter((x) => x.length >= 4).sort((a, b) => b.length - a.length)) out = out.split(s).join(API_HIDDEN);
  return redactSecrets(out);
}
