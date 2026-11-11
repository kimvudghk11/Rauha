import { describe, expect, it } from 'vitest';
import { ApiError, ApiRequest, isVariableRef, variablesIn } from './api-request.js';

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
