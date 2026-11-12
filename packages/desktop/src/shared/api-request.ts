/**
 * API 탭의 요청 한 개(값 객체). 이름·메서드·URL·쿼리·헤더·본문·인증을 들고 있고,
 * 변수(`{{name}}`)를 채워 실제로 보낼 모양(prepare)으로 바꾸는 규칙, 비밀 값을 변수 이름으로 바꾸는 규칙을 가진다.
 * 불변이다. 바꾸려면 with* 메서드로 새 요청을 만든다.
 */

export const API_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
export type ApiMethod = (typeof API_METHODS)[number];

export interface KeyValue {
  readonly key: string;
  readonly value: string;
  readonly enabled: boolean;
}

export type ApiBody =
  | { readonly kind: 'none' }
  | { readonly kind: 'json'; readonly text: string }
  | { readonly kind: 'raw'; readonly text: string }
  | { readonly kind: 'form'; readonly fields: readonly KeyValue[] };

export type ApiAuth =
  | { readonly kind: 'none' }
  | { readonly kind: 'bearer'; readonly token: string }
  | { readonly kind: 'basic'; readonly username: string; readonly password: string }
  | { readonly kind: 'apikey'; readonly name: string; readonly value: string; readonly in: 'header' | 'query' };

export interface ApiRequestProps {
  readonly id: string;
  readonly name: string;
  readonly method: ApiMethod;
  readonly url: string;
  readonly query: readonly KeyValue[];
  readonly headers: readonly KeyValue[];
  readonly body: ApiBody;
  readonly auth: ApiAuth;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly missing: readonly string[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** 보낼 준비를 마친 요청(변수가 모두 채워졌다) */
export interface PreparedRequest {
  readonly method: ApiMethod;
  readonly url: string;
  readonly headers: readonly (readonly [string, string])[];
  readonly body: string | null;
  /** 채워진 비밀 값(응답·기록에서 가릴 값) */
  readonly secrets: readonly string[];
}

const VAR_RE = /\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}/g;
const WHOLE_VAR_RE = /^\s*\{\{\s*[A-Za-z_][\w.-]*\s*\}\}\s*$/;

/** 글 안의 `{{name}}` 이름들(중복 없이, 나온 순서) */
export function variablesIn(text: string): string[] {
  return [...new Set([...text.matchAll(VAR_RE)].map((m) => m[1] as string))];
}

/** 값 전체가 `{{name}}` 하나이거나 비어 있으면 "비밀이 들어 있지 않다" */
export const isVariableRef = (value: string): boolean => value.trim() === '' || WHOLE_VAR_RE.test(value);

/** HTTP 헤더 이름으로 쓸 수 있는 글자(RFC 9110 token) */
const HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
/** 헤더 값에 못 들어가는 글자: 줄바꿈과 탭 아닌 제어 문자 */
// eslint-disable-next-line no-control-regex
const HEADER_VALUE_BAD_RE = /[\u0000-\u0008\u000a-\u001f\u007f]/;

const SENSITIVE_HEADER_RE = /^(authorization|proxy-authorization|cookie|x-api-key|api-key|x-auth-token|x-access-token|x-amz-security-token)$/i;
export const isSensitiveHeaderName = (name: string): boolean => SENSITIVE_HEADER_RE.test(name.trim());

/** 값이 비밀일 가능성이 큰 쿼리 이름(token·api_key·password·signature …). 값으로 적혀 있으면 변수로 옮긴다. */
const SENSITIVE_QUERY_RE = /^(access[-_]?token|refresh[-_]?token|id[-_]?token|auth[-_]?token|token|api[-_]?key|apikey|key|secret|client[-_]?secret|password|passwd|pwd|auth|authorization|sig|signature|x-amz-signature|x-amz-credential|x-amz-security-token)$/i;
export const isSensitiveQueryName = (name: string): boolean => SENSITIVE_QUERY_RE.test(name.trim());

/** 이 값이 "그대로 적힌 비밀"인지: 비어 있지 않고 {{변수}}가 하나도 없다 */
const isLiteralValue = (value: string): boolean => value.trim() !== '' && variablesIn(value).length === 0;

const slug = (text: string): string => {
  const s = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return s === '' ? 'x' : s.slice(0, 24);
};

/** 보낼 때 `{{name}}`을 채운다. 없는 변수 이름은 모아 둔다. */
function fill(text: string, vars: ReadonlyMap<string, string>, missing: Set<string>, used: Set<string>): string {
  return text.replace(VAR_RE, (_m, name: string) => {
    const v = vars.get(name);
    if (v === undefined) {
      missing.add(name);
      return '';
    }
    used.add(name);
    return v;
  });
}

const safeDecode = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

export const encodeBasic = (user: string, pass: string): string => btoa(String.fromCharCode(...new TextEncoder().encode(`${user}:${pass}`)));

export class ApiRequest {
  private constructor(readonly props: ApiRequestProps) {}

