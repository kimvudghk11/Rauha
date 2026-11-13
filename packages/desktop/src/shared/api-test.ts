import { hideSecrets } from './api-redact.js';
import type { ApiBody, ApiMethod, ApiRequestProps, KeyValue } from './api-request.js';

/**
 * API 하나를 여러 케이스로 시험하는 규칙(모델·네트워크 없음).
 * 케이스(TestCase)가 보낼 요청을 만들고, 기대(Expectation)가 실제 응답을 판정하고,
 * 계획(TestPlan)이 실행 전 확인을 요구하고, 리포트(TestReport)가 결과를 마크다운·채팅 글로 바꾼다.
 */

export class ApiTestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiTestError';
  }
}

export const CASE_CATEGORIES = ['happy', 'validation', 'auth', 'data', 'list', 'security', 'concurrency'] as const;
export type CaseCategory = (typeof CASE_CATEGORIES)[number];
export const CATEGORY_LABEL: Readonly<Record<CaseCategory, string>> = {
  happy: 'Happy path',
  validation: 'Input validation',
  auth: 'Auth & permission',
  data: 'Data state',
  list: 'Lists',
  security: 'Security',
  concurrency: 'Concurrency',
};

/** default: 요청에 적힌 인증 그대로, none: 인증 없이, invalid: 틀린 토큰 */
export type CaseAuth = 'default' | 'none' | 'invalid';

export const TEST_LIMITS = { cases: 40, repeat: 3, parallel: 5, slowMs: 2000, excerpt: 1500 } as const;
const INVALID_TOKEN = 'invalid-token-for-test';
const DATA_METHODS: ReadonlySet<ApiMethod> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// ── 로컬 주소 ──

/** 값 객체 같은 판정: AI 시험 요청은 이 컴퓨터(localhost·127.x·::1)로만 보낸다 */
export const LocalTarget = {
  isLocal(url: string): boolean {
    let u: URL;
    try {
      u = new URL(url.trim());
    } catch {
      return false;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase().replace(/\.$/, '');
    if (h === 'localhost' || h.endsWith('.localhost')) return true;
    if (h === '[::1]' || h === '::1') return true;
    return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
  },
  assert(url: string): void {
    if (!LocalTarget.isLocal(url)) {
      let host = url;
      try {
        host = new URL(url).host;
      } catch {
        /* 주소가 아니면 그대로 보인다 */
      }
      throw new ApiTestError('NOT_LOCAL', `AI tests only run against a server on this computer (localhost, 127.0.0.1, ::1). ${host.slice(0, 80)} is not local. Start the server locally and point {{base_url}} at it.`);
    }
  },
  /** 서버가 응답하지 않을 때(사전 확인 실패) 보일 글: 어느 주소인지 + 켜는 방법 */
  downError(url: string, reason: string): ApiTestError {
    let origin = url;
    try {
      origin = new URL(url).origin;
    } catch {
      /* 그대로 */
    }
    return new ApiTestError('SERVER_DOWN', `Nothing is answering at ${origin} (${reason.replace(/\.$/, '')}). Start the server (for example yarn start:dev or ./gradlew bootRun) and press Make test cases again, or change {{base_url}} in the environment bar.`);
  },
};

/** 연결 자체가 안 된 오류(서버 꺼짐)인지: 이때는 남은 케이스를 보내지 않는다 */
export function isServerDown(error: string | null): boolean {
  return error !== null && /^(Connection refused|The connection was reset)/.test(error);
}

/** 시험 대상: 고른 환경 이름과 base_url 값(리포트·화면 머리에 보인다) */
export interface TestTarget {
  readonly env: string | null;
  readonly baseUrl: string | null;
}

const SERVER_DOWN_REASON = 'Skipped: the server stopped answering, so the remaining cases were not sent.';

// ── 기대와 판정 ──

export interface ObservedResponse {
  /** 응답을 못 받았으면 null */
  readonly status: number | null;
  readonly body: string;
  readonly ms: number;
  readonly error: string | null;
}

export type Outcome = 'pass' | 'fail' | 'error';
export interface Verdict {
  readonly outcome: Outcome;
  readonly reason: string;
}

/** 값 객체: 기대 상태 코드들과 응답에 나오면 안 되는 글 */
export class Expectation {
  private constructor(
    readonly statuses: readonly number[],
    readonly bodyExcludes: readonly string[],
  ) {}

  static of(statuses: readonly number[], bodyExcludes: readonly string[]): Expectation {
    const ok = [...new Set(statuses.filter((s) => Number.isInteger(s) && s >= 100 && s <= 599))];
    if (ok.length === 0) throw new ApiTestError('NO_EXPECTED_STATUS', 'A test case needs at least one expected status code.');
    return new Expectation(ok, bodyExcludes.filter((x) => x.trim() !== '').slice(0, 5));
  }

  /** mode: one = 첫 응답, last = 마지막 응답(같은 요청 반복), all = 모든 응답(동시 요청) */
  judge(responses: readonly ObservedResponse[], mode: 'one' | 'last' | 'all' = 'one'): Verdict {
    const broken = responses.find((r) => r.status === null);
    if (broken !== undefined || responses.length === 0) return { outcome: 'error', reason: broken?.error ?? 'No response.' };
    const looked = mode === 'all' ? responses : mode === 'last' ? responses.slice(-1) : responses.slice(0, 1);
    const want = this.statuses.join(' or ');
    for (const r of looked) {
      const s = r.status as number;
      if (!this.statuses.includes(s)) {
        const server = s >= 500 ? ' (server error)' : '';
        return { outcome: 'fail', reason: `Expected ${want}, got ${s}${server}.` };
      }
      const leak = this.bodyExcludes.find((x) => r.body.includes(x));
      if (leak !== undefined) return { outcome: 'fail', reason: `The response contains ${JSON.stringify(leak.slice(0, 60))}, which should not be there.` };
    }
    return { outcome: 'pass', reason: `Got ${looked.map((r) => r.status).join(', ')} as expected.` };
  }
}

// ── 케이스 ──

export interface TestCaseProps {
  readonly id: string;
  readonly category: CaseCategory;
  readonly title: string;
  /** 왜 그렇게 되어야 하는지(사람이 읽는 기대 설명) */
  readonly expectNote: string;
  readonly pathParams: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string>>;
  readonly headers: Readonly<Record<string, string>>;
  /** 보낼 본문 글(JSON 이 아니어도 된다). null 이면 본문 없음 */
  readonly body: string | null;
  readonly auth: CaseAuth;
  readonly repeat: number;
  readonly parallel: number;
  readonly expect: Expectation;
  /** 근거 코드 위치(`파일:줄`) */
  readonly evidence: string;
  /** 모델이 데이터를 바꾼다고 본 케이스 */
  readonly mutates: boolean;
}

const clampInt = (n: number, lo: number, hi: number): number => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : lo);

