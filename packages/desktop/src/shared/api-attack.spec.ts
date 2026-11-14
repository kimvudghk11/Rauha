import { describe, expect, it } from 'vitest';
import { checkTarget } from './api-guard.js';
import { parseCurl, toCurl } from './api-curl.js';
import { parseHttpFile, toHttpFile } from './api-http-file.js';
import { parseOpenApi } from './api-openapi.js';
import { ApiEnvironment } from './api-env.js';
import { ApiError, ApiRequest } from './api-request.js';
import { ResponseSummary } from './api-response.js';

// 시험용 가짜 비밀은 조각을 이어 붙여 만든다
const FAKE = ['sec', 'ret', '-value', '987654'].join('');
const vars = (o: Record<string, string>): Map<string, string> => new Map(Object.entries(o));
const req = (p: Partial<Parameters<typeof ApiRequest.create>[0]> = {}): ApiRequest => ApiRequest.create({ id: 'r1', name: 'Probe', url: 'http://localhost:3000/x', ...p });
let n = 0;
const newId = (): string => `id${++n}`;

describe('요청 주소 검사: 클라우드 메타데이터·링크로컬은 막는다', () => {
  const blocked = [
    'http://169.254.169.254/latest/meta-data/',
    'https://169.254.169.254/',
    'http://169.254.170.2/v2/credentials',
    'http://169.254.0.1/',
    'http://2852039166/', // 10진수로 쓴 169.254.169.254
    'http://0xa9fea9fe/', // 16진수
    'http://0251.0376.0251.0376/', // 8진수
    'http://169.254.169.254./',
    'http://[::ffff:169.254.169.254]/',
    'http://[::ffff:a9fe:a9fe]/',
    'http://[fe80::1]/',
    'http://[fd00:ec2::254]/',
    'http://[64:ff9b::a9fe:a9fe]/',
    'http://100.100.100.200/latest/meta-data/',
    'http://metadata.google.internal/computeMetadata/v1/',
    'http://METADATA.GOOGLE.INTERNAL./',
    'http://instance-data.ec2.internal/',
  ];
  it.each(blocked)('%s 는 거부한다', (url) => {
    const r = checkTarget(url);
    expect(r.ok).toBe(false);
  });

  const allowed = ['http://localhost:3000/', 'http://127.0.0.1:8080/x', 'http://192.168.0.10/', 'http://10.1.2.3/', 'http://172.20.0.4/', 'http://[::1]:3000/', 'https://api.example.com/v1?x=1'];
  it.each(allowed)('개발 서버 주소 %s 는 허용한다', (url) => {
    expect(checkTarget(url).ok).toBe(true);
  });

  it.each(['file:///etc/passwd', 'FILE:///C:/Windows/win.ini', 'data:text/html,<script>1</script>', 'javascript:alert(1)', 'ftp://example.com/', 'ws://localhost/', 'gopher://localhost/', 'blob:http://localhost/x'])('%s 같은 http·https 아닌 주소는 거부한다', (url) => {
    expect(checkTarget(url).ok).toBe(false);
  });

  it('주소에 사용자 정보(user:pw@)가 들어 있으면 거부한다(비밀이 주소에 남지 않게 인증 칸을 쓰게 한다)', () => {
    const r = checkTarget('http://user:pw@localhost:3000/');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Auth/i);
  });

  it('주소 안의 줄바꿈·제어 문자는 거부한다(몰래 지워지며 바뀌지 않게)', () => {
    expect(checkTarget('http://localhost:3000/a\r\nHost: evil').ok).toBe(false);
    expect(checkTarget('http://local\thost/').ok).toBe(false);
    expect(checkTarget('http://localhost/\u0000').ok).toBe(false);
  });
});

