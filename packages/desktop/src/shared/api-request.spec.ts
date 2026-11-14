import { describe, expect, it } from 'vitest';
import { ApiError, ApiRequest, isVariableRef, pathVariableNames, variablesIn } from './api-request.js';

// 시험용 가짜 비밀은 조각을 이어 붙여 만든다
const FAKE = ['tok', 'en', '-abc', '123456'].join('');
const vars = (o: Record<string, string>): Map<string, string> => new Map(Object.entries(o));
const req = (p: Partial<Parameters<typeof ApiRequest.create>[0]> = {}): ApiRequest => ApiRequest.create({ id: 'r1', name: 'List users', url: '{{base}}/users', ...p });

describe('변수 치환', () => {
  it('{{name}}은 환경의 값으로 바뀐다', () => {
    expect(req().prepare(vars({ base: 'http://localhost:3000' })).url).toBe('http://localhost:3000/users');
  });
  it('없는 변수는 이름을 모두 알리며 오류가 난다', () => {
    const r = req({ url: '{{base}}/{{id}}', headers: [{ key: 'X', value: '{{other}}', enabled: true }] });
    try {
      r.prepare(vars({}));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).missing).toEqual(['base', 'id', 'other']);
      expect((e as ApiError).message).toContain('{{base}}');
    }
  });
  it('꺼 둔 줄의 변수는 없어도 오류가 아니다', () => {
    const r = req({ url: 'http://x', headers: [{ key: 'X', value: '{{nope}}', enabled: false }] });
    expect(() => r.prepare(vars({}))).not.toThrow();
  });
  it('변수 이름 목록과 "변수 하나뿐인 값" 판별', () => {
    expect(variablesIn('{{a}}/{{ b }}/{{a}}')).toEqual(['a', 'b']);
    expect(isVariableRef('{{token}}')).toBe(true);
    expect(isVariableRef(' ')).toBe(true);
    expect(isVariableRef(FAKE)).toBe(false);
    expect(isVariableRef(`Bearer {{token}}`)).toBe(false);
  });
});

describe('보낼 요청 만들기', () => {
  it('켜진 쿼리만 주소 뒤에 인코딩해 붙인다', () => {
    const r = req({ url: 'http://x/a?z=1', query: [{ key: 'q', value: 'a b', enabled: true }, { key: 'off', value: '1', enabled: false }] });
    expect(r.prepare(vars({})).url).toBe('http://x/a?z=1&q=a%20b');
  });
  it('JSON 본문은 Content-Type을 채우고, 있으면 건드리지 않는다', () => {
    const r = req({ method: 'POST', url: 'http://x', body: { kind: 'json', text: '{"a":1}' } });
    expect(r.prepare(vars({})).headers).toContainEqual(['Content-Type', 'application/json']);
    const own = req({ method: 'POST', url: 'http://x', headers: [{ key: 'content-type', value: 'application/vnd.api+json', enabled: true }], body: { kind: 'json', text: '{}' } });
    expect(own.prepare(vars({})).headers.filter(([k]) => k.toLowerCase() === 'content-type')).toHaveLength(1);
  });
  it('폼 본문은 urlencoded로 만든다', () => {
    const r = req({ method: 'POST', url: 'http://x', body: { kind: 'form', fields: [{ key: 'a b', value: '1&2', enabled: true }] } });
    expect(r.prepare(vars({})).body).toBe('a%20b=1%262');
  });
  it('GET과 HEAD에는 본문을 싣지 않는다', () => {
    expect(req({ url: 'http://x', body: { kind: 'raw', text: 'hi' } }).prepare(vars({})).body).toBeNull();
  });
  it('주소가 비어 있으면 오류다', () => {
    expect(() => req({ url: '  ' }).prepare(vars({}))).toThrow('Enter a URL');
  });
});