export class TestCase {
  private constructor(readonly props: TestCaseProps) {}

  static create(p: TestCaseProps): TestCase {
    if (p.title.trim() === '') throw new ApiTestError('INVALID_CASE', 'A test case needs a title.');
    return new TestCase({ ...p, title: p.title.trim(), repeat: clampInt(p.repeat, 1, TEST_LIMITS.repeat), parallel: clampInt(p.parallel, 1, TEST_LIMITS.parallel) });
  }

  get id(): string {
    return this.props.id;
  }
  get repeat(): number {
    return this.props.repeat;
  }
  get parallel(): number {
    return this.props.parallel;
  }

  /** 판정 방식: 동시 요청이면 모든 응답, 반복이면 마지막 응답 */
  judgeMode(): 'one' | 'last' | 'all' {
    return this.props.parallel > 1 ? 'all' : this.props.repeat > 1 ? 'last' : 'one';
  }

  /** 데이터를 바꾸는 케이스: 모델이 그렇다고 했거나, DELETE 이거나, 쓰기 메서드인데 성공(2xx)을 기대하는 것 */
  changesData(method: ApiMethod): boolean {
    if (this.props.mutates || method === 'DELETE') return true;
    return DATA_METHODS.has(method) && this.props.expect.statuses.some((s) => s >= 200 && s < 300);
  }

  /** 기준 요청(컬렉션의 요청)에 이 케이스의 값을 입힌다. 비밀은 여전히 {{변수}} 이름이고 보낼 때 main 이 채운다 */
  toRequest(base: ApiRequestProps): ApiRequestProps {
    const p = this.props;
    const url = base.url.replace(/\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}/g, (m: string, name: string) => (name !== 'base_url' && p.pathParams[name] !== undefined ? encodeURIComponent(p.pathParams[name]) : m));
    const query: KeyValue[] = Object.entries(p.query).map(([key, value]) => ({ key, value, enabled: true }));
    const overridden = new Set(Object.keys(p.headers).map((k) => k.toLowerCase()));
    const headers: KeyValue[] = [...base.headers.filter((h) => !overridden.has(h.key.toLowerCase())), ...Object.entries(p.headers).map(([key, value]) => ({ key, value, enabled: true }))];
    let body: ApiBody = { kind: 'none' };
    if (p.body !== null) {
      let json = true;
      try {
        JSON.parse(p.body);
      } catch {
        json = false;
      }
      body = { kind: json ? 'json' : 'raw', text: p.body };
    }
    const auth = p.auth === 'none' ? ({ kind: 'none' } as const) : p.auth === 'invalid' ? ({ kind: 'bearer', token: INVALID_TOKEN } as const) : base.auth;
    return { ...base, url, query, headers, body, auth };
  }
}

