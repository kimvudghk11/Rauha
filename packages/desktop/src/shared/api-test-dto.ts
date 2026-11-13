import { ApiRequestDto } from './api-dto.js';
import type { ApiMethod, ApiRequestProps } from './api-request.js';
import { CASE_CATEGORIES, CATEGORY_LABEL, Expectation, TestCase, TestPlan, type CaseAuth, type CaseCategory, type FixNote, type Outcome, type TestReport, type TestTarget, ApiTestError } from './api-test.js';

/** AI API 시험의 경계: 모델 출력 읽기, 화면·IPC 모양, 모델에게 보낼 글 */

const LIMITS = { title: 160, note: 400, evidence: 200, body: 20_000, key: 64, value: 2000, entries: 20, notes: 2000, cause: 600, fix: 1200, summary: 1500, code: 90_000, file: 24_000 } as const;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');

function stringMap(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isObj(v)) return out;
  for (const [k, x] of Object.entries(v).slice(0, LIMITS.entries)) {
    if (FORBIDDEN_KEYS.has(k) || k.trim() === '' || k.length > LIMITS.key) continue;
    if (typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean') Object.defineProperty(out, k, { value: String(x).slice(0, LIMITS.value), enumerable: true, writable: true, configurable: true });
  }
  return out;
}

const statusList = (v: unknown): number[] => (Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : typeof v === 'number' ? [v] : []);

// ── 모델 출력 모양(json_schema) ──

const MAP = { type: 'object', additionalProperties: { type: 'string' } } as const;

export const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    cases: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: [...CASE_CATEGORIES] },
          title: { type: 'string' },
          expect_note: { type: 'string' },
          path_params: MAP,
          query: MAP,
          headers: MAP,
          body: { type: ['string', 'null'] },
          auth: { type: 'string', enum: ['default', 'none', 'invalid'] },
          repeat: { type: 'integer' },
          parallel: { type: 'integer' },
          expect_status: { type: 'array', items: { type: 'integer' } },
          body_excludes: { type: 'array', items: { type: 'string' } },
          evidence: { type: 'string' },
          mutates: { type: 'boolean' },
        },
        required: ['category', 'title', 'expect_note', 'body', 'auth', 'expect_status', 'evidence', 'mutates'],
      },
    },
    notes: { type: 'string' },
  },
  required: ['cases', 'notes'],
} as const;

export const FIX_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    fixes: {
      type: 'array',
      items: {
        type: 'object',
        properties: { case_id: { type: 'string' }, cause: { type: 'string' }, fix: { type: 'string' }, file: { type: 'string' }, line: { type: 'integer' } },
        required: ['case_id', 'cause', 'fix'],
      },
    },
  },
  required: ['summary', 'fixes'],
} as const;

export interface PlanMeta {
  readonly id: string;
  readonly requestId: string;
  readonly label: string;
  readonly method: ApiMethod;
}

export const TestPlanDto = {
  /** 모델이 돌려준 케이스 목록. 틀린 케이스는 버리고, 하나도 없으면 실패한다 */
  from(raw: unknown, meta: PlanMeta, newId: () => string): TestPlan {
    if (!isObj(raw) || !Array.isArray(raw['cases'])) throw new ApiTestError('BAD_PLAN', 'The test cases could not be read. Try again.');
    const cases: TestCase[] = [];
    for (const c of raw['cases'].slice(0, 60)) {
      if (!isObj(c)) continue;
      const category = c['category'];
      if (typeof category !== 'string' || !(CASE_CATEGORIES as readonly string[]).includes(category)) continue;
      try {
        cases.push(
          TestCase.create({
            id: newId(),
            category: category as CaseCategory,
            title: str(c['title'], LIMITS.title),
            expectNote: str(c['expect_note'], LIMITS.note),
            pathParams: stringMap(c['path_params']),
            query: stringMap(c['query']),
            headers: stringMap(c['headers']),
            body: typeof c['body'] === 'string' ? c['body'].slice(0, LIMITS.body) : null,
            auth: c['auth'] === 'none' || c['auth'] === 'invalid' ? (c['auth'] as CaseAuth) : 'default',
            repeat: typeof c['repeat'] === 'number' ? c['repeat'] : 1,
            parallel: typeof c['parallel'] === 'number' ? c['parallel'] : 1,
            expect: Expectation.of(statusList(c['expect_status']), Array.isArray(c['body_excludes']) ? c['body_excludes'].map((x) => str(x, 200)) : []),
            evidence: str(c['evidence'], LIMITS.evidence),
            mutates: c['mutates'] === true,
          }),
        );
      } catch {
        /* 기대 상태가 없거나 제목이 빈 케이스는 버린다 */
      }
    }
    return TestPlan.create({ ...meta, cases, notes: str(raw['notes'], LIMITS.notes) });
  },
};

