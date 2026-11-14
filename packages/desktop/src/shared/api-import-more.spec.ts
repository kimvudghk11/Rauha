import { describe, expect, it } from 'vitest';
import { parseHttpFile } from './api-http-file.js';
import { detectImportFormat } from './api-import-format.js';
import { parseOpenApi } from './api-openapi.js';
import { parsePostman } from './api-postman.js';

let n = 0;
const newId = (): string => `id${++n}`;

const postman = {
  info: { name: 'Shop', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] },
  variable: [{ key: 'base_url', value: 'http://localhost:3000' }, { key: 'token', value: '' }],
  item: [
    {
      name: 'Auth',
      item: [
        {
          name: 'Login',
          event: [{ listen: 'test', script: { exec: ['pm.test("ok", function () { pm.response.to.have.status(200); });', 'var j = pm.response.json();', 'pm.environment.set("token", j.data.accessToken);', 'pm.collectionVariables.set("uid", pm.response.json().data.user.id);'] } }],
          request: { method: 'POST', auth: { type: 'noauth' }, header: [{ key: 'Content-Type', value: 'application/json' }, { key: 'X-Off', value: '1', disabled: true }], body: { mode: 'raw', raw: '{"email":"a@b.c"}', options: { raw: { language: 'json' } } }, url: { raw: '{{base_url}}/auth/login', host: ['{{base_url}}'], path: ['auth', 'login'] } },
        },
      ],
    },
    {
      name: 'Users',
      item: [
        { name: 'Get user', request: { method: 'GET', url: { raw: '{{base_url}}/users/:id?expand=roles', variable: [{ key: 'id', value: '7' }], query: [{ key: 'expand', value: 'roles' }] } } },
        { name: 'Avatar', request: { method: 'POST', url: '{{base_url}}/users/:id/avatar', body: { mode: 'formdata', formdata: [{ key: 'title', value: 'me', type: 'text' }, { key: 'file', type: 'file', src: '/tmp/me.png' }] } } },
        { name: 'Search', request: { method: 'POST', url: '{{base_url}}/search', auth: { type: 'apikey', apikey: [{ key: 'key', value: 'X-Key' }, { key: 'value', value: '{{api_key}}' }, { key: 'in', value: 'header' }] }, body: { mode: 'urlencoded', urlencoded: [{ key: 'q', value: 'kim' }] } } },
      ],
    },
  ],
};

describe('Postman 컬렉션(v2.0·v2.1) 가져오기', () => {
  const imp = parsePostman(JSON.stringify(postman), newId);
  const all = imp.groups.flatMap((g) => g.requests);
  const by = (name: string) => all.find((r) => r.name === name)?.props;

  it('폴더는 묶음이 되고 컬렉션 변수는 환경 변수가 된다', () => {
    expect(imp.name).toBe('Shop');
    expect(imp.groups.map((g) => g.name)).toEqual(['Auth', 'Users']);
    expect(imp.variables).toEqual(expect.arrayContaining([{ name: 'base_url', value: 'http://localhost:3000' }, { name: 'token', value: '' }]));
  });
  it('raw JSON 본문·꺼진 헤더·noauth 를 그대로 옮긴다', () => {
    const p = by('Login');
    expect(p).toMatchObject({ method: 'POST', url: '{{base_url}}/auth/login', body: { kind: 'json', text: '{"email":"a@b.c"}' }, auth: { kind: 'none' } });
    expect(p?.headers).toEqual([{ key: 'Content-Type', value: 'application/json', enabled: true }, { key: 'X-Off', value: '1', enabled: false }]);
  });
  it('흔한 테스트 스크립트(상태 검사·environment.set)는 After response 규칙으로 바꾼다', () => {
    expect(by('Login')?.after).toEqual({
      captures: [
        { name: 'token', from: 'json', path: '$.data.accessToken', enabled: true },
        { name: 'uid', from: 'json', path: '$.data.user.id', enabled: true },
      ],
      checks: [{ target: 'status', path: '', op: 'eq', value: '200', enabled: true }],
    });
  });
  it('경로 변수·쿼리·컬렉션 인증 상속', () => {
    const p = by('Get user');
    expect(p).toMatchObject({ url: '{{base_url}}/users/:id', pathVars: [{ key: 'id', value: '7', enabled: true }], query: [{ key: 'expand', value: 'roles', enabled: true }], auth: { kind: 'bearer', token: '{{token}}' } });
  });
  it('formdata 는 multipart(파일 포함), urlencoded 는 폼, apikey 인증', () => {
    expect(by('Avatar')?.body).toEqual({ kind: 'multipart', parts: [{ key: 'title', value: 'me', enabled: true, file: false }, { key: 'file', value: '/tmp/me.png', enabled: true, file: true }] });
    expect(by('Search')).toMatchObject({ body: { kind: 'form', fields: [{ key: 'q', value: 'kim', enabled: true }] }, auth: { kind: 'apikey', name: 'X-Key', value: '{{api_key}}', in: 'header' } });
  });
  it('Postman 컬렉션이 아니면 알기 쉬운 오류', () => {
    expect(() => parsePostman('{"a":1}', newId)).toThrow(/Postman collection/);
    expect(() => parsePostman('nope', newId)).toThrow(/JSON/);
  });
});

