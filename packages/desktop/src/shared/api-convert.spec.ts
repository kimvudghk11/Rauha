import { describe, expect, it } from 'vitest';
import { parseCurl, shellWords, toCurl } from './api-curl.js';
import { parseHttpFile, toHttpFile } from './api-http-file.js';
import { parseOpenApi } from './api-openapi.js';
import { ApiRequest } from './api-request.js';

const FAKE = ['tok', 'en', '-abc', '123456'].join('');
let n = 0;
const nid = (): string => `i${++n}`;

describe('cURL 가져오기', () => {
  it('따옴표와 줄 잇기를 풀어 낱말로 나눈다', () => {
    expect(shellWords(`curl -H 'A: b c' "x\\"y" \\\n  z`)).toEqual(['curl', '-H', 'A: b c', 'x"y', 'z']);
  });
  it('단순 GET은 이름·URL·쿼리를 채운다', () => {
    const r = parseCurl('curl https://api.test.dev/v1/users?limit=5&q=a%20b', 'r');
    expect(r.props).toMatchObject({ method: 'GET', url: 'https://api.test.dev/v1/users', name: 'GET /v1/users' });
    expect(r.props.query).toEqual([{ key: 'limit', value: '5', enabled: true }, { key: 'q', value: 'a b', enabled: true }]);
  });
  it('-d가 있으면 POST이고 JSON 본문으로 읽는다', () => {
    const r = parseCurl(`curl -X POST http://localhost:3000/items -H 'Content-Type: application/json' -d '{"a":1}'`, 'r');
    expect(r.props.method).toBe('POST');
    expect(r.props.body).toEqual({ kind: 'json', text: '{"a":1}' });
  });
  it('Authorization: Bearer는 인증으로 올리고 헤더에서 뺀다', () => {
    const r = parseCurl(`curl http://x -H 'Authorization: Bearer ${FAKE}'`, 'r');
    expect(r.props.auth).toEqual({ kind: 'bearer', token: FAKE });
    expect(r.props.headers).toHaveLength(0);
  });
  it('-u는 Basic 인증이다', () => {
    expect(parseCurl('curl -u kim:pw1234 http://x', 'r').props.auth).toEqual({ kind: 'basic', username: 'kim', password: 'pw1234' });
  });
  it('-F는 폼 본문, --data-urlencode는 폼 형식 본문이다', () => {
    expect(parseCurl('curl -F a=1 http://x', 'r').props.body).toEqual({ kind: 'form', fields: [{ key: 'a', value: '1', enabled: true }] });
    expect(parseCurl(`curl -H 'Content-Type: application/x-www-form-urlencoded' -d 'a=1&b=x%20y' http://x`, 'r').props.body).toMatchObject({ kind: 'form' });
  });
  it('모르는 옵션(-L -s --compressed -k)은 건너뛴다', () => {
    expect(parseCurl('curl -sSLk --compressed http://x', 'r').props.url).toBe('http://x');
  });
  it('curl로 시작하지 않거나 주소가 없으면 오류다', () => {
    expect(() => parseCurl('wget http://x', 'r')).toThrow('curl');
    expect(() => parseCurl('curl -X POST', 'r')).toThrow('no URL');
    expect(() => parseCurl(`curl 'http://x`, 'r')).toThrow('quote');
  });
});

describe('cURL 내보내기', () => {
  it('변수는 그대로, 값으로 적힌 비밀은 변수 이름으로 바꿔 내보낸다', () => {
    const r = ApiRequest.create({ id: 'r', name: 'Make', method: 'POST', url: '{{base}}/x', auth: { kind: 'bearer', token: FAKE }, body: { kind: 'json', text: `{"a":"it's"}` } });
    const out = toCurl(r);
    expect(out).toContain('{{base}}/x');
    expect(out).toContain('Authorization: Bearer {{make_token}}');
    expect(out).not.toContain(FAKE);
    expect(out).toContain(`'{"a":"it'\\''s"}'`);
  });
  it('내보낸 것을 다시 가져오면 같은 메서드·주소·본문이 나온다', () => {
    const r = ApiRequest.create({ id: 'r', name: 'Make', method: 'PUT', url: 'http://x/y', query: [{ key: 'a', value: '1', enabled: true }], body: { kind: 'json', text: '{"k":2}' } });
    const back = parseCurl(toCurl(r), 'r2');
    expect(back.props).toMatchObject({ method: 'PUT', url: 'http://x/y', body: { kind: 'json', text: '{"k":2}' } });
    expect(back.props.query).toEqual(r.props.query);
  });
});

