import type { ApiAfter, Capture, Check } from './api-after.js';
import type { ImportedCollection } from './api-collections.js';
import { splitQuery } from './api-curl.js';
import { API_METHODS, ApiError, ApiRequest, type ApiAuth, type ApiBody, type ApiMethod, type KeyValue, type MultipartPart } from './api-request.js';

/**
 * Postman 컬렉션(v2.0·v2.1 JSON) 가져오기. 폴더는 묶음(안쪽 폴더는 "A / B"), 컬렉션 변수는 환경 변수,
 * 인증은 요청 → 폴더 → 컬렉션 순으로 물려받는다. 흔한 테스트 스크립트(상태 검사, environment.set(…json 경로))는
 * After response 규칙으로 옮기고, 그 밖의 스크립트는 돌리지 않는다.
 */
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '');
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isObj) : []);
const MAX_REQUESTS = 2000;
const MAX_DEPTH = 8;

function kv(v: unknown): KeyValue[] {
  return list(v)
    .filter((r) => str(r['key']) !== '' || str(r['value']) !== '')
    .map((r) => ({ key: str(r['key']), value: str(r['value']), enabled: r['disabled'] !== true }));
}

/** 인증(없거나 inherit 이면 null: 위에서 물려받는다) */
function authOf(v: unknown): ApiAuth | null {
  if (!isObj(v)) return null;
  const type = str(v['type']);
  const field = (name: string): string => {
    const arr = v[type];
    if (Array.isArray(arr)) return str(list(arr).find((x) => str(x['key']) === name)?.['value']);
    if (isObj(arr)) return str(arr[name]);
    return '';
  };
  switch (type) {
    case 'noauth':
      return { kind: 'none' };
    case 'bearer':
      return { kind: 'bearer', token: field('token') };
    case 'basic':
      return { kind: 'basic', username: field('username'), password: field('password') };
    case 'apikey':
      return { kind: 'apikey', name: field('key') || 'X-API-Key', value: field('value'), in: field('in') === 'query' ? 'query' : 'header' };
    default:
      return null;
  }
}