describe('인증', () => {
  it('Bearer는 Authorization 헤더가 된다', () => {
    const p = req({ url: 'http://x', auth: { kind: 'bearer', token: '{{t}}' } }).prepare(vars({ t: FAKE }));
    expect(p.headers).toContainEqual(['Authorization', `Bearer ${FAKE}`]);
    expect(p.secrets).toContain(FAKE);
  });
  it('Basic은 사용자:비밀번호를 base64로 보낸다', () => {
    const p = req({ url: 'http://x', auth: { kind: 'basic', username: 'kim', password: '{{pw}}' } }).prepare(vars({ pw: 'p@ss word' }));
    expect(p.headers).toContainEqual(['Authorization', `Basic ${Buffer.from('kim:p@ss word').toString('base64')}`]);
  });
  it('API key는 헤더로도 쿼리로도 보낼 수 있다', () => {
    const h = req({ url: 'http://x', auth: { kind: 'apikey', name: 'X-Api-Key', value: '{{k}}', in: 'header' } }).prepare(vars({ k: FAKE }));
    expect(h.headers).toContainEqual(['X-Api-Key', FAKE]);
    const q = req({ url: 'http://x', auth: { kind: 'apikey', name: 'key', value: '{{k}}', in: 'query' } }).prepare(vars({ k: FAKE }));
    expect(q.url).toBe(`http://x?key=${FAKE}`);
  });
});

describe('비밀은 변수 이름으로만 둔다', () => {
  it('값으로 적힌 토큰·비밀번호·민감한 헤더는 literalSecretFields에 잡힌다', () => {
    const r = req({ auth: { kind: 'bearer', token: FAKE }, headers: [{ key: 'X-Api-Key', value: FAKE, enabled: true }, { key: 'Accept', value: '*/*', enabled: true }] });
    expect(r.literalSecretFields()).toEqual(['auth.token', 'headers.0']);
    expect(req({ auth: { kind: 'bearer', token: '{{token}}' } }).literalSecretFields()).toEqual([]);
  });
  it('withSecretsAsVariables는 값을 {{이름}}으로 바꾸고 값 목록을 돌려준다', () => {
    const { request, secrets } = req({ auth: { kind: 'bearer', token: FAKE } }).withSecretsAsVariables();
    expect(request.props.auth).toEqual({ kind: 'bearer', token: '{{list_users_token}}' });
    expect(secrets).toEqual([{ name: 'list_users_token', value: FAKE }]);
    expect(JSON.stringify(request.props)).not.toContain(FAKE);
  });
  it('Authorization 헤더의 Bearer 접두사는 남기고 값만 바꾼다', () => {
    const { request } = req({ headers: [{ key: 'Authorization', value: `Bearer ${FAKE}`, enabled: true }] }).withSecretsAsVariables();
    expect(request.props.headers[0]?.value).toMatch(/^Bearer \{\{list_users_authorization\}\}$/);
  });
  it('이미 변수 이름이면 그대로다(같은 객체)', () => {
    const r = req({ auth: { kind: 'bearer', token: '{{t}}' } });
    expect(r.withSecretsAsVariables().request).toBe(r);
  });
});

describe('경로 변수(Postman :id · APIdog {id})', () => {
  it('URL 의 :id 와 {id} 를 이름 순서대로 찾는다({{변수}}와 포트는 빼고)', () => {
    expect(pathVariableNames('{{base_url}}/users/:id/posts/{postId}?q=:nope')).toEqual(['id', 'postId']);
    expect(pathVariableNames('http://localhost:3000/a')).toEqual([]);
  });
  it('보낼 때 Params 의 경로 변수 값을 인코딩해 채운다(값에 {{변수}}도 된다)', () => {
    const r = req({ url: '{{base}}/users/:id/files/{name}', pathVars: [{ key: 'id', value: '{{uid}}', enabled: true }, { key: 'name', value: 'a b.txt', enabled: true }] });
    expect(r.prepare(vars({ base: 'http://x', uid: '42' })).url).toBe('http://x/users/42/files/a%20b.txt');
  });
  it('값이 없는 경로 변수가 있으면 이름을 알리며 보내지 않는다', () => {
    expect(() => req({ url: 'http://x/users/:id' }).prepare(vars({}))).toThrow(/:id/);
  });
  it('내보내기용 URL 은 값이 있는 경로 변수만 채운다', () => {
    const r = req({ url: '{{base}}/users/:id/:other', pathVars: [{ key: 'id', value: '7', enabled: true }] });
    expect(r.urlWithPathVars()).toBe('{{base}}/users/7/:other');
  });
});