describe('.http 파일', () => {
  const text = `@host = http://localhost:3000

### List
# comment
GET {{host}}/users
  ?page=2
Accept: application/json

### Create
POST {{host}}/users HTTP/1.1
Content-Type: application/json
Authorization: Bearer {{token}}

{"name": "kim"}
`;
  it('요청 줄·헤더·본문·파일 변수를 읽는다', () => {
    const f = parseHttpFile(text, nid);
    expect(f.variables).toEqual([{ name: 'host', value: 'http://localhost:3000' }]);
    expect(f.requests.map((r) => r.name)).toEqual(['List', 'Create']);
    expect(f.requests[0]?.props.query).toEqual([{ key: 'page', value: '2', enabled: true }]);
    expect(f.requests[1]?.props.auth).toEqual({ kind: 'bearer', token: '{{token}}' });
    expect(f.requests[1]?.props.body).toEqual({ kind: 'json', text: '{"name": "kim"}' });
  });
  it('요청이 하나도 없으면 오류다', () => expect(() => parseHttpFile('# nothing', nid)).toThrow('No request'));
  it('쓸 때 값으로 적힌 비밀은 {{이름}}으로 바뀌어 파일에 들어가지 않는다', () => {
    const r = ApiRequest.create({ id: 'r', name: 'Make', method: 'POST', url: 'http://x', auth: { kind: 'bearer', token: FAKE }, headers: [{ key: 'X-Api-Key', value: FAKE, enabled: true }], body: { kind: 'json', text: '{}' } });
    const out = toHttpFile([r]);
    expect(out).not.toContain(FAKE);
    expect(out).toContain('Authorization: Bearer {{make_token}}');
    expect(out).toContain('X-Api-Key: {{make_token}}');
  });
  it('쓴 파일을 다시 읽으면 같은 요청이 된다', () => {
    const r = ApiRequest.create({ id: 'r', name: 'Make', method: 'POST', url: '{{host}}/a', query: [{ key: 'q', value: 'x y', enabled: true }], headers: [{ key: 'Accept', value: 'a/b', enabled: true }], body: { kind: 'json', text: '{"a":1}' } });
    const back = parseHttpFile(toHttpFile([r]), nid).requests[0] as ApiRequest;
    expect(back.props).toMatchObject({ name: 'Make', method: 'POST', url: '{{host}}/a', body: { kind: 'json', text: '{"a":1}' } });
    expect(back.props.query).toEqual(r.props.query);
  });
  it('Basic은 사용자와 비밀번호 변수로 쓰고 다시 읽는다', () => {
    const r = ApiRequest.create({ id: 'r', name: 'B', url: 'http://x', auth: { kind: 'basic', username: 'kim', password: FAKE } });
    const out = toHttpFile([r]);
    expect(out).not.toContain(FAKE);
    expect(parseHttpFile(out, nid).requests[0]?.props.auth).toEqual({ kind: 'basic', username: 'kim', password: '{{b_password}}' });
  });
});

describe('OpenAPI 가져오기', () => {
  const doc = {
    openapi: '3.0.3',
    info: { title: 'Pets' },
    servers: [{ url: 'https://pets.test/v1/' }],
    security: [{ bearer: [] }],
    components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
    paths: {
      '/pets': {
        get: { summary: 'List pets', tags: ['pets'], parameters: [{ name: 'limit', in: 'query', required: true, schema: { type: 'integer' } }] },
        post: { operationId: 'addPet', tags: ['pets'], requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, age: { type: 'integer' } } } } } } },
      },
      '/pets/{id}': { delete: { summary: 'Remove' } },
    },
  };
  it('경로·메서드마다 요청이 되고 첫 태그(없으면 첫 경로 조각)로 묶인다', () => {
    const c = parseOpenApi(JSON.stringify(doc), nid);
    expect(c.name).toBe('Pets');
    expect(c.groups.map((g) => g.name)).toEqual(['pets']);
    expect(c.groups[0]?.requests.map((r) => r.name)).toEqual(['List pets', 'addPet', 'Remove']);
  });
  it('서버 URL은 base_url 변수이고, 요청은 {{base_url}}과 {{id}}를 쓴다', () => {
    const c = parseOpenApi(JSON.stringify(doc), nid);
    expect(c.variables).toContainEqual({ name: 'base_url', value: 'https://pets.test/v1' });
    const del = c.groups[0]?.requests[2];
    expect(del?.props.url).toBe('{{base_url}}/pets/{{id}}');
    expect(c.variables.map((v) => v.name)).toContain('id');
  });
  it('Bearer 인증은 {{token}} 변수를 가리키고, 본문은 스키마로 예시를 만든다', () => {
    const c = parseOpenApi(JSON.stringify(doc), nid);
    const post = c.groups[0]?.requests[1];
    expect(post?.props.auth).toEqual({ kind: 'bearer', token: '{{token}}' });
    expect(post?.props.body).toEqual({ kind: 'json', text: JSON.stringify({ name: '', age: 0 }, null, 2) });
  });
  it('필수 쿼리만 켜진 채로 들어온다', () => {
    const q = parseOpenApi(JSON.stringify(doc), nid).groups[0]?.requests[0]?.props.query;
    expect(q).toEqual([{ key: 'limit', value: '0', enabled: true }]);
  });
  it('OpenAPI가 아니거나 JSON이 아니면 오류다', () => {
    expect(() => parseOpenApi('{', nid)).toThrow('JSON');
    expect(() => parseOpenApi('{"swagger":"2.0"}', nid)).toThrow('3.x');
  });
});