// ── 계획 ──

export interface TestPlanProps {
  readonly id: string;
  /** 시험할 컬렉션 요청 id */
  readonly requestId: string;
  /** 화면·리포트에 보일 이름(`POST /users/:id`) */
  readonly label: string;
  readonly method: ApiMethod;
  readonly cases: readonly TestCase[];
  /** 모델이 남긴 말(시험하지 못한 것 등) */
  readonly notes: string;
}

/** 엔티티: 모델이 만든 케이스 목록. 실행 전 미리보기와 확인 규칙을 가진다 */
export class TestPlan {
  private constructor(readonly props: TestPlanProps) {}

  static create(p: TestPlanProps): TestPlan {
    if (p.cases.length === 0) throw new ApiTestError('EMPTY_PLAN', 'No test cases were made for this API.');
    const ids = new Set(p.cases.map((c) => c.id));
    if (ids.size !== p.cases.length) throw new ApiTestError('DUPLICATE_CASE', 'Two test cases have the same id.');
    return new TestPlan({ ...p, cases: p.cases.slice(0, TEST_LIMITS.cases) });
  }

  get id(): string {
    return this.props.id;
  }
  get cases(): readonly TestCase[] {
    return this.props.cases;
  }

  /** 실행 전에 사용자 확인이 필요한 케이스(데이터를 바꾸는 것) */
  isRisky(c: TestCase): boolean {
    return c.changesData(this.props.method);
  }

  needsConfirm(ids: readonly string[]): boolean {
    return this.props.cases.some((c) => ids.includes(c.id) && this.isRisky(c));
  }

  /** 실행할 케이스를 고른다. 데이터를 바꾸는 케이스가 있으면 confirmed 여야 한다 */
  pick(ids: readonly string[], confirmed: boolean): TestCase[] {
    if (ids.length === 0) throw new ApiTestError('NOTHING_PICKED', 'Pick at least one test case to run.');
    const picked = ids.map((id) => this.props.cases.find((c) => c.id === id));
    if (picked.some((c) => c === undefined)) throw new ApiTestError('UNKNOWN_CASE', 'That test case is not in this plan. Make the cases again.');
    if (this.needsConfirm(ids) && !confirmed) throw new ApiTestError('NEEDS_CONFIRM', 'Some cases change data (POST, PUT, PATCH, DELETE). Confirm before running them.');
    return picked as TestCase[];
  }
}

// ── 결과 ──

export interface ResponseNote {
  readonly status: number | null;
  readonly ms: number;
  /** 가린 응답 앞부분 */
  readonly excerpt: string;
  readonly error: string | null;
}

/** 값 객체: 케이스 하나를 실행한 결과(비밀은 가린 상태) */
export class CaseResult {
  private constructor(
    readonly caseId: string,
    /** 보낸 요청 한 줄(가림) */
    readonly sent: string,
    readonly responses: readonly ResponseNote[],
    readonly verdict: Verdict,
  ) {}

  static from(c: TestCase, sent: string, observed: readonly ObservedResponse[], secrets: readonly string[]): CaseResult {
    const verdict = c.props.expect.judge(observed, c.judgeMode());
    const responses = observed.map((r) => ({ status: r.status, ms: r.ms, excerpt: hideSecrets(r.body.slice(0, TEST_LIMITS.excerpt), secrets), error: r.error === null ? null : hideSecrets(r.error, secrets) }));
    return new CaseResult(c.id, hideSecrets(sent, secrets), responses, { outcome: verdict.outcome, reason: hideSecrets(verdict.reason, secrets) });
  }

  /** 실행하지 못한 케이스(없는 변수 등) */
  static notRun(c: TestCase, sent: string, reason: string): CaseResult {
    return new CaseResult(c.id, sent, [], { outcome: 'error', reason });
  }