  static create(props: Partial<ApiRequestProps> & { readonly id: string }): ApiRequest {
    return new ApiRequest({
      id: props.id,
      name: props.name ?? 'New request',
      method: props.method ?? 'GET',
      url: props.url ?? '',
      query: props.query ?? [],
      headers: props.headers ?? [],
      body: props.body ?? { kind: 'none' },
      auth: props.auth ?? { kind: 'none' },
    });
  }

  get id(): string {
    return this.props.id;
  }
  get name(): string {
    return this.props.name;
  }

  withId(id: string): ApiRequest {
    return new ApiRequest({ ...this.props, id });
  }
  withName(name: string): ApiRequest {
    const n = name.trim();
    if (n === '') throw new ApiError('Name cannot be empty.');
    return new ApiRequest({ ...this.props, name: n });
  }

  /** 내용 지문(id 빼고). 자동 생성한 요청을 사용자가 손댔는지 알아볼 때 쓴다 */
  contentHash(): string {
    const { id: _id, ...rest } = this.props;
    const text = JSON.stringify(rest);
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return `${h.toString(16).padStart(8, '0')}${text.length.toString(16)}`;
  }

  /** 요청에 쓰인 모든 변수 이름 */
  variableNames(): string[] {
    const p = this.props;
    const parts: string[] = [p.url, ...p.query.filter((q) => q.enabled).flatMap((q) => [q.key, q.value]), ...p.headers.filter((h) => h.enabled).flatMap((h) => [h.key, h.value])];
    if (p.body.kind === 'json' || p.body.kind === 'raw') parts.push(p.body.text);
    if (p.body.kind === 'form') parts.push(...p.body.fields.filter((f) => f.enabled).flatMap((f) => [f.key, f.value]));
    const a = p.auth;
    if (a.kind === 'bearer') parts.push(a.token);
    else if (a.kind === 'basic') parts.push(a.username, a.password);
    else if (a.kind === 'apikey') parts.push(a.name, a.value);
    return [...new Set(parts.flatMap(variablesIn))];
  }

  /**
   * 변수를 채워 보낼 요청을 만든다. 없는 변수가 있으면 이름을 모두 알리며 실패한다.
   * 켜진 쿼리만 URL에 붙고, 인증은 헤더(또는 쿼리)로 풀린다. GET·HEAD에는 본문을 싣지 않는다.
   */
  prepare(vars: ReadonlyMap<string, string>, secretNames: ReadonlySet<string> = new Set()): PreparedRequest {
    const p = this.props;
    const missing = new Set<string>();
    const used = new Set<string>();
    const f = (t: string): string => fill(t, vars, missing, used);

    let url = f(p.url).trim();
    const query = p.query.filter((q) => q.enabled && q.key !== '').map((q) => [f(q.key), f(q.value)] as const);
    const headers: [string, string][] = p.headers.filter((h) => h.enabled && h.key.trim() !== '').map((h) => [f(h.key).trim(), f(h.value)]);
    const secretValues: string[] = [];
    const hasHeader = (name: string): boolean => headers.some(([k]) => k.toLowerCase() === name.toLowerCase());

    const a = p.auth;
    const queryAuth: (readonly [string, string])[] = [];
    if (a.kind === 'bearer') {
      const token = f(a.token).trim();
      if (token !== '') {
        headers.push(['Authorization', `Bearer ${token}`]);
        secretValues.push(token);
      }
    } else if (a.kind === 'basic') {
      const user = f(a.username);
      const pass = f(a.password);
      headers.push(['Authorization', `Basic ${encodeBasic(user, pass)}`]);
      if (pass !== '') secretValues.push(pass);
    } else if (a.kind === 'apikey' && a.name.trim() !== '') {
      const name = f(a.name).trim();
      const value = f(a.value);
      if (a.in === 'header') headers.push([name, value]);
      else queryAuth.push([name, value]);
      if (value !== '') secretValues.push(value);
    }

    let body: string | null = null;
    const b = p.body;
    if (b.kind === 'json' || b.kind === 'raw') {
      body = f(b.text);
      if (b.kind === 'json' && !hasHeader('content-type')) headers.push(['Content-Type', 'application/json']);
    } else if (b.kind === 'form') {
      const pairs = b.fields.filter((x) => x.enabled && x.key !== '').map((x) => [f(x.key), f(x.value)] as const);
      body = pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
      if (!hasHeader('content-type')) headers.push(['Content-Type', 'application/x-www-form-urlencoded']);
    }

    if (missing.size > 0) {
      const names = [...missing];
      throw new ApiError(`Missing variable${names.length > 1 ? 's' : ''}: ${names.map((n) => `{{${n}}}`).join(', ')}. Add ${names.length > 1 ? 'them' : 'it'} to the selected environment.`, names);
    }
    if (url === '') throw new ApiError('Enter a URL.');
    for (const [k, v] of headers) {
      if (!HEADER_NAME_RE.test(k)) throw new ApiError(`"${k.slice(0, 40)}" is not a valid header name. Use letters, digits and - _ . only (no spaces, colons or line breaks).`);
      if (HEADER_VALUE_BAD_RE.test(v)) throw new ApiError(`The value of header ${k} has a line break or control character, which is not allowed.`);
    }

    const allQuery = [...query, ...queryAuth];
    if (allQuery.length > 0) {
      const hash = url.indexOf('#');
      const base = hash === -1 ? url : url.slice(0, hash);
      const frag = hash === -1 ? '' : url.slice(hash);
      const qs = allQuery.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
      const joiner = base.includes('?') ? (base.endsWith('?') || base.endsWith('&') ? '' : '&') : '?';
      url = `${base}${joiner}${qs}${frag}`;
    }
    if (p.method === 'GET' || p.method === 'HEAD') body = null;
    for (const name of used) {
      const v = vars.get(name);
      if (secretNames.has(name) && v !== undefined && v !== '') secretValues.push(v);
    }
    for (const [k, v] of headers) if (isSensitiveHeaderName(k) && v !== '') secretValues.push(v, v.replace(/^(Bearer|Basic)\s+/i, ''));
    return { method: p.method, url, headers, body, secrets: [...new Set(secretValues.filter((s) => s.length >= 4))] };
  }

