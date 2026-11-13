import { describe, expect, it } from 'vitest';
import { ApiRequest } from './api-request.js';
import { ApiTestError, CaseResult, Expectation, LocalTarget, TestCase, TestPlan, TestReport, type TestCaseProps } from './api-test.js';

const base = ApiRequest.create({
  id: 'r1',
  name: 'Create user',
  method: 'POST',
  url: '{{base_url}}/users/{{id}}',
  headers: [{ key: 'X-Trace', value: 't1', enabled: true }],
  body: { kind: 'json', text: '{"email":"user@example.com"}' },
  auth: { kind: 'bearer', token: '{{token}}' },
}).props;

const props = (over: Partial<TestCaseProps> = {}): TestCaseProps => ({
  id: 'c1',
  category: 'validation',
  title: '이메일 형식이 틀리면 400',
  expectNote: 'class-validator 가 막는다',
  pathParams: { id: '1' },
  query: {},
  headers: {},
  body: '{"email":"not-an-email"}',
  auth: 'default',
  repeat: 1,
  parallel: 1,
  expect: Expectation.of([400], []),
  evidence: 'src/users/dto.ts:4',
  mutates: false,
  ...over,
});

describe('로컬 주소 판정', () => {
  it('localhost·127.x·::1 은 로컬이다', () => {
    for (const u of ['http://localhost:3000/a', 'http://127.0.0.1:8080', 'http://127.1.2.3/x', 'http://[::1]:3000/', 'http://api.localhost:3000/']) expect(LocalTarget.isLocal(u)).toBe(true);
  });
  it('사설 IP·외부 주소·이상한 주소는 로컬이 아니다(실행을 막는다)', () => {
    for (const u of ['http://192.168.0.5:3000', 'https://api.example.com', 'http://localhost.evil.com', 'file:///etc/passwd', 'not a url', 'http://0.0.0.0:3000']) expect(LocalTarget.isLocal(u)).toBe(false);
    expect(() => LocalTarget.assert('https://api.example.com/users')).toThrow(ApiTestError);
  });
});

describe('케이스 → 보낼 요청', () => {
  it('경로 변수는 케이스 값으로 바꾸고, 본문·쿼리는 케이스 것을 쓰고, 기본 인증은 그대로 {{token}} 이다', () => {
    const r = TestCase.create(props({ pathParams: { id: '999999' }, query: { page: '1' } })).toRequest(base);
    expect(r.url).toBe('{{base_url}}/users/999999');
    expect(r.query).toEqual([{ key: 'page', value: '1', enabled: true }]);
    expect(r.body).toEqual({ kind: 'json', text: '{"email":"not-an-email"}' });
    expect(r.auth).toEqual({ kind: 'bearer', token: '{{token}}' });
    expect(r.headers).toEqual([{ key: 'X-Trace', value: 't1', enabled: true }]);
  });
  it('인증 없음·틀린 토큰 케이스는 인증을 바꾼다', () => {
    expect(TestCase.create(props({ auth: 'none' })).toRequest(base).auth).toEqual({ kind: 'none' });
    expect(TestCase.create(props({ auth: 'invalid' })).toRequest(base).auth).toEqual({ kind: 'bearer', token: 'invalid-token-for-test' });
  });
  it('JSON 이 아닌 본문은 raw 로 보낸다(타입 틀림 시험)', () => {
    expect(TestCase.create(props({ body: '{bad json' })).toRequest(base).body).toEqual({ kind: 'raw', text: '{bad json' });
  });
  it('모델이 바꾼다고 했거나, DELETE 이거나, 쓰기 메서드로 성공(2xx)을 기대하면 데이터를 바꾸는 케이스다', () => {
    expect(TestCase.create(props({ expect: Expectation.of([201], []) })).changesData('POST')).toBe(true);
    expect(TestCase.create(props()).changesData('POST')).toBe(false);
    expect(TestCase.create(props()).changesData('DELETE')).toBe(true);
    expect(TestCase.create(props()).changesData('GET')).toBe(false);
    expect(TestCase.create(props({ mutates: true })).changesData('GET')).toBe(true);
  });
  it('반복은 1~3번, 동시 요청은 1~5개로 묶는다', () => {
    const c = TestCase.create(props({ repeat: 9, parallel: 50 }));
    expect(c.repeat).toBe(3);
    expect(c.parallel).toBe(5);
  });
});