  /** 앞 케이스에서 서버가 꺼진 게 보여 보내지 않은 케이스 */
  static skippedServerDown(c: TestCase, sent: string): CaseResult {
    return new CaseResult(c.id, sent, [], { outcome: 'error', reason: SERVER_DOWN_REASON });
  }

  /** 서버에 닿지 못한 결과(연결 거절이거나 그래서 건너뜀) */
  serverDown(): boolean {
    return this.verdict.reason === SERVER_DOWN_REASON || (this.verdict.outcome === 'error' && this.responses.some((r) => isServerDown(r.error)));
  }

  slow(): boolean {
    return this.responses.some((r) => r.ms > TEST_LIMITS.slowMs);
  }

  /** 가장 늦은 응답 시간 */
  maxMs(): number {
    return this.responses.reduce((m, r) => Math.max(m, r.ms), 0);
  }
}

export interface FixNote {
  readonly caseId: string;
  readonly cause: string;
  readonly fix: string;
  readonly file: string | null;
  readonly line: number | null;
}

const cell = (t: string): string => t.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').slice(0, 200);
const where = (f: FixNote): string => (f.file === null ? '' : f.line === null ? f.file : `${f.file}:${f.line}`);

/** 엔티티: 계획 + 결과 + (실패가 있으면) 모델의 수정 제안 */
export class TestReport {
  private constructor(
    readonly plan: TestPlan,
    readonly results: readonly CaseResult[],
    readonly at: Date,
    readonly summary: string,
    readonly fixes: readonly FixNote[],
    readonly target: TestTarget,
  ) {}

  static create(plan: TestPlan, results: readonly CaseResult[], at: Date, target: TestTarget = { env: null, baseUrl: null }): TestReport {
    return new TestReport(plan, results, at, '', [], target);
  }

  /** 서버가 꺼져서 닿지 못한 케이스가 있는지 */
  serverDown(): boolean {
    return this.results.some((r) => r.serverDown());
  }

  counts(): { pass: number; fail: number; error: number; total: number } {
    const n = (o: Outcome): number => this.results.filter((r) => r.verdict.outcome === o).length;
    return { pass: n('pass'), fail: n('fail'), error: n('error'), total: this.results.length };
  }

  failed(): CaseResult[] {
    return this.results.filter((r) => r.verdict.outcome === 'fail');
  }

  caseOf(id: string): TestCase | undefined {
    return this.plan.cases.find((c) => c.id === id);
  }

  /** 수정 제안을 붙인다. 실패한 케이스의 것만 남긴다 */
  withFixes(summary: string, fixes: readonly FixNote[]): TestReport {
    const failed = new Set(this.failed().map((r) => r.caseId));
    return new TestReport(this.plan, this.results, this.at, summary.trim(), fixes.filter((f) => failed.has(f.caseId)), this.target);
  }

  fixFor(caseId: string): FixNote | null {
    return this.fixes.find((f) => f.caseId === caseId) ?? null;
  }