  /** 비밀이 변수 이름이 아니라 값 그대로 들어 있는 곳(인증 값, 민감한 헤더 값) 이름들 */
  literalSecretFields(): string[] {
    const out: string[] = [];
    const a = this.props.auth;
    if (a.kind === 'bearer' && !isVariableRef(a.token)) out.push('auth.token');
    if (a.kind === 'basic' && !isVariableRef(a.password)) out.push('auth.password');
    if (a.kind === 'apikey' && !isVariableRef(a.value)) out.push('auth.value');
    this.props.headers.forEach((h, i) => {
      if (isSensitiveHeaderName(h.key) && !isVariableRef(h.value)) out.push(`headers.${i}`);
    });
    return out;
  }

  /**
   * 비밀 값을 `{{이름}}`으로 바꾼 요청과, 바꾼 값 목록을 돌려준다.
   * 저장소(.http)에 쓰거나 화면에 보일 요청은 항상 이걸 거친다. 이름은 요청 이름에서 만들고 같은 값이면 같은 이름을 쓴다.
   */
  withSecretsAsVariables(): { readonly request: ApiRequest; readonly secrets: readonly { readonly name: string; readonly value: string }[] } {
    const secrets: { name: string; value: string }[] = [];
    const base = slug(this.props.name);
    const take = (suffix: string, value: string): string => {
      const found = secrets.find((s) => s.value === value);
      if (found !== undefined) return `{{${found.name}}}`;
      let name = `${base}_${suffix}`;
      if (secrets.some((s) => s.name === name)) name = `${name}_${secrets.length + 1}`;
      secrets.push({ name, value });
      return `{{${name}}}`;
    };
    let auth = this.props.auth;
    if (auth.kind === 'bearer' && !isVariableRef(auth.token)) auth = { ...auth, token: take('token', auth.token.trim()) };
    else if (auth.kind === 'basic' && !isVariableRef(auth.password)) auth = { ...auth, password: take('password', auth.password) };
    else if (auth.kind === 'apikey' && !isVariableRef(auth.value)) auth = { ...auth, value: take('key', auth.value) };
    const headers = this.props.headers.map((h) => {
      if (!isSensitiveHeaderName(h.key) || isVariableRef(h.value)) return h;
      const scheme = /^(Bearer|Basic)\s+(.+)$/i.exec(h.value.trim());
      if (scheme === null) return { ...h, value: take(slug(h.key), h.value) };
      const secret = (scheme[2] as string).trim();
      return isVariableRef(secret) ? h : { ...h, value: `${scheme[1]} ${take(slug(h.key), secret)}` };
    });
    const query = this.props.query.map((q) => (isSensitiveQueryName(q.key) && isLiteralValue(q.value) ? { ...q, value: take(slug(q.key), q.value) } : q));
    const url = this.props.url.replace(/([?&])([^=&#]+)=([^&#]*)/g, (m: string, sep: string, key: string, value: string) => (isSensitiveQueryName(safeDecode(key)) && isLiteralValue(value) ? `${sep}${key}=${take(slug(safeDecode(key)), value)}` : m));
    if (secrets.length === 0) return { request: this, secrets };
    return { request: new ApiRequest({ ...this.props, auth, headers, query, url }), secrets };
  }
}