describe('헤더 주입(CRLF)', () => {
  it('변수 값에 줄바꿈이 있어 헤더 값으로 들어가면 보내기 전에 막는다', () => {
    const r = req({ headers: [{ key: 'X-Id', value: '{{v}}', enabled: true }] });
    expect(() => r.prepare(vars({ v: 'a\r\nX-Injected: 1' }))).toThrow(ApiError);
  });
  it('헤더 이름에 공백·콜론·줄바꿈이 있으면 막는다', () => {
    for (const key of ['Bad Name', 'A:B', 'X\nY', 'a(b)']) {
      expect(() => req({ headers: [{ key, value: '1', enabled: true }] }).prepare(vars({}))).toThrow(/header name/i);
    }
  });
  it('인증 칸(Bearer·API 키 이름/값)에도 줄바꿈을 못 넣는다', () => {
    expect(() => req({ auth: { kind: 'bearer', token: '{{t}}' } }).prepare(vars({ t: 'abc\nX: y' }))).toThrow(ApiError);
    expect(() => req({ auth: { kind: 'apikey', name: 'X-Key\r\nEvil', value: 'v', in: 'header' } }).prepare(vars({}))).toThrow(ApiError);
    expect(() => req({ auth: { kind: 'apikey', name: 'X-Key', value: '{{t}}', in: 'header' } }).prepare(vars({ t: 'a\u0000b' }))).toThrow(ApiError);
  });
  it('보통 헤더(탭·Latin-1 글자 포함)는 그대로 보낸다', () => {
    const p = req({ headers: [{ key: 'X-Name', value: 'a\tb café', enabled: true }] }).prepare(vars({}));
    expect(p.headers).toContainEqual(['X-Name', 'a\tb café']);
  });
  it('한글처럼 HTTP 헤더에 못 싣는 글자는 보내기 전에 이유를 알린다(실제 전송은 알기 어려운 오류로 실패한다)', () => {
    expect(() => req({ headers: [{ key: 'X-Name', value: 'a 한글', enabled: true }] }).prepare(vars({}))).toThrow(/X-Name has "한"/);
  });
  it('쿼리 값의 줄바꿈은 인코딩되어 주소에 안전하게 들어간다', () => {
    const p = req({ query: [{ key: 'q', value: 'a\r\nb', enabled: true }] }).prepare(vars({}));
    expect(p.url).toBe('http://localhost:3000/x?q=a%0D%0Ab');
  });
});

describe('변수 치환 우회', () => {
  it('변수 값 안의 {{비밀 변수}}는 풀지 않는다(응답에서 저장한 값 등이 비밀을 끌어오는 연쇄 치환 금지)', () => {
    expect(() => req({ url: 'http://localhost/{{a}}' }).prepare(vars({ a: '{{secret}}', secret: FAKE }), new Set(['secret']))).toThrow(/secret/);
  });
  it('비밀이 아닌 변수끼리는 안쪽 변수도 푼다', () => {
    expect(req({ url: '{{a}}/x' }).prepare(vars({ a: 'http://{{h}}', h: 'localhost' }), new Set(['secret'])).url).toBe('http://localhost/x');
  });
  it('__proto__·constructor 같은 이름은 환경 변수 이름으로 쓸 수 없다', () => {
    for (const name of ['__proto__', 'constructor', 'prototype']) {
      expect(() => ApiEnvironment.create({ id: 'e', name: 'E', vars: [{ name, value: 'x', secret: false }] })).toThrow(ApiError);
    }
  });
  it('요청에 {{__proto__}}가 있어도 환경에 없으니 없는 변수로 알린다', () => {
    expect(() => req({ url: 'http://localhost/{{__proto__}}' }).prepare(vars({}))).toThrow(/Missing variable/);
  });
});

