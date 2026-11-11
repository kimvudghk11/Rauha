import { API_METHODS, ApiError, ApiRequest, type ApiAuth, type ApiBody, type ApiMethod, type KeyValue } from './api-request.js';

/** 셸 흉내: 작은따옴표·큰따옴표·역슬래시·줄 잇기(\ 줄바꿈)를 풀어 낱말로 나눈다. 명령 치환($(...))은 하지 않는다. */
export function shellWords(line: string): string[] {
  const text = line.replace(/\\\r?\n/g, ' ').replace(/\^\r?\n/g, ' ');
  const words: string[] = [];
  let cur = '';
  let has = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (c === "'") {
      const end = text.indexOf("'", i + 1);
      if (end === -1) throw new ApiError('The cURL command has an unclosed quote.');
      cur += text.slice(i + 1, end);
      i = end;
      has = true;
    } else if (c === '"') {
      let j = i + 1;
      for (; j < text.length && text[j] !== '"'; j++) {
        if (text[j] === '\\' && /["\\$`]/.test(text[j + 1] ?? '')) j++;
        cur += text[j];
      }
      if (j >= text.length) throw new ApiError('The cURL command has an unclosed quote.');
      i = j;
      has = true;
    } else if (c === '\\' && i + 1 < text.length) {
      cur += text[++i];
      has = true;
    } else if (/\s/.test(c)) {
      if (has) words.push(cur);
      cur = '';
      has = false;
    } else {
      cur += c;
      has = true;
    }
  }
  if (has) words.push(cur);
  return words;
}

const kvOf = (key: string, value: string): KeyValue => ({ key, value, enabled: true });

/** Authorization 헤더가 Bearer·Basic이면 인증 설정으로 올리고 헤더 목록에서 뺀다 */
export function liftAuth(headers: readonly KeyValue[]): { readonly auth: ApiAuth; readonly headers: readonly KeyValue[] } {
  const i = headers.findIndex((h) => h.enabled && h.key.toLowerCase() === 'authorization');
  const h = headers[i];
  if (h === undefined) return { auth: { kind: 'none' }, headers };
  const bearer = /^Bearer\s+(.+)$/i.exec(h.value.trim());
  const basic = /^Basic\s+(.+)$/i.exec(h.value.trim());
  let auth: ApiAuth | null = null;
  if (bearer !== null) auth = { kind: 'bearer', token: bearer[1] as string };
  else if (basic !== null) {
    const b64 = basic[1] as string;
    // REST Client 형식: Basic <사용자> <비밀번호>
    const pair = /^(\S+)\s+(.+)$/.exec(b64);
    if (pair !== null) return { auth: { kind: 'basic', username: pair[1] as string, password: pair[2] as string }, headers: headers.filter((_x, idx) => idx !== i) };
    if (b64.includes('{{')) return { auth: { kind: 'none' }, headers };
    const decoded = new TextDecoder().decode(Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)));
    const at = decoded.indexOf(':');
    auth = { kind: 'basic', username: at === -1 ? decoded : decoded.slice(0, at), password: at === -1 ? '' : decoded.slice(at + 1) };
  }
  return auth === null ? { auth: { kind: 'none' }, headers } : { auth, headers: headers.filter((_x, idx) => idx !== i) };
}