export const FixNotesDto = {
  from(raw: unknown): { readonly summary: string; readonly fixes: FixNote[] } {
    if (!isObj(raw)) return { summary: '', fixes: [] };
    const fixes: FixNote[] = [];
    for (const f of Array.isArray(raw['fixes']) ? raw['fixes'].slice(0, 60) : []) {
      if (!isObj(f) || typeof f['case_id'] !== 'string' || typeof f['fix'] !== 'string') continue;
      const file = str(f['file'], 300).trim();
      const line = typeof f['line'] === 'number' && Number.isInteger(f['line']) && f['line'] > 0 ? f['line'] : null;
      fixes.push({ caseId: f['case_id'].slice(0, 64), cause: str(f['cause'], LIMITS.cause), fix: f['fix'].slice(0, LIMITS.fix), file: file === '' ? null : file, line });
    }
    return { summary: str(raw['summary'], LIMITS.summary), fixes };
  },
};

// ── IPC 입력 ──

export interface PlanTestsRequest {
  /** 컬렉션의 요청 id(프로젝트에서 만든 요청이어야 코드를 찾는다) */
  readonly requestId: string;
  /** 지금 편집 중인 요청(저장 전 바꾼 값까지) */
  readonly request: ApiRequestProps;
}

export const PlanTestsRequestDto = {
  from(raw: unknown): PlanTestsRequest {
    if (!isObj(raw) || typeof raw['requestId'] !== 'string' || raw['requestId'] === '' || raw['requestId'].length > 200) throw new ApiTestError('INVALID_INPUT', 'Pick a request from a project first.');
    return { requestId: raw['requestId'], request: ApiRequestDto.from(raw['request']).json };
  },
};

export interface RunTestsRequest {
  readonly planId: string;
  readonly caseIds: readonly string[];
  readonly confirmed: boolean;
}

export const RunTestsRequestDto = {
  from(raw: unknown): RunTestsRequest {
    if (!isObj(raw) || typeof raw['planId'] !== 'string' || !Array.isArray(raw['caseIds'])) throw new ApiTestError('INVALID_INPUT', 'Pick the cases to run.');
    const caseIds = raw['caseIds'].filter((x): x is string => typeof x === 'string' && x.length <= 64).slice(0, 60);
    return { planId: raw['planId'].slice(0, 200), caseIds, confirmed: raw['confirmed'] === true };
  },
};

// ── 화면 모양 ──

export interface CaseView {
  readonly id: string;
  readonly category: CaseCategory;
  readonly categoryLabel: string;
  readonly title: string;
  readonly expectNote: string;
  readonly statuses: readonly number[];
  readonly evidence: string;
  /** 데이터를 바꾸는 케이스(실행 전 확인) */
  readonly risky: boolean;
  readonly repeat: number;
  readonly parallel: number;
  /** 보낼 요청 미리보기(비밀은 {{변수}} 이름) */
  readonly request: { readonly method: ApiMethod; readonly url: string; readonly query: string; readonly body: string | null; readonly auth: CaseAuth };
}

export interface PlanView {
  readonly id: string;
  readonly label: string;
  readonly notes: string;
  readonly cases: readonly CaseView[];
  /** 시험 대상(환경 이름·base_url) */
  readonly target: TestTarget;
}

export const TestPlanView = {
  of(plan: TestPlan, base: ApiRequestProps, target: TestTarget = { env: null, baseUrl: null }): PlanView {
    return {
      id: plan.id,
      label: plan.props.label,
      notes: plan.props.notes,
      target,
      cases: plan.cases.map((c) => {
        const r = c.toRequest(base);
        const p = c.props;
        return {
          id: c.id,
          category: p.category,
          categoryLabel: CATEGORY_LABEL[p.category],
          title: p.title,
          expectNote: p.expectNote,
          statuses: p.expect.statuses,
          evidence: p.evidence,
          risky: plan.isRisky(c),
          repeat: c.repeat,
          parallel: c.parallel,
          request: { method: r.method, url: r.url, query: r.query.map((q) => `${q.key}=${q.value}`).join('&'), body: p.body, auth: p.auth },
        };
      }),
    };
  },
};

export interface ReportRow {
  readonly caseId: string;
  readonly category: CaseCategory;
  readonly categoryLabel: string;
  readonly title: string;
  readonly expected: readonly number[];
  readonly actual: readonly (number | null)[];
  readonly ms: number;
  readonly slow: boolean;
  readonly outcome: Outcome;
  readonly reason: string;
  readonly evidence: string;
  readonly sent: string;
  readonly excerpt: string;
  readonly fix: { readonly cause: string; readonly fix: string; readonly where: string } | null;
  /** 이 케이스만 고쳐 달라는 채팅 글(실패한 것만) */
  readonly fixRequest: string | null;
}

export interface ReportView {
  readonly planId: string;
  readonly label: string;
  readonly at: string;
  readonly summary: string;
  readonly counts: { readonly pass: number; readonly fail: number; readonly error: number; readonly total: number };
  readonly rows: readonly ReportRow[];
  readonly markdown: string;
  /** 실패 전부를 고쳐 달라는 채팅 글(실패가 없으면 null) */
  readonly fixRequest: string | null;
  readonly target: TestTarget;
  /** 서버가 꺼져 닿지 못한 케이스가 있다 */
  readonly serverDown: boolean;
}