describe('Swagger 2.0 과 OpenAPI 경로 변수', () => {
  const swagger = { swagger: '2.0', info: { title: 'Pets', version: '1' }, host: 'localhost:4510', basePath: '/v1', schemes: ['http'], securityDefinitions: { key: { type: 'apiKey', name: 'X-Key', in: 'header' } }, security: [{ key: [] }], paths: { '/pets/{id}': { get: { summary: 'Get pet', parameters: [{ name: 'id', in: 'path', required: true, type: 'string', 'x-example': '3' }] } }, '/pets': { post: { summary: 'Add pet', parameters: [{ name: 'body', in: 'body', schema: { type: 'object', properties: { name: { type: 'string', example: 'Tom' } } } }] } } } };
  it('Swagger 2.0 도 읽고 host·basePath 로 base_url 을 만든다', () => {
    const imp = parseOpenApi(JSON.stringify(swagger), newId);
    expect(imp.variables).toContainEqual({ name: 'base_url', value: 'http://localhost:4510/v1' });
    const reqs = imp.groups.flatMap((g) => g.requests).map((r) => r.props);
    expect(reqs.find((r) => r.name === 'Get pet')).toMatchObject({ url: '{{base_url}}/pets/:id', pathVars: [{ key: 'id', value: '3', enabled: true }], auth: { kind: 'apikey', name: 'X-Key', in: 'header' } });
    expect(reqs.find((r) => r.name === 'Add pet')?.body).toEqual({ kind: 'json', text: JSON.stringify({ name: 'Tom' }, null, 2) });
  });
  it('OpenAPI 3 의 {id} 도 환경 변수가 아니라 경로 변수 :id 가 된다', () => {
    const doc = { openapi: '3.0.0', info: { title: 'T' }, paths: { '/users/{userId}': { get: { parameters: [{ name: 'userId', in: 'path', example: 5 }] } } } };
    const imp = parseOpenApi(JSON.stringify(doc), newId);
    expect(imp.groups[0]?.requests[0]?.props).toMatchObject({ url: '{{base_url}}/users/:userId', pathVars: [{ key: 'userId', value: '5', enabled: true }] });
    expect(imp.variables.map((v) => v.name)).not.toContain('userId');
  });
});

describe('가져오기 형식 알아보기', () => {
  it('cURL · Postman · OpenAPI(JSON·YAML) · Swagger · .http 를 구분한다', () => {
    expect(detectImportFormat("  curl -X GET 'http://x'")).toBe('curl');
    expect(detectImportFormat(JSON.stringify(postman))).toBe('postman');
    expect(detectImportFormat('{"openapi":"3.0.0","paths":{}}')).toBe('openapi');
    expect(detectImportFormat('{"swagger":"2.0"}')).toBe('openapi');
    expect(detectImportFormat('openapi: 3.1.0\ninfo:\n  title: x')).toBe('openapi');
    expect(detectImportFormat('# comment\nswagger: "2.0"')).toBe('openapi');
    expect(detectImportFormat('### Login\nPOST http://x/login')).toBe('http');
  });
});

describe('.http 가져오기 — 주소가 아닌 줄', () => {
  it('JSON 같은 글을 .http 로 넣으면 요청을 만들지 않고 알린다', () => {
    expect(() => parseHttpFile(JSON.stringify(postman), newId)).toThrow(/request line/);
  });
});