describe('기대 vs 실제', () => {
  const ok = (status: number, body = '') => ({ status, body, ms: 10, error: null });
  it('기대한 상태 코드면 통과', () => {
    expect(Expectation.of([400, 422], []).judge([ok(422)]).outcome).toBe('pass');
  });
  it('다른 상태 코드면 실패하고 이유에 기대·실제를 적는다', () => {
    const v = Expectation.of([400], []).judge([ok(201)]);
    expect(v.outcome).toBe('fail');
    expect(v.reason).toContain('400');
    expect(v.reason).toContain('201');
  });
  it('기대하지 않은 5xx 는 서버 오류로 실패', () => {
    const v = Expectation.of([400], []).judge([ok(500)]);
    expect(v.outcome).toBe('fail');
    expect(v.reason).toMatch(/server error/i);
  });
  it('응답에 나오면 안 되는 글(숨은 필드·스택)이 있으면 실패', () => {
    expect(Expectation.of([201], ['"role":"admin"']).judge([ok(201, '{"id":1,"role":"admin"}')]).outcome).toBe('fail');
  });
  it('연결이 안 되면 오류(실패와 구분)', () => {
    expect(Expectation.of([200], []).judge([{ status: null, body: '', ms: 3, error: 'Connection refused' }]).outcome).toBe('error');
  });
  it('반복 요청은 마지막 응답으로, 동시 요청은 모든 응답으로 본다', () => {
    expect(Expectation.of([409], []).judge([ok(201), ok(409)], 'last').outcome).toBe('pass');
    expect(Expectation.of([200, 409], []).judge([ok(200), ok(500)], 'all').outcome).toBe('fail');
  });
  it('기대 상태는 100~599 정수만, 하나 이상이어야 한다', () => {
    expect(() => Expectation.of([], [])).toThrow(ApiTestError);
    expect(Expectation.of([200, 99, 700, 200.5, 404], []).statuses).toEqual([200, 404]);
  });
});

describe('시험 계획', () => {
  const plan = TestPlan.create({ id: 'p1', requestId: 'r1', label: 'POST /users/:id', method: 'DELETE', cases: [TestCase.create(props()), TestCase.create(props({ id: 'c2', category: 'happy' }))], notes: '' });
  it('데이터를 바꾸는 케이스를 고르면 실행 전에 확인이 필요하다', () => {
    expect(plan.needsConfirm(['c1'])).toBe(true);
    expect(() => plan.pick(['c1'], false)).toThrow(ApiTestError);
    expect(plan.pick(['c1'], true).map((c) => c.id)).toEqual(['c1']);
  });
  it('없는 케이스나 빈 선택은 실행할 수 없다', () => {
    expect(() => plan.pick([], true)).toThrow(ApiTestError);
    expect(() => plan.pick(['nope'], true)).toThrow(ApiTestError);
  });
  it('케이스가 없으면 계획을 만들 수 없다', () => {
    expect(() => TestPlan.create({ id: 'p', requestId: 'r', label: 'x', method: 'GET', cases: [], notes: '' })).toThrow(ApiTestError);
  });
});

