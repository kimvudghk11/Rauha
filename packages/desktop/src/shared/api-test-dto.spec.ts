import { describe, expect, it } from 'vitest';
import { ApiRequest } from './api-request.js';
import { CaseResult, TestReport } from './api-test.js';
import { ApiTestPrompt, FixNotesDto, RunTestsRequestDto, TestPlanDto, TestPlanView, TestReportView } from './api-test-dto.js';

const meta = { id: 'p1', requestId: 'r1', label: 'POST /users', method: 'POST' as const };
let n = 0;
const newId = (): string => `c${++n}`;

const good = { category: 'validation', title: '이메일이 틀리면 400', expect_note: 'IsEmail', path_params: {}, query: {}, headers: {}, body: '{"email":"x"}', auth: 'default', repeat: 1, parallel: 1, expect_status: [400], body_excludes: [], evidence: 'src/dto.ts:3', mutates: false };

describe('모델이 만든 케이스(TestPlanDto)', () => {
  it('맞는 케이스는 계획이 되고 id 는 rauha 가 붙인다', () => {
    const plan = TestPlanDto.from({ cases: [good], notes: '메모' }, meta, newId);
    expect(plan.cases).toHaveLength(1);
    expect(plan.cases[0]!.id).toMatch(/^c\d+$/);
    expect(plan.props.notes).toBe('메모');
  });
  it('모르는 분류·기대 상태가 없는 케이스·객체가 아닌 값은 버린다', () => {
    const plan = TestPlanDto.from({ cases: [good, { ...good, category: 'vibes' }, { ...good, expect_status: [] }, 'x', null] }, meta, newId);
    expect(plan.cases).toHaveLength(1);
  });
  it('쓸 수 있는 케이스가 하나도 없으면 실패한다', () => {
    expect(() => TestPlanDto.from({ cases: [] }, meta, newId)).toThrow();
    expect(() => TestPlanDto.from('nope', meta, newId)).toThrow();
  });
  it('글 길이와 키 개수를 줄인다(__proto__ 키는 버린다)', () => {
    const query: Record<string, string> = JSON.parse('{"__proto__":"x"}');
    for (let i = 0; i < 40; i++) query[`k${i}`] = 'v';
    const plan = TestPlanDto.from({ cases: [{ ...good, title: 'a'.repeat(500), query }] }, meta, newId);
    expect(plan.cases[0]!.props.title.length).toBeLessThanOrEqual(160);
    expect(Object.keys(plan.cases[0]!.props.query).length).toBeLessThanOrEqual(20);
    expect(Object.prototype.hasOwnProperty.call(plan.cases[0]!.props.query, '__proto__')).toBe(false);
  });
});

describe('화면용 모양', () => {
  it('미리보기에는 데이터를 바꾸는 케이스가 risky 로 표시된다', () => {
    const plan = TestPlanDto.from({ cases: [{ ...good, mutates: true }, good] }, meta, newId);
    const view = TestPlanView.of(plan, ApiRequest.create({ id: 'r1', method: 'POST', url: '{{base_url}}/users' }).props);
    expect(view.cases.map((c) => c.risky)).toEqual([true, false]);
    expect(view.cases[0]!.request.url).toBe('{{base_url}}/users');
    expect(view.cases[0]!.statuses).toEqual([400]);
  });
  it('리포트 모양에는 마크다운과 고쳐 달라는 글이 같이 온다', () => {
    const plan = TestPlanDto.from({ cases: [good] }, meta, newId);
    const report = TestReport.create(plan, [CaseResult.from(plan.cases[0]!, 'POST /users', [{ status: 201, body: '{}', ms: 4, error: null }], [])], new Date());
    const v = TestReportView.of(report);
    expect(v.counts.fail).toBe(1);
    expect(v.markdown).toContain('# API test report');
    expect(v.fixRequest).toContain('이메일이 틀리면 400');
    expect(v.rows[0]!.outcome).toBe('fail');
  });
});

describe('수정 제안(FixNotesDto)', () => {
  it('케이스 id·원인·수정 방향·파일·줄을 읽고 이상한 줄 번호는 버린다', () => {
    const r = FixNotesDto.from({ summary: '요약', fixes: [{ case_id: 'c1', cause: '원인', fix: '고치기', file: 'src/a.ts', line: 12 }, { case_id: 'c2', cause: 'x', fix: 'y', file: '', line: -3 }, { nope: 1 }] });
    expect(r.summary).toBe('요약');
    expect(r.fixes).toEqual([
      { caseId: 'c1', cause: '원인', fix: '고치기', file: 'src/a.ts', line: 12 },
      { caseId: 'c2', cause: 'x', fix: 'y', file: null, line: null },
    ]);
  });
});

describe('실행 요청(RunTestsRequestDto)', () => {
  it('계획 id·케이스 id 목록·확인 여부를 읽는다', () => {
    expect(RunTestsRequestDto.from({ planId: 'p1', caseIds: ['c1', 'c2'], confirmed: true })).toEqual({ planId: 'p1', caseIds: ['c1', 'c2'], confirmed: true });
    expect(() => RunTestsRequestDto.from({ planId: 'p1', caseIds: 'c1' })).toThrow();
  });
});

describe('모델에게 보낼 글(ApiTestPrompt)', () => {
  const request = ApiRequest.create({ id: 'r1', name: 'Create', method: 'POST', url: '{{base_url}}/users', auth: { kind: 'bearer', token: '{{token}}' }, body: { kind: 'json', text: '{"email":"user@example.com"}' } }).props;
  const env = [
    { name: 'base_url', value: 'http://localhost:3000', secret: false },
    { name: 'token', value: 'sk-live-supersecret-123', secret: true },
  ];
  const code = [{ path: 'src/users.controller.ts', text: 'line one\nline two' }];

  it('비밀 환경 값은 모델에게 보내지 않고 이름만 알린다', () => {
    const text = ApiTestPrompt.forPlan({ label: 'POST /users', request, env, code });
    expect(text).not.toContain('sk-live-supersecret-123');
    expect(text).toContain('{{token}}');
    expect(text).toContain('http://localhost:3000');
  });
  it('코드는 줄 번호를 붙여 보낸다(근거를 파일:줄로 적게)', () => {
    const text = ApiTestPrompt.forPlan({ label: 'POST /users', request, env, code });
    expect(text).toContain('src/users.controller.ts');
    expect(text).toMatch(/2\| line two/);
  });
  it('수정 제안을 부탁하는 글에는 실패한 케이스만 들어가고 비밀은 없다', () => {
    const plan = TestPlanDto.from({ cases: [good, { ...good, title: '정상', expect_status: [201] }] }, meta, newId);
    const results = [
      CaseResult.from(plan.cases[0]!, 'POST /users', [{ status: 201, body: '{"t":"sk-live-supersecret-123"}', ms: 4, error: null }], ['sk-live-supersecret-123']),
      CaseResult.from(plan.cases[1]!, 'POST /users', [{ status: 201, body: '{}', ms: 4, error: null }], []),
    ];
    const text = ApiTestPrompt.forFixes({ report: TestReport.create(plan, results, new Date()), code });
    expect(text).toContain('이메일이 틀리면 400');
    expect(text).not.toContain('정상');
    expect(text).not.toContain('sk-live-supersecret-123');
  });
});
