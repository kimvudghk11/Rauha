/**
 * 요청을 보내도 되는 주소인지. http·https만 허용한다.
 * localhost·사설 주소(192.168.x, 10.x, 172.16~31.x)는 개발 서버를 부르려는 것이라 허용한다.
 * 클라우드 메타데이터(169.254.169.254 등)·링크로컬(169.254.0.0/16, fe80::/10) 주소는 자격 증명을 빼낼 수 있어 막는다.
 * file:·data:·ftp: 같은 다른 프로토콜은 거부한다(리다이렉트로 넘어가는 주소도 같은 검사를 거친다).
 */
export type TargetCheck = { readonly ok: true; readonly url: string } | { readonly ok: false; readonly error: string };

export const REDIRECT_LIMIT = 10;

const METADATA_HOSTS = new Set(['metadata.google.internal', 'metadata.goog', 'instance-data', 'instance-data.ec2.internal']);

/** 점으로 쓴 IPv4 → 숫자 4개. 아니면 null */
function ipv4Parts(text: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (m === null) return null;
  const parts = m.slice(1, 5).map(Number);
  return parts.every((p) => p <= 255) ? parts : null;
}

/** IPv6 글(대괄호 없이) → 16비트 8조각. 읽지 못하면 null. 끝의 점 표기 IPv4(::ffff:1.2.3.4)도 읽는다. */
function ipv6Groups(text: string): number[] | null {
  let t = text;
  const tail = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(t);
  if (tail !== null) {
    const v4 = ipv4Parts(tail[1] as string);
    if (v4 === null) return null;
    t = t.slice(0, t.length - (tail[1] as string).length) + ((v4[0] as number) * 256 + (v4[1] as number)).toString(16) + ':' + ((v4[2] as number) * 256 + (v4[3] as number)).toString(16);
  }
  const halves = t.split('::');
  if (halves.length > 2) return null;
  const side = (x: string): string[] => (x === '' ? [] : x.split(':'));
  const head = side(halves[0] as string);
  const rest = halves.length === 2 ? side(halves[1] as string) : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const all = [...head, ...(halves.length === 2 ? Array<string>(missing).fill('0') : []), ...rest];
  if (!all.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return null;
  return all.map((g) => parseInt(g, 16));
}

const isMetadataV4 = (p: readonly number[]): boolean => (p[0] === 169 && p[1] === 254) || (p[0] === 100 && p[1] === 100 && p[2] === 100 && p[3] === 200);

/** 클라우드 메타데이터·링크로컬 주소인지(IP 글자만 본다. IPv4·IPv6·IPv4가 든 IPv6 모양 모두) */
export function isMetadataAddress(address: string): boolean {
  const a = address.trim().replace(/^\[|\]$/g, '').replace(/%.*$/, '').toLowerCase();
  const v4 = ipv4Parts(a);
  if (v4 !== null) return isMetadataV4(v4);
  const g = ipv6Groups(a);
  if (g === null) return false;
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = g;
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 링크로컬
  if (g0 === 0xfd00 && g1 === 0x0ec2) return true; // AWS IPv6 메타데이터 fd00:ec2::/32
  const embedded = [g6 >> 8, g6 & 255, g7 >> 8, g7 & 255];
  const mapped = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0xffff || g5 === 0);
  const nat64 = g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0;
  return (mapped || nat64) && isMetadataV4(embedded);
}

/** 주소의 호스트 부분이 메타데이터 이름이거나 메타데이터 IP 인지(URL 이 이미 숫자 표기를 점 표기로 바꿔 준 뒤의 호스트 이름을 받는다) */
export function isMetadataHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/\.$/, '');
  return METADATA_HOSTS.has(h) || isMetadataAddress(h);
}

export function checkTarget(raw: string): TargetCheck {
  const text = raw.trim();
  if (text === '') return { ok: false, error: 'Enter a URL.' };
  if (text.length > 8192) return { ok: false, error: 'The URL is too long.' };
  if (/[\u0000-\u001f\u007f]/.test(text)) return { ok: false, error: 'The URL has a line break or control character. Remove it.' };
  if (!text.includes('://') && /^[\w.-]+(:\d+)?([/?#]|$)/.test(text)) return { ok: false, error: 'Start the URL with http:// or https://.' };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, error: /^[\w.-]+(:\d+)?([/?#]|$)/.test(text) ? 'Start the URL with http:// or https://.' : 'That is not a valid URL.' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, error: `Only http and https URLs can be sent (not ${url.protocol}).` };
  if (url.hostname === '') return { ok: false, error: 'The URL has no host.' };
  if (url.username !== '' || url.password !== '') return { ok: false, error: 'Remove the user name and password from the URL and use the Auth tab instead.' };
  if (isMetadataHost(url.hostname)) return { ok: false, error: 'That address is a cloud metadata or link-local address, which is blocked because it can expose credentials. Local servers (localhost, 192.168.x.x, 10.x.x.x) are fine.' };
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
      if (message === 'bad port') return 'That port is blocked for web requests (ports such as 1, 22, 25 and 6000 cannot be used). Use a different port.';
      return code !== undefined && code.startsWith('ERR_SSL') ? `TLS error (${code}).` : message === '' ? 'The request failed.' : message;
  }
}
