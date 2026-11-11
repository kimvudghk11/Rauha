import { API_METHODS, ApiError, ApiRequest, type ApiAuth, type ApiBody, type ApiMethod, type KeyValue } from './api-request.js';
import type { ImportedCollection } from './api-collections.js';

/**
 * OpenAPI 3.x(JSON) 가져오기. 경로·메서드마다 요청 하나, 첫 태그(없으면 첫 경로 조각)별 폴더,
 * 서버 URL은 환경 변수 `base_url`, 인증 방식은 `{{token}}`·`{{api_key}}` 변수를 가리키게 한다.
 */
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const MAX_OPERATIONS = 1000;

/** 스키마에서 보기 좋은 예시 값(깊이·길이 제한) */
function sample(schema: unknown, depth = 0): unknown {
  if (!isObj(schema) || depth > 4) return null;
  if (schema['example'] !== undefined) return schema['example'];
  if (schema['default'] !== undefined) return schema['default'];
  if (Array.isArray(schema['enum']) && schema['enum'].length > 0) return schema['enum'][0];
  const type = str(schema['type']);
  if (type === 'object' || isObj(schema['properties'])) {
    const out: Record<string, unknown> = {};
    const props = isObj(schema['properties']) ? schema['properties'] : {};
    for (const [k, v] of Object.entries(props).slice(0, 30)) if (k !== '__proto__') out[k] = sample(v, depth + 1);
    return out;
  }
  if (type === 'array') return [sample(schema['items'], depth + 1)];
  if (type === 'integer' || type === 'number') return 0;
  if (type === 'boolean') return false;
  return type === 'string' ? '' : null;
}

export function parseOpenApi(text: string, newId: () => string): ImportedCollection {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new ApiError('That is not valid JSON. Only OpenAPI 3.x JSON files can be imported.');
  }
  if (!isObj(doc) || !/^3\./.test(str(doc['openapi']))) throw new ApiError('That does not look like an OpenAPI 3.x document (missing "openapi": "3.x").');
  const paths = doc['paths'];
  if (!isObj(paths)) throw new ApiError('The OpenAPI document has no paths.');
  const info = isObj(doc['info']) ? doc['info'] : {};
  const variables: { name: string; value: string }[] = [];
  const servers = Array.isArray(doc['servers']) ? doc['servers'] : [];
  const server = isObj(servers[0]) ? str(servers[0]['url']) : '';
  variables.push({ name: 'base_url', value: server.replace(/\/+$/, '') });

  // 인증: 문서 전체 security의 첫 항목
  let auth: ApiAuth = { kind: 'none' };
  const schemes = isObj(doc['components']) && isObj(doc['components']['securitySchemes']) ? doc['components']['securitySchemes'] : {};
  const security = Array.isArray(doc['security']) ? doc['security'] : [];
  const firstName = isObj(security[0]) ? Object.keys(security[0])[0] : undefined;
  const scheme = firstName !== undefined && isObj(schemes) ? schemes[firstName] : undefined;
  if (isObj(scheme)) {
    if (str(scheme['type']) === 'http' && /^bearer$/i.test(str(scheme['scheme']))) {
      auth = { kind: 'bearer', token: '{{token}}' };
      variables.push({ name: 'token', value: '' });
    } else if (str(scheme['type']) === 'http' && /^basic$/i.test(str(scheme['scheme']))) {
      auth = { kind: 'basic', username: '{{username}}', password: '{{password}}' };
      variables.push({ name: 'username', value: '' }, { name: 'password', value: '' });
    } else if (str(scheme['type']) === 'apiKey') {
      auth = { kind: 'apikey', name: str(scheme['name']) || 'X-API-Key', value: '{{api_key}}', in: str(scheme['in']) === 'query' ? 'query' : 'header' };
      variables.push({ name: 'api_key', value: '' });
    }
  }

  const groups = new Map<string, ApiRequest[]>();
  let count = 0;
  for (const [path, item] of Object.entries(paths)) {
    if (!isObj(item)) continue;
    const shared = Array.isArray(item['parameters']) ? item['parameters'] : [];
    for (const m of API_METHODS) {
      const op = item[m.toLowerCase()];
      if (!isObj(op)) continue;
      if (++count > MAX_OPERATIONS) throw new ApiError(`At most ${MAX_OPERATIONS} operations can be imported at once.`);
      const params = [...shared, ...(Array.isArray(op['parameters']) ? op['parameters'] : [])].filter(isObj);
      const query: KeyValue[] = [];
      const headers: KeyValue[] = [];
      for (const prm of params) {
        const name = str(prm['name']);
        if (name === '') continue;
        const ex = prm['example'] ?? (isObj(prm['schema']) ? sample(prm['schema']) : '');
        const value = typeof ex === 'string' || typeof ex === 'number' || typeof ex === 'boolean' ? String(ex) : '';
        if (str(prm['in']) === 'query') query.push({ key: name, value, enabled: prm['required'] === true });
        else if (str(prm['in']) === 'header') headers.push({ key: name, value, enabled: prm['required'] === true });
      }
      let body: ApiBody = { kind: 'none' };
      const content = isObj(op['requestBody']) && isObj(op['requestBody']['content']) ? op['requestBody']['content'] : null;
      const json = content !== null && isObj(content['application/json']) ? content['application/json'] : null;
      if (json !== null) {
        const ex = json['example'] ?? sample(json['schema']);
        body = { kind: 'json', text: JSON.stringify(ex, null, 2) };
      }
      const name = str(op['summary']) || str(op['operationId']) || `${m} ${path}`;
      const tag = Array.isArray(op['tags']) && typeof op['tags'][0] === 'string' ? (op['tags'][0] as string) : (path.split('/').filter((s) => s !== '' && !s.startsWith('{'))[0] ?? '');
      const url = `{{base_url}}${path.replace(/\{([^}/]+)\}/g, '{{$1}}')}`;
      const request = ApiRequest.create({ id: newId(), name: name.slice(0, 120), method: m as ApiMethod, url, query, headers, body, auth });
      groups.set(tag, [...(groups.get(tag) ?? []), request]);
      for (const v of request.variableNames()) if (!variables.some((x) => x.name === v)) variables.push({ name: v, value: '' });
    }
  }
  if (count === 0) throw new ApiError('The OpenAPI document has no operations.');
  return { name: str(info['title']).slice(0, 80) || 'OpenAPI', groups: [...groups].map(([name, requests]) => ({ name, requests })), variables };
}