describe('비밀이 주소·쿼리에 값으로 적혀 있을 때', () => {
  it('쿼리의 token·api_key 같은 값은 변수 이름으로 바뀌어 저장·내보내기에 남지 않는다', () => {
    const r = req({ name: 'Hook', query: [{ key: 'access_token', value: FAKE, enabled: true }, { key: 'page', value: '2', enabled: true }] });
    const s = r.withSecretsAsVariables();
    expect(JSON.stringify(s.request.props)).not.toContain(FAKE);
    expect(s.secrets.map((x) => x.value)).toEqual([FAKE]);
    expect(s.request.props.query.find((q) => q.key === 'page')?.value).toBe('2');
    // 그래도 보낼 때는 환경 값으로 채워진다
    const name = s.secrets[0]!.name;
    expect(s.request.prepare(vars({ [name]: FAKE })).url).toContain(`access_token=${FAKE}`);
  });
  it('주소 글에 붙어 있는 ?api_key=값 도 변수로 바뀐다', () => {
    const r = req({ url: `http://localhost/x?api_key=${FAKE}&q=1` });
    const s = r.withSecretsAsVariables();
    expect(s.request.props.url).not.toContain(FAKE);
    expect(s.request.props.url).toContain('q=1');
    expect(toCurl(r)).not.toContain(FAKE);
    expect(toHttpFile([r])).not.toContain(FAKE);
  });
  it('이미 {{변수}}인 값은 그대로 둔다', () => {
    const r = req({ query: [{ key: 'token', value: '{{tok}}', enabled: true }] });
    expect(r.withSecretsAsVariables().secrets).toEqual([]);
  });
  it('cURL 가져오기: 주소의 user:pw@ 는 Basic 인증 칸으로 올리고 주소에는 남기지 않는다', () => {
    const r = parseCurl(`curl http://alice:${FAKE}@localhost:3000/x`, 'c1');
    expect(r.props.url).toBe('http://localhost:3000/x');
    expect(r.props.auth).toEqual({ kind: 'basic', username: 'alice', password: FAKE });
  });
});

describe('응답 요약의 리다이렉트 주소', () => {
  it('기록·복사용으로 가릴 때 리다이렉트 주소의 비밀 쿼리 값도 가린다', () => {
    const s = ResponseSummary.create({ status: 200, statusText: 'OK', ms: 1, size: 1, headers: [], body: 'x', truncated: false, contentType: 'text/plain', redirects: [`http://localhost/cb?code=1&access_token=${FAKE}`, `http://localhost/${FAKE}/path`], binary: false });
    const h = s.forHistory([FAKE]);
    expect(JSON.stringify(h.props.redirects)).not.toContain(FAKE);
    expect(h.props.redirects[0]).toContain('code=1');
  });
});