  /**
   * 마크다운 리포트. 읽는 순서대로: 결과 한 줄 → 대상·시간 → (서버 꺼짐 안내) → 실패(다시 실행할 curl·응답) → 실행 못 함 → 전체 표(접힘) → 노트
   */
  toMarkdown(): string {
    const c = this.counts();
    const down = this.serverDown();
    const notRun = this.results.filter((r) => r.verdict.outcome === 'error');
    const result = [c.fail > 0 ? `**${c.fail} failed**` : `${c.fail} failed`, c.pass > 0 && c.fail === 0 && c.error === 0 ? `**${c.pass} passed**` : `${c.pass} passed`, c.error > 0 ? `**${c.error} not run**` : `${c.error} not run`].join(' · ');
    const target = this.target.baseUrl === null ? '-' : `${this.target.env ?? 'no environment'} · \`${this.target.baseUrl}\``;
    const slowest = this.results.reduce((m, r) => Math.max(m, r.maxMs()), 0);
    const lines = [
      `# API test: ${this.plan.props.label}`,
      '',
      `> ${c.fail === 0 && c.error === 0 ? '✅' : c.fail > 0 ? '❌' : '⚠️'} ${result} — ${c.total} cases`,
      '',
      '| | |',
      '| --- | --- |',
      `| Target | ${target} |`,
      `| Run at | ${this.at.toISOString().replace('T', ' ').slice(0, 16)} UTC |`,
      `| Slowest response | ${slowest} ms |`,
    ];
    if (down) lines.push('', `> ⚠️ **The server stopped answering.** Start the server at ${this.target.baseUrl ?? '{{base_url}}'} and run the tests again — cases that could not be sent are listed under *Not run*.`);
    if (this.summary !== '') lines.push('', this.summary);

    const failed = this.failed();
    if (failed.length > 0) lines.push('', `## Failed (${failed.length})`);
    failed.forEach((r, i) => {
      const tc = this.caseOf(r.caseId);
      if (tc === undefined) return;
      const p = tc.props;
      const actual = r.responses.map((x) => (x.status === null ? 'no response' : String(x.status))).join(', ') || '-';
      lines.push('', `### ${i + 1}. ${p.title} · ${CATEGORY_LABEL[p.category]}`, '');
      lines.push(`- **Expected** ${p.expect.statuses.join(' or ')}${p.expectNote.trim() !== '' ? ` — ${p.expectNote.trim()}` : ''}`, `- **Actual** ${actual} — ${r.verdict.reason}`);
      if (p.evidence !== '') lines.push(`- **Evidence** \`${p.evidence}\``);
      const f = this.fixFor(r.caseId);
      if (f !== null) lines.push(`- **Cause** ${f.cause}`, `- **Fix**${where(f) === '' ? '' : ` (\`${where(f)}\`)`} ${f.fix}`);
      lines.push('', '```bash', TestReport.curl(r.sent, p.body), '```');
      const body = r.responses[r.responses.length - 1]?.excerpt ?? '';
      if (body !== '') lines.push('', '<details><summary>Response body</summary>', '', '```', body.slice(0, 1200), '```', '', '</details>');
    });

    if (notRun.length > 0) {
      lines.push('', `## Not run (${notRun.length})`, '');
      for (const r of notRun) lines.push(`- ${this.caseOf(r.caseId)?.props.title ?? r.caseId} — ${r.verdict.reason}`);
    }

    const mark: Readonly<Record<Outcome, string>> = { pass: '✅ pass', fail: '❌ fail', error: '⚠️ not run' };
    lines.push('', '## All cases', '', `<details><summary>${c.total} cases</summary>`, '', '| # | Category | Case | Expected | Actual | Time | Result |', '| --- | --- | --- | --- | --- | --- | --- |');
    this.results.forEach((r, i) => {
      const tc = this.caseOf(r.caseId);
      if (tc === undefined) return;
      const actual = r.responses.map((x) => (x.status === null ? 'no response' : String(x.status))).join(', ') || '-';
      lines.push(`| ${i + 1} | ${CATEGORY_LABEL[tc.props.category]} | ${cell(tc.props.title)} | ${tc.props.expect.statuses.join(' or ')} | ${actual} | ${r.maxMs()} ms${r.slow() ? ' 🐢' : ''} | ${mark[r.verdict.outcome]} |`);
    });
    lines.push('', '</details>');
    if (this.plan.props.notes.trim() !== '') lines.push('', '## Notes', '', this.plan.props.notes.trim());
    return `${lines.join('\n')}\n`;
  }

  /** 실패를 다시 재현할 curl 한 줄(비밀은 이미 가려진 sent 를 쓴다. 인증 헤더는 넣지 않는다) */
  static curl(sent: string, body: string | null): string {
    const q = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
    const sp = sent.indexOf(' ');
    const method = sp === -1 ? 'GET' : sent.slice(0, sp);
    const url = sp === -1 ? sent : sent.slice(sp + 1);
    const parts = [`curl -X ${method} ${q(url)}`];
    if (body !== null) parts.push(`-H 'Content-Type: application/json'`, `-d ${q(body.slice(0, 2000))}`);
    return parts.join(' \\\n  ');
  }

  /** 채팅으로 "이걸 고쳐 줘" 맡길 글. caseId 를 주면 그 케이스만 */
  fixRequest(caseId?: string): string {
    const picked = this.failed().filter((r) => caseId === undefined || r.caseId === caseId);
    const parts = [`API 테스트에서 실패한 케이스를 고쳐 줘: ${this.plan.props.label}`];
    for (const r of picked) {
      const tc = this.caseOf(r.caseId);
      if (tc === undefined) continue;
      const f = this.fixFor(r.caseId);
      parts.push(`- ${tc.props.title}: ${r.verdict.reason}${tc.props.evidence !== '' ? ` (근거: ${tc.props.evidence})` : ''}${f !== null ? `\n  원인: ${f.cause}\n  수정 방향${where(f) === '' ? '' : `(${where(f)})`}: ${f.fix}` : ''}`);
    }
    parts.push('고친 뒤 같은 케이스가 통과하는지 테스트로 확인해 줘.');
    return parts.join('\n');
  }
}