describe('결과와 리포트', () => {
  const c1 = TestCase.create(props());
  const c2 = TestCase.create(props({ id: 'c2', category: 'happy', title: '정상 생성', expect: Expectation.of([201], []) }));
  const plan = TestPlan.create({ id: 'p1', requestId: 'r1', label: 'POST /users/:id', method: 'POST', cases: [c1, c2], notes: '' });
  const results = [
    CaseResult.from(c1, 'POST http://localhost:3000/users/1', [{ status: 201, body: '{"token":"sk-live-abcdef123456"}', ms: 12, error: null }], ['sk-live-abcdef123456']),
    CaseResult.from(c2, 'POST http://localhost:3000/users/1', [{ status: 201, body: '{}', ms: 3400, error: null }], []),
  ];
  const report = TestReport.create(plan, results, new Date('2026-11-12T00:00:00Z'));

  it('응답 요약에서 비밀 값은 가린다', () => {
    expect(results[0]!.responses[0]!.excerpt).not.toContain('sk-live-abcdef123456');
  });
  it('통과·실패 수를 센다', () => {
    expect(report.counts()).toEqual({ pass: 1, fail: 1, error: 0, total: 2 });
    expect(report.failed().map((r) => r.caseId)).toEqual(['c1']);
  });
  it('느린 응답(2초 넘게)은 표시한다', () => {
    expect(results[1]!.slow()).toBe(true);
    expect(results[0]!.slow()).toBe(false);
  });
  it('수정 제안을 붙이면 실패 항목에만 붙는다', () => {
    const r = report.withFixes('요약', [
      { caseId: 'c1', cause: '검증 누락', fix: 'IsEmail 추가', file: 'src/users/dto.ts', line: 4 },
      { caseId: 'c2', cause: 'x', fix: 'y', file: null, line: null },
    ]);
    expect(r.fixFor('c1')?.fix).toBe('IsEmail 추가');
    expect(r.fixFor('c2')).toBeNull();
  });
  it('마크다운 리포트에 요약·표·실패 항목의 수정 방향이 들어간다', () => {
    const md = report.withFixes('검증이 빠졌어요', [{ caseId: 'c1', cause: '검증 누락', fix: 'IsEmail 추가', file: 'src/users/dto.ts', line: 4 }]).toMarkdown();
    expect(md).toContain('# API test: POST /users/:id');
    expect(md).toContain('| Input validation |');
    expect(md).toContain('src/users/dto.ts:4');
    expect(md).toContain('IsEmail 추가');
    expect(md).not.toContain('sk-live-abcdef123456');
  });
  it('리포트 맨 위에 결과 한 줄·시험 대상(환경·base_url)이 오고, 실패가 표보다 먼저, 통과는 접어 둔다', () => {
    const md = TestReport.create(plan, results, new Date('2026-11-12T00:00:00Z'), { env: 'local', baseUrl: 'http://localhost:3000' }).toMarkdown();
    const lines = md.split('\n');
    expect(lines[0]).toBe('# API test: POST /users/:id');
    expect(md).toContain('**1 failed** · 1 passed · 0 not run');
    expect(md).toContain('| Target | local · `http://localhost:3000` |');
    expect(md.indexOf('## Failed')).toBeLessThan(md.indexOf('## All cases'));
    expect(md).toContain('<details>');
    expect(md).toMatch(/```bash\ncurl -X POST 'http:\/\/localhost:3000\/users\/1'/);
  });

  it('서버가 꺼져 건너뛴 케이스는 실패와 따로 묶고 서버를 켜라고 적는다', () => {
    const skipped = CaseResult.skippedServerDown(c2, 'POST http://localhost:3000/users/1');
    const r = TestReport.create(plan, [CaseResult.from(c1, 'POST http://localhost:3000/users/1', [{ status: null, body: '', ms: 1, error: 'Connection refused: nothing is listening at that address and port.' }], []), skipped], new Date());
    expect(r.serverDown()).toBe(true);
    const md = r.toMarkdown();
    expect(md).toMatch(/server stopped answering/i);
    expect(md).not.toContain('## Failed');
  });

  it('고쳐 달라고 맡길 글에는 실패 항목과 근거 위치가 들어간다', () => {
    const text = report.withFixes('', [{ caseId: 'c1', cause: '검증 누락', fix: 'IsEmail 추가', file: 'src/users/dto.ts', line: 4 }]).fixRequest();
    expect(text).toContain('POST /users/:id');
    expect(text).toContain('이메일 형식이 틀리면 400');
    expect(text).toContain('src/users/dto.ts:4');
  });
});