export const TestReportView = {
  of(report: TestReport): ReportView {
    const rows: ReportRow[] = [];
    for (const r of report.results) {
      const c = report.caseOf(r.caseId);
      if (c === undefined) continue;
      const f = report.fixFor(r.caseId);
      rows.push({
        caseId: r.caseId,
        category: c.props.category,
        categoryLabel: CATEGORY_LABEL[c.props.category],
        title: c.props.title,
        expected: c.props.expect.statuses,
        actual: r.responses.map((x) => x.status),
        ms: r.maxMs(),
        slow: r.slow(),
        outcome: r.verdict.outcome,
        reason: r.verdict.reason,
        evidence: c.props.evidence,
        sent: r.sent,
        excerpt: r.responses[r.responses.length - 1]?.excerpt ?? '',
        fix: f === null ? null : { cause: f.cause, fix: f.fix, where: f.file === null ? '' : f.line === null ? f.file : `${f.file}:${f.line}` },
        fixRequest: r.verdict.outcome === 'fail' ? report.fixRequest(r.caseId) : null,
      });
    }
    return { planId: report.plan.id, label: report.plan.props.label, at: report.at.toISOString(), summary: report.summary, counts: report.counts(), rows, markdown: report.toMarkdown(), fixRequest: report.failed().length > 0 ? report.fixRequest() : null, target: report.target, serverDown: report.serverDown() };
  },
};

// ── 모델에게 보낼 글 ──

export interface CodeFile {
  readonly path: string;
  readonly text: string;
}

export interface EnvEntry {
  readonly name: string;
  readonly value: string;
  readonly secret: boolean;
}

/** 줄 번호를 붙인 코드 묶음(상한 안에서) */
function codeBlock(code: readonly CodeFile[]): string {
  const out: string[] = [];
  let used = 0;
  for (const f of code) {
    const numbered = f.text
      .slice(0, LIMITS.file)
      .split('\n')
      .map((l, i) => `${i + 1}| ${l}`)
      .join('\n');
    if (used + numbered.length > LIMITS.code) break;
    used += numbered.length;
    out.push(`<file path="${f.path}">\n${numbered}\n</file>`);
  }
  return out.join('\n\n');
}

function requestBlock(r: ApiRequestProps): string {
  const lines = [`${r.method} ${r.url}`];
  const q = r.query.filter((x) => x.enabled || x.value !== '');
  if (q.length > 0) lines.push(`query: ${q.map((x) => `${x.key}=${x.value}`).join('&')}`);
  for (const h of r.headers.filter((x) => x.enabled)) lines.push(`header ${h.key}: ${h.value}`);
  lines.push(`auth: ${r.auth.kind === 'bearer' ? `Bearer ${r.auth.token}` : r.auth.kind}`);
  if (r.body.kind === 'json' || r.body.kind === 'raw') lines.push(`body:\n${r.body.text.slice(0, 4000)}`);
  return lines.join('\n');
}

export const ApiTestPrompt = {
  /** 케이스를 만들어 달라는 글. 비밀 환경 값은 넣지 않는다(이름만) */
  forPlan(input: { readonly label: string; readonly request: ApiRequestProps; readonly env: readonly EnvEntry[]; readonly code: readonly CodeFile[] }): string {
    const vars = input.env.map((v) => (v.secret ? `- {{${v.name}}}: secret (${v.value === '' ? 'empty' : 'set'}; the value is filled in when sending)` : `- {{${v.name}}} = ${v.value.slice(0, 200)}`)).join('\n');
    return [`<endpoint>${input.label}</endpoint>`, `<request>\n${requestBlock(input.request)}\n</request>`, `<environment>\n${vars || '(none)'}\n</environment>`, `<code>\n${codeBlock(input.code)}\n</code>`].join('\n\n');
  },

  /** 실패한 케이스의 원인·수정 방향을 물어보는 글(응답 요약은 이미 가려져 있다) */
  forFixes(input: { readonly report: TestReport; readonly code: readonly CodeFile[] }): string {
    const failed = input.report.failed().map((r) => {
      const c = input.report.caseOf(r.caseId);
      const last = r.responses[r.responses.length - 1];
      return [`<case id="${r.caseId}">`, `title: ${c?.props.title ?? ''}`, `expected: ${c?.props.expect.statuses.join(' or ') ?? ''} (${c?.props.expectNote ?? ''})`, `evidence: ${c?.props.evidence ?? ''}`, `request: ${r.sent}`, `result: ${r.verdict.reason}`, `response: ${(last?.excerpt ?? '').slice(0, 800)}`, '</case>'].join('\n');
    });
    return [`<endpoint>${input.report.plan.props.label}</endpoint>`, `<failed>\n${failed.join('\n')}\n</failed>`, `<code>\n${codeBlock(input.code)}\n</code>`].join('\n\n');
  },
};

// ── IPC 결과 ──

export type PlanTestsResult = { readonly ok: true; readonly plan: PlanView } | { readonly ok: false; readonly error: string };
export type RunTestsResult = { readonly ok: true; readonly report: ReportView } | { readonly ok: false; readonly error: string };
export type SaveReportResult = { readonly ok: true; readonly saved: string | null } | { readonly ok: false; readonly error: string };