function bodyOf(v: unknown): ApiBody {
  if (!isObj(v)) return { kind: 'none' };
  switch (str(v['mode'])) {
    case 'raw': {
      const text = str(v['raw']);
      if (text === '') return { kind: 'none' };
      const lang = isObj(v['options']) && isObj(v['options']['raw']) ? str(v['options']['raw']['language']) : '';
      const looksJson = lang === 'json' || (lang === '' && /^\s*[[{]/.test(text));
      return { kind: looksJson ? 'json' : 'raw', text };
    }
    case 'urlencoded':
      return { kind: 'form', fields: kv(v['urlencoded']) };
    case 'formdata':
      return {
        kind: 'multipart',
        parts: list(v['formdata']).map((r): MultipartPart => {
          const file = str(r['type']) === 'file';
          const src = Array.isArray(r['src']) ? str(r['src'][0]) : str(r['src']);
          return { key: str(r['key']), value: file ? src : str(r['value']), enabled: r['disabled'] !== true, file };
        }),
      };
    case 'graphql': {
      const g = isObj(v['graphql']) ? v['graphql'] : {};
      let variables: unknown = null;
      try {
        variables = str(g['variables']) === '' ? null : JSON.parse(str(g['variables']));
      } catch {
        variables = str(g['variables']);
      }
      return { kind: 'json', text: JSON.stringify({ query: str(g['query']), variables }, null, 2) };
    }
    default:
      return { kind: 'none' };
  }
}

/** url: 글 또는 { raw, query, variable } */
function urlOf(v: unknown): { url: string; query: KeyValue[]; pathVars: KeyValue[] } {
  if (typeof v === 'string') {
    const s = splitQuery(v);
    return { url: s.url, query: [...s.query], pathVars: [] };
  }
  if (!isObj(v)) return { url: '', query: [], pathVars: [] };
  let raw = str(v['raw']);
  if (raw === '') {
    const host = Array.isArray(v['host']) ? v['host'].map(str).join('.') : str(v['host']);
    const path = Array.isArray(v['path']) ? v['path'].map(str).join('/') : str(v['path']);
    raw = `${str(v['protocol']) !== '' ? `${str(v['protocol'])}://` : ''}${host}${path !== '' ? `/${path}` : ''}`;
  }
  const s = splitQuery(raw);
  const query = Array.isArray(v['query']) ? kv(v['query']) : [...s.query];
  return { url: s.url, query, pathVars: kv(v['variable']) };
}

/** 응답 JSON 을 가리키는 식 → JSON 경로($.a.b). 모르면 null */
function jsonPathOf(expr: string, jsonVars: ReadonlySet<string>): string | null {
  const e = expr.trim().replace(/;$/, '');
  const m = /^(?:pm\.response\.json\(\)|JSON\.parse\(\s*responseBody\s*\)|([A-Za-z_$][\w$]*))((?:\.[A-Za-z_$][\w$]*|\[\s*(?:\d+|"[^"]*"|'[^']*')\s*\])*)$/.exec(e);
  if (m === null) return null;
  if (m[1] !== undefined && !jsonVars.has(m[1])) return null;
  return `$${m[2] ?? ''}`;
}

/** 흔한 Postman 테스트 스크립트를 After response 규칙으로 */
function afterOf(events: unknown): ApiAfter {
  const lines = list(events)
    .filter((e) => str(e['listen']) === 'test')
    .flatMap((e) => {
      const exec = isObj(e['script']) ? e['script']['exec'] : undefined;
      return (Array.isArray(exec) ? exec.map(str) : [str(exec)]).flatMap((l) => l.split(/\r?\n/));
    });
  const captures: Capture[] = [];
  const checks: Check[] = [];
  const jsonVars = new Set<string>();
  for (const line of lines) {
    const assign = /(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:pm\.response\.json\(\)|JSON\.parse\(\s*responseBody\s*\))/.exec(line);
    if (assign !== null) jsonVars.add(assign[1] as string);
    const status = /pm\.response\.to\.have\.status\(\s*(\d{3})\s*\)|pm\.expect\(\s*pm\.response\.code\s*\)\.to\.(?:eql|equal|be\.equal)\(\s*(\d{3})\s*\)|responseCode\.code\s*===?\s*(\d{3})/.exec(line);
    if (status !== null) {
      const value = (status[1] ?? status[2] ?? status[3]) as string;
      if (!checks.some((c) => c.target === 'status' && c.value === value)) checks.push({ target: 'status', path: '', op: 'eq', value, enabled: true });
    }
    const time = /pm\.expect\(\s*pm\.response\.responseTime\s*\)\.to\.be\.below\(\s*(\d+)\s*\)/.exec(line);
    if (time !== null) checks.push({ target: 'time', path: '', op: 'lt', value: time[1] as string, enabled: true });
    const set = /pm\.(?:environment|collectionVariables|globals|variables)\.set\(\s*["']([A-Za-z_][\w.-]*)["']\s*,\s*(.+)\)\s*;?\s*$/.exec(line.trim());
    if (set !== null) {
      const name = set[1] as string;
      const expr = (set[2] as string).trim();
      const header = /^pm\.response\.headers\.get\(\s*["']([^"']+)["']\s*\)$/.exec(expr);
      const path = header === null ? jsonPathOf(expr, jsonVars) : null;
      if (header !== null) captures.push({ name, from: 'header', path: header[1] as string, enabled: true });
      else if (path !== null) captures.push({ name, from: 'json', path, enabled: true });
    }
  }
  return { captures: captures.slice(0, 50), checks: checks.slice(0, 50) };
}

export function parsePostman(text: string, newId: () => string): ImportedCollection {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new ApiError('That is not valid JSON. Export the collection from Postman as "Collection v2.1" and import that file.');
  }
  if (!isObj(doc) || !isObj(doc['info']) || !Array.isArray(doc['item'])) throw new ApiError('That does not look like a Postman collection (it needs "info" and "item"). Export it from Postman as Collection v2.1.');
  const variables = kv(doc['variable']).filter((v) => /^[A-Za-z_][\w.-]*$/.test(v.key)).map((v) => ({ name: v.key, value: v.value }));
  const groups = new Map<string, ApiRequest[]>();
  let count = 0;

  const walk = (items: unknown, folder: string, inherited: ApiAuth, depth: number): void => {
    if (depth > MAX_DEPTH) return;
    for (const it of list(items)) {
      const name = str(it['name']).trim();
      if (Array.isArray(it['item'])) {
        walk(it['item'], folder === '' ? name : `${folder} / ${name}`, authOf(it['auth']) ?? inherited, depth + 1);
        continue;
      }
      const r = isObj(it['request']) ? it['request'] : typeof it['request'] === 'string' ? { url: it['request'] } : null;
      if (r === null) continue;
      if (++count > MAX_REQUESTS) throw new ApiError(`At most ${MAX_REQUESTS} requests can be imported at once.`);
      const method = (str(r['method']) || 'GET').toUpperCase();
      const u = urlOf(r['url']);
      const request = ApiRequest.create({
        id: newId(),
        name: (name || `${method} ${u.url}`).slice(0, 120),
        method: (API_METHODS.includes(method as ApiMethod) ? method : 'GET') as ApiMethod,
        url: u.url,
        query: u.query,
        headers: kv(r['header']),
        body: method === 'GET' || method === 'HEAD' ? { kind: 'none' } : bodyOf(r['body']),
        auth: authOf(r['auth']) ?? inherited,
        pathVars: u.pathVars,
        after: afterOf(it['event']),
      });
      groups.set(folder, [...(groups.get(folder) ?? []), request]);
      for (const v of request.variableNames()) if (!variables.some((x) => x.name === v)) variables.push({ name: v, value: '' });
    }
  };
  walk(doc['item'], '', authOf(doc['auth']) ?? { kind: 'none' }, 0);
  if (count === 0) throw new ApiError('The Postman collection has no requests.');
  return { name: str(doc['info']['name']).slice(0, 80) || 'Postman', groups: [...groups].map(([name, requests]) => ({ name, requests })), variables };
}