/** 본문 글과 Content-Type으로 본문 종류를 정한다 */
export function bodyFrom(text: string, contentType: string | undefined): ApiBody {
  if (text === '') return { kind: 'none' };
  const ct = (contentType ?? '').toLowerCase();
  if (ct.includes('x-www-form-urlencoded')) {
    const fields = text
      .split('&')
      .filter((p) => p !== '')
      .map((p) => {
        const eq = p.indexOf('=');
        const dec = (s: string): string => {
          try {
            return decodeURIComponent(s.replace(/\+/g, ' '));
          } catch {
            return s;
          }
        };
        return kvOf(dec(eq === -1 ? p : p.slice(0, eq)), dec(eq === -1 ? '' : p.slice(eq + 1)));
      });
    return { kind: 'form', fields };
  }
  if (ct.includes('json') || (ct === '' && /^\s*[[{]/.test(text))) return { kind: 'json', text };
  return { kind: 'raw', text };
}

/** URL의 ?쿼리를 요청의 쿼리 목록으로 뺀다({{변수}}가 든 URL은 그대로 둔다) */
export function splitQuery(url: string): { readonly url: string; readonly query: readonly KeyValue[] } {
  const hash = url.indexOf('#');
  const noHash = hash === -1 ? url : url.slice(0, hash);
  const q = noHash.indexOf('?');
  if (q === -1) return { url, query: [] };
  const pairs = noHash
    .slice(q + 1)
    .split('&')
    .filter((p) => p !== '');
  const dec = (s: string): string => {
    try {
      return decodeURIComponent(s.replace(/\+/g, ' '));
    } catch {
      return s;
    }
  };
  const query = pairs.map((p) => {
    const eq = p.indexOf('=');
    return kvOf(dec(eq === -1 ? p : p.slice(0, eq)), dec(eq === -1 ? '' : p.slice(eq + 1)));
  });
  return { url: noHash.slice(0, q), query };
}

const nameFromUrl = (url: string, method: string): string => {
  try {
    const u = new URL(url);
    return `${method} ${u.pathname === '/' ? u.host : u.pathname}`;
  } catch {
    return `${method} ${url.slice(0, 40)}`;
  }
};

/** `curl ...` 한 줄(여러 줄 잇기 포함)을 요청으로 바꾼다. 모르는 옵션은 건너뛴다(-L -s -k --compressed 등). */
export function parseCurl(command: string, id: string): ApiRequest {
  const words = shellWords(command.trim());
  if (words.length === 0 || !/^curl(\.exe)?$/i.test(words[0] as string)) throw new ApiError('That does not look like a cURL command. It should start with "curl".');
  let method: string | null = null;
  let url: string | null = null;
  const headers: KeyValue[] = [];
  const data: string[] = [];
  const form: KeyValue[] = [];
  let user: string | null = null;
  let getMode = false;
  let head = false;
  const takes = new Set(['-X', '--request', '-H', '--header', '-d', '--data', '--data-raw', '--data-binary', '--data-ascii', '--data-urlencode', '-F', '--form', '-u', '--user', '-A', '--user-agent', '-b', '--cookie', '-e', '--referer', '--url', '-o', '--output', '-m', '--max-time', '--connect-timeout', '-x', '--proxy', '--cacert', '--cert', '--key', '-w', '--write-out', '-T', '--upload-file', '--retry']);
  for (let i = 1; i < words.length; i++) {
    let w = words[i] as string;
    let inline: string | null = null;
    const eq = /^(--[\w-]+)=(.*)$/s.exec(w);
    if (eq !== null) {
      w = eq[1] as string;
      inline = eq[2] as string;
    } else if (/^-[A-Za-z]./.test(w) && !w.startsWith('--') && takes.has(w.slice(0, 2))) {
      inline = w.slice(2);
      w = w.slice(0, 2);
    }
    const arg = (): string => {
      if (inline !== null) return inline;
      const next = words[++i];
      if (next === undefined) throw new ApiError(`cURL option ${w} needs a value.`);
      return next;
    };
    if (!w.startsWith('-') || w === '-') {
      if (url === null) url = w;
      continue;
    }
    switch (w) {
      case '-X':
      case '--request':
        method = arg().toUpperCase();
        break;
      case '-H':
      case '--header': {
        const h = arg();
        const c = h.indexOf(':');
        if (c > 0) headers.push(kvOf(h.slice(0, c).trim(), h.slice(c + 1).trim()));
        break;
      }
      case '-d':
      case '--data':
      case '--data-raw':
      case '--data-binary':
      case '--data-ascii':
        data.push(arg());
        break;
      case '--data-urlencode': {
        const v = arg();
        const e = v.indexOf('=');
        data.push(e === -1 ? encodeURIComponent(v) : `${v.slice(0, e)}=${encodeURIComponent(v.slice(e + 1))}`);
        break;
      }
      case '-F':
      case '--form': {
        const v = arg();
        const e = v.indexOf('=');
        form.push(kvOf(e === -1 ? v : v.slice(0, e), e === -1 ? '' : v.slice(e + 1)));
        break;
      }
      case '-u':
      case '--user':
        user = arg();
        break;
      case '-A':
      case '--user-agent':
        headers.push(kvOf('User-Agent', arg()));
        break;
      case '-b':
      case '--cookie':
        headers.push(kvOf('Cookie', arg()));
        break;
      case '-e':
      case '--referer':
        headers.push(kvOf('Referer', arg()));
        break;
      case '--url':
        url = arg();
        break;
      case '-G':
      case '--get':
        getMode = true;
        break;
      case '-I':
      case '--head':
        head = true;
        break;
      default:
        if (takes.has(w)) arg();
    }
  }
  if (url === null) throw new ApiError('The cURL command has no URL.');
  const hasData = data.length > 0 || form.length > 0;
  let m = (method ?? (head ? 'HEAD' : hasData && !getMode ? 'POST' : 'GET')) as ApiMethod;
  if (!API_METHODS.includes(m)) throw new ApiError(`The method ${String(method)} is not supported.`);
  if (getMode && method === null) m = 'GET';
  const ct = headers.find((h) => h.key.toLowerCase() === 'content-type')?.value;
  // 주소의 user:pw@ 는 주소에 남기지 않고 Basic 인증으로 올린다(주소는 기록·내보내기에 그대로 남기 때문)
  const info = /^(https?:\/\/)([^/?#@\s]+)@/i.exec(url);
  if (info !== null && user === null) {
    const raw = info[2] as string;
    const c = raw.indexOf(':');
    const dec = (t: string): string => {
      try {
        return decodeURIComponent(t);
      } catch {
        return t;
      }
    };
    user = dec(c === -1 ? raw : raw.slice(0, c)) + ':' + (c === -1 ? '' : dec(raw.slice(c + 1)));
    url = (info[1] as string) + url.slice(info[0].length);
  } else if (info !== null) url = (info[1] as string) + url.slice(info[0].length);
  let { url: bare, query } = splitQuery(url);
  let body: ApiBody = { kind: 'none' };
  if (form.length > 0) body = { kind: 'form', fields: form };
  else if (data.length > 0) {
    if (getMode) query = [...query, ...bodyFromQuery(data.join('&'))];
    else body = bodyFrom(data.join('&'), ct);
  }
  const lifted = liftAuth(headers);
  let auth = lifted.auth;
  if (user !== null) {
    const c = user.indexOf(':');
    auth = { kind: 'basic', username: c === -1 ? user : user.slice(0, c), password: c === -1 ? '' : user.slice(c + 1) };
  }
  return ApiRequest.create({ id, name: nameFromUrl(url, m), method: m, url: bare, query, headers: lifted.headers, body, auth });
}

const bodyFromQuery = (text: string): KeyValue[] => {
  const b = bodyFrom(text, 'application/x-www-form-urlencoded');
  return b.kind === 'form' ? [...b.fields] : [];
};

const sq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * 요청을 `curl` 여러 줄로 내보낸다. 변수는 `{{name}}` 그대로 두고, 값으로 적힌 비밀은 변수 이름으로 바꿔서 내보낸다
 * (붙여 넣기 전에 사용자가 변수를 직접 채운다).
 */
export function toCurl(request: ApiRequest): string {
  const { request: safe } = request.withSecretsAsVariables();
  const p = safe.props;
  const parts: string[] = ['curl'];
  if (p.method !== 'GET') parts.push(`-X ${p.method}`);
  const qs = p.query.filter((q) => q.enabled && q.key !== '');
  let url = qs.length === 0 ? p.url : `${p.url}${p.url.includes('?') ? '&' : '?'}${qs.map((q) => `${encodeURIComponent(q.key)}=${encodeURIComponent(q.value).replace(/%7B%7B/gi, '{{').replace(/%7D%7D/gi, '}}')}`).join('&')}`;
  if (p.auth.kind === 'apikey' && p.auth.in === 'query') url = `${url}${url.includes('?') ? '&' : '?'}${p.auth.name}=${p.auth.value}`;
  parts.push(sq(url));
  for (const h of p.headers) if (h.enabled && h.key !== '') parts.push(`-H ${sq(`${h.key}: ${h.value}`)}`);
  const a = p.auth;
  if (a.kind === 'bearer') parts.push(`-H ${sq(`Authorization: Bearer ${a.token}`)}`);
  else if (a.kind === 'basic') parts.push(`-u ${sq(`${a.username}:${a.password}`)}`);
  else if (a.kind === 'apikey' && a.in === 'header') parts.push(`-H ${sq(`${a.name}: ${a.value}`)}`);
  const b = p.body;
  if (b.kind === 'json') {
    if (!p.headers.some((h) => h.key.toLowerCase() === 'content-type')) parts.push(`-H ${sq('Content-Type: application/json')}`);
    parts.push(`--data-raw ${sq(b.text)}`);
  } else if (b.kind === 'raw') parts.push(`--data-raw ${sq(b.text)}`);
  else if (b.kind === 'form') for (const f of b.fields) if (f.enabled && f.key !== '') parts.push(`--data-urlencode ${sq(`${f.key}=${f.value}`)}`);
  return parts.join(' \\\n  ');
}
