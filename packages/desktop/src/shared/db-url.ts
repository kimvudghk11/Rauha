import type { ServerKind, SslMode } from './db-server.js';

/** 연결 문자열에서 꺼낸 폼 값(폼이 그대로 채운다. 검사는 저장할 때 ServerTarget 이 한다) */
export interface ConnectionUrlFields {
  readonly kind: ServerKind;
  readonly addresses: readonly { readonly host: string; readonly port: string; readonly label: string }[];
  readonly user: string;
  readonly password: string;
  readonly database: string;
  /** 적혀 있지 않으면 null */
  readonly ssl: SslMode | null;
}

const URL_RE = /^(postgres(?:ql)?|pg|mysql2?|mariadb):\/\/(?:([^:@/]*)(?::([^@/]*))?@)?([^/?#]*)(?:\/([^?#]*))?(?:\?([^#]*))?(?:#.*)?$/i;

const decode = (v: string | undefined): string => {
  if (v === undefined) return '';
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
};

function sslOf(params: URLSearchParams): SslMode | null {
  const mode = (params.get('sslmode') ?? params.get('ssl-mode') ?? params.get('ssl_mode') ?? '').toLowerCase();
  if (mode !== '') {
    if (/^(disable|disabled|allow|prefer|preferred)$/.test(mode)) return 'off';
    if (/^(verify-ca|verify-full|verify_ca|verify_identity)$/.test(mode)) return 'verify';
    return 'require';
  }
  const ssl = (params.get('ssl') ?? '').toLowerCase();
  if (ssl === '') return null;
  return /^(true|1|require|required)$/.test(ssl) ? 'require' : 'off';
}

/** 호스트[:포트] 하나. IPv6 는 [::1]:5432 */
function hostPort(part: string): { host: string; port: string; label: string } {
  const v6 = /^\[([^\]]*)\](?::(\d*))?$/.exec(part);
  if (v6 !== null) return { host: v6[1] ?? '', port: v6[2] ?? '', label: '' };
  const at = part.lastIndexOf(':');
  return at === -1 ? { host: part, port: '', label: '' } : { host: part.slice(0, at), port: part.slice(at + 1), label: '' };
}

/** postgres://… · mysql://… 연결 문자열 읽기(폼에 붙여 넣으면 칸을 채운다). 호스트를 쉼표로 여럿 적은 주소(libpq)도 읽는다 */
export const ConnectionUrl = {
  parse(text: string): ConnectionUrlFields | null {
    const m = URL_RE.exec(text.trim());
    if (m === null) return null;
    const scheme = m[1]!.toLowerCase();
    const kind: ServerKind = /^(mysql2?|mariadb)$/.test(scheme) ? 'mysql' : 'postgres';
    const addresses = (m[4] ?? '').split(',').filter((p) => p !== '').map(hostPort).map((a) => ({ ...a, host: decode(a.host) }));
    return { kind, addresses, user: decode(m[2]), password: decode(m[3]), database: decode((m[5] ?? '').split('/')[0]), ssl: sslOf(new URLSearchParams(m[6] ?? '')) };
  },
};
