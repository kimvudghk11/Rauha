/**
 * 요청을 보내도 되는 주소인지. http·https만 허용한다.
 * localhost·사설 주소(192.168.x, 10.x, 172.16~31.x)는 개발 서버를 부르려는 것이라 허용한다.
 * file:·data:·ftp: 같은 다른 프로토콜은 거부한다(리다이렉트로 넘어가는 주소도 같은 검사를 거친다).
 */
export type TargetCheck = { readonly ok: true; readonly url: string } | { readonly ok: false; readonly error: string };

export const REDIRECT_LIMIT = 10;

export function checkTarget(raw: string): TargetCheck {
  const text = raw.trim();
  if (text === '') return { ok: false, error: 'Enter a URL.' };
  if (text.length > 8192) return { ok: false, error: 'The URL is too long.' };
  if (!text.includes('://') && /^[\w.-]+(:\d+)?([/?#]|$)/.test(text)) return { ok: false, error: 'Start the URL with http:// or https://.' };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, error: /^[\w.-]+(:\d+)?([/?#]|$)/.test(text) ? 'Start the URL with http:// or https://.' : 'That is not a valid URL.' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, error: `Only http and https URLs can be sent (not ${url.protocol}).` };
  if (url.hostname === '') return { ok: false, error: 'The URL has no host.' };
  return { ok: true, url: url.toString() };
}

/** 인증서 오류 코드를 사람이 읽을 이유로 */
export function explainNetworkError(code: string | undefined, message: string): string {
  switch (code) {
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'SELF_SIGNED_CERT_IN_CHAIN':
      return 'Certificate error: the server uses a self-signed certificate. Use http:// for a local server, or install the certificate on this computer.';
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY':
      return 'Certificate error: the certificate chain could not be verified (an intermediate or root certificate is missing).';
    case 'CERT_HAS_EXPIRED':
      return 'Certificate error: the server certificate has expired.';
    case 'CERT_NOT_YET_VALID':
      return 'Certificate error: the server certificate is not valid yet (check this computer clock).';
    case 'ERR_TLS_CERT_ALTNAME_INVALID':
      return 'Certificate error: the certificate does not match the host name in the URL.';
    case 'ECONNREFUSED':
      return 'Connection refused: nothing is listening at that address and port.';
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'Host not found: check the host name and your network connection.';
    case 'ECONNRESET':
      return 'The connection was reset by the server.';
    case 'ETIMEDOUT':
    case 'UND_ERR_CONNECT_TIMEOUT':
      return 'The connection timed out.';
    default:
      return code !== undefined && code.startsWith('ERR_SSL') ? `TLS error (${code}).` : message === '' ? 'The request failed.' : message;
  }
}