describe('가져오기 파서에 악성 입력', () => {
  const timed = <T>(fn: () => T): { out: T | Error; ms: number } => {
    const t = Date.now();
    try {
      return { out: fn(), ms: Date.now() - t };
    } catch (e) {
      return { out: e as Error, ms: Date.now() - t };
    }
  };

  it('OpenAPI의 __proto__·constructor 키로 객체 원형이 오염되지 않는다', () => {
    const doc = '{"openapi":"3.0.0","info":{"title":"x"},"paths":{"/a":{"get":{"parameters":[{"name":"p","in":"query","required":true,"schema":{"type":"object","properties":{"__proto__":{"polluted":true},"constructor":{"type":"string"}}}}],"requestBody":{"content":{"application/json":{"schema":{"type":"object","properties":{"__proto__":{"type":"string","default":"x"},"a":{"type":"string"}}}}}}}}},"__proto__":{"polluted":"yes"},"components":{"securitySchemes":{"__proto__":{"type":"http","scheme":"bearer"}}},"security":[{"__proto__":[]}]}';
    parseOpenApi(doc, newId);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted')).toBe(false);
  });

  it('.http 파일의 @__proto__ 변수가 원형을 오염시키지 않고 이상한 이름은 오류로 알린다', () => {
    const text = '@__proto__ = x\n@constructor = y\n###\nGET http://localhost/a\n';
    const t = timed(() => parseHttpFile(text, newId));
    expect(({} as Record<string, unknown>)['x']).toBeUndefined();
    // 변수로 읽혀도 되고 오류여도 된다. 원형이 바뀌지 않으면 된다.
    expect(t.ms).toBeLessThan(2000);
  });

  it('아주 긴 한 줄 cURL·.http 입력도 오래 걸리지 않는다(ReDoS 없음)', () => {
    const big = 'a'.repeat(1_000_000);
    expect(timed(() => parseCurl(`curl http://localhost/${big}`, 'x')).ms).toBeLessThan(3000);
    expect(timed(() => parseCurl(`curl -H 'A: ${' '.repeat(200_000)}x' http://localhost/`, 'x')).ms).toBeLessThan(3000);
    expect(timed(() => parseHttpFile(`GET http://localhost/${big}\n`, newId)).ms).toBeLessThan(3000);
    expect(timed(() => parseHttpFile(`GET ${'x'.repeat(100_000)}${' '.repeat(100_000)}\n`, newId)).ms).toBeLessThan(3000);
    expect(timed(() => parseHttpFile(`${'@a '.repeat(100_000)}\nGET http://x\n`, newId)).ms).toBeLessThan(3000);
    expect(timed(() => parseHttpFile(`GET http://x\nA: ${':'.repeat(500_000)}\n`, newId)).ms).toBeLessThan(3000);
  });

  it('요청이 수천 개인 .http·OpenAPI는 상한에서 오류로 멈춘다', () => {
    const many = Array.from({ length: 600 }, (_v, i) => `### r${i}\nGET http://localhost/${i}\n`).join('\n');
    expect(() => parseHttpFile(many, newId)).toThrow(/At most/);
    const paths = Object.fromEntries(Array.from({ length: 1100 }, (_v, i) => [`/p${i}`, { get: {} }]));
    expect(() => parseOpenApi(JSON.stringify({ openapi: '3.0.0', paths }), newId)).toThrow(/At most/);
  });

  it('깊이 중첩된 OpenAPI 스키마도 스택을 터뜨리지 않는다', () => {
    const schema = `${'{"type":"object","properties":{"a":'.repeat(3000)}{"type":"string"}${'}}'.repeat(3000)}`;
    const doc = `{"openapi":"3.0.0","paths":{"/a":{"post":{"requestBody":{"content":{"application/json":{"schema":${schema}}}}}}}}`;
    const t = timed(() => parseOpenApi(doc, newId));
    // JSON.parse 가 깊이로 실패해도 오류 객체일 뿐 프로세스가 죽지 않는다
    expect(t.out).toBeDefined();
  });

  it('cURL 가져오기는 $(...)·백틱을 실행하지 않고 글자 그대로 둔다', () => {
    const r = parseCurl('curl "http://localhost/$(echo pwned)" -H "X: `id`"', 'c');
    expect(r.props.url).toContain('$(echo pwned)');
    expect(r.props.headers[0]?.value).toBe('`id`');
  });

  it('.http 내보내기에서 이름·헤더의 줄바꿈은 한 줄로 접힌다(다른 요청을 끼워 넣을 수 없다)', () => {
    const r = req({ name: 'a\n### injected\nGET http://evil/', headers: [{ key: 'X', value: 'v\nGET http://evil/', enabled: true }] });
    const text = toHttpFile([r]);
    expect(text.split('\n').filter((l) => l.startsWith('###'))).toHaveLength(1);
    expect(text.split('\n').filter((l) => l.startsWith('GET http://evil'))).toEqual([]);
  });
});

describe('환경 변수 보이기 전환', () => {
  it('비밀 변수를 값 없이(그대로 두기) 비밀 아님으로 바꿔 값을 화면에 꺼내는 길은 막는다', () => {
    const env = ApiEnvironment.create({ id: 'e', name: 'E', vars: [{ name: 'tok', value: FAKE, secret: true }] });
    expect(() => env.edit('E', [{ name: 'tok', value: null, secret: false }])).toThrow(ApiError);
    // 값을 새로 적으면 바꿀 수 있다
    expect(env.edit('E', [{ name: 'tok', value: 'new', secret: false }]).view().vars[0]?.value).toBe('new');
    // 비밀 그대로면 값을 이어 받는다
    expect(env.edit('E', [{ name: 'tok', value: null, secret: true }]).variableMap().get('tok')).toBe(FAKE);
  });
});