describe('multipart/form-data', () => {
  it('글 필드와 파일 필드를 나눠 준비하고 본문 글은 없다', () => {
    const r = req({ method: 'POST', url: 'http://x/upload', body: { kind: 'multipart', parts: [{ key: 'title', value: '{{t}}', enabled: true, file: false }, { key: 'doc', value: 'C:\\a\\b.pdf', enabled: true, file: true }, { key: 'off', value: 'x', enabled: false, file: false }] } });
    const p = r.prepare(vars({ t: '제목' }));
    expect(p.body).toBeNull();
    expect(p.multipart).toEqual([{ name: 'title', value: '제목' }, { name: 'doc', file: 'C:\\a\\b.pdf' }]);
  });
  it('사용자가 적은 multipart Content-Type 은 떼어 낸다(경계 문자열은 보내기가 만든다)', () => {
    const r = req({ method: 'POST', url: 'http://x', headers: [{ key: 'Content-Type', value: 'multipart/form-data', enabled: true }], body: { kind: 'multipart', parts: [{ key: 'a', value: '1', enabled: true, file: false }] } });
    expect(r.prepare(vars({})).headers.some(([k]) => k.toLowerCase() === 'content-type')).toBe(false);
  });
  it('파일 경로가 비어 있으면 알린다', () => {
    const r = req({ method: 'POST', url: 'http://x', body: { kind: 'multipart', parts: [{ key: 'doc', value: '', enabled: true, file: true }] } });
    expect(() => r.prepare(vars({}))).toThrow(/Choose a file for doc/);
  });
});

describe('헤더 값의 글자', () => {
  it('한글처럼 Latin-1 밖 글자가 있으면 무엇을 하면 되는지 알린다', () => {
    const r = req({ url: 'http://x', headers: [{ key: 'X-Name', value: '김평화', enabled: true }] });
    expect(() => r.prepare(vars({}))).toThrow(/X-Name.*encodeURIComponent/);
  });
});

describe('응답 뒤 규칙', () => {
  it('규칙이 없으면 비어 있고, 있으면 그대로 들고 다닌다', () => {
    expect(req().props.after).toEqual({ captures: [], checks: [] });
    const after = { captures: [{ name: 'token', from: 'json' as const, path: 'accessToken', enabled: true }], checks: [] };
    expect(req({ after }).props.after).toEqual(after);
  });
});

describe('변수 안의 변수와 동적 변수', () => {
  it('환경 값 안의 {{변수}}도 채운다(Postman 처럼)', () => {
    expect(req({ url: '{{base}}/x' }).prepare(vars({ base: 'http://{{host}}:{{port}}', host: 'localhost', port: '4510' })).url).toBe('http://localhost:4510/x');
  });
  it('서로를 부르는 변수는 끝없이 돌지 않고 멈춘다', () => {
    expect(() => req({ url: '{{a}}/x' }).prepare(vars({ a: '{{b}}', b: '{{a}}' }))).toThrow(/refer to each other/);
  });
  it('안쪽 변수가 없으면 그 이름을 알린다', () => {
    expect(() => req({ url: '{{base}}/x' }).prepare(vars({ base: 'http://{{host}}' }))).toThrow(/\{\{host\}\}/);
  });
  it('{{$guid}} {{$timestamp}} {{$randomInt}} 같은 동적 변수는 보낼 때마다 새로 만든다', () => {
    const r = req({ url: 'http://x/{{$guid}}', method: 'POST', body: { kind: 'json', text: '{"t":{{$timestamp}},"i":"{{$isoTimestamp}}","n":{{$randomInt}}}' } });
    const p = r.prepare(vars({}), new Set(), { now: () => Date.parse('2026-11-14T00:00:00Z'), uuid: () => 'u-1', random: () => 0.5 });
    expect(p.url).toBe('http://x/u-1');
    expect(JSON.parse(p.body as string)).toEqual({ t: 1794614400, i: '2026-11-14T00:00:00.000Z', n: 500 });
  });
  it('모르는 동적 변수는 이름을 알린다', () => {
    expect(() => req({ url: 'http://x/{{$nope}}' }).prepare(vars({}))).toThrow(/\{\{\$nope\}\}/);
  });
});

describe('주소 앞 http:// 생략', () => {
  it('localhost:3000/x 처럼 쓰면 http:// 를 붙인다', () => {
    expect(req({ url: 'localhost:3000/x' }).prepare(vars({})).url).toBe('http://localhost:3000/x');
    expect(req({ url: '{{host}}/x' }).prepare(vars({ host: 'api.test' })).url).toBe('http://api.test/x');
    expect(req({ url: 'api.test:8080/x' }).prepare(vars({})).url).toBe('http://api.test:8080/x');
    expect(req({ url: 'file:///etc/passwd' }).prepare(vars({})).url).toBe('file:///etc/passwd');
  });
});
