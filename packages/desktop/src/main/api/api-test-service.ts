import type { ApiCollections } from '../../shared/api-collections.js';
import type { ApiEnvironments } from '../../shared/api-env.js';
import { ProjectStack, StackFactsDto } from '../../shared/api-project.js';
import { ApiError, ApiRequest, type ApiRequestProps } from '../../shared/api-request.js';
import { hideSecrets, maskUrlSecrets } from '../../shared/api-redact.js';
import { pickContextFiles } from '../../shared/api-test-context.js';
import { ApiTestPrompt, FixNotesDto, PlanTestsRequestDto, RunTestsRequestDto, TestPlanDto, TestPlanView, TestReportView, type CodeFile, type PlanTestsResult, type RunTestsResult, type SaveReportResult } from '../../shared/api-test-dto.js';
import { ApiTestError, CaseResult, LocalTarget, TestReport, type ObservedResponse, type TestCase, type TestPlan } from '../../shared/api-test.js';
import type { SourceFile } from '../../shared/api-extract.js';
import type { SendOutcome } from './api-sender.js';
import type { ApiStorePort } from './api-store.js';
import type { ProjectReaderPort } from './project-reader.js';


export interface ApiTestDeps {
  readonly collections: ApiStorePort<ApiCollections>;
  readonly envs: ApiStorePort<ApiEnvironments>;
  readonly reader: ProjectReaderPort;
  /** 준비된 요청을 보낸다(이 컴퓨터 주소만 허락하는 보내기여야 한다) */
  readonly send: (prepared: ReturnType<ApiRequest['prepare']>, signal: AbortSignal) => Promise<SendOutcome>;
  /** 모델: 케이스 만들기(모델 출력 그대로) */
  readonly plan: (prompt: string) => Promise<unknown>;
  /** 모델: 실패 케이스의 원인·수정 방향 */
  readonly fixes: (prompt: string) => Promise<unknown>;
  readonly newId: () => string;
  readonly now: () => Date;
  readonly saveFile: (fileName: string, text: string) => Promise<string | null>;
}

interface Stored {
  readonly plan: TestPlan;
  readonly base: ApiRequestProps;
  readonly code: readonly CodeFile[];
  report: TestReport | null;
}

const KEEP_PLANS = 10;
const VAR_RE = /\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}/g;
const message = (e: unknown): string => (e instanceof ApiTestError || e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong.');

/**
 * AI API 시험: 계획(코드 고르기 → 모델 한 번 → 미리보기) → 실행(이 컴퓨터로만, 모델 없이) → 실패가 있으면 수정 제안(모델 한 번).
 * 비밀 환경 값은 모델에게 가지 않는다: 모델은 {{변수}} 이름만 보고, 값은 보낼 때 main 이 채운다.
 */
export class ApiTestService {
  private readonly plans = new Map<string, Stored>();
  private busy = false;

  constructor(private readonly deps: ApiTestDeps) {}

  private remember(id: string, s: Stored): void {
    this.plans.set(id, s);
    while (this.plans.size > KEEP_PLANS) this.plans.delete(this.plans.keys().next().value as string);
  }

  private async exclusive<T extends { ok: boolean }>(job: () => Promise<T>): Promise<T | { ok: false; error: string }> {
    if (this.busy) return { ok: false, error: 'An AI test is already running. Wait for it to finish.' };
    this.busy = true;
    try {
      return await job();
    } catch (e) {
      return { ok: false, error: message(e) };
    } finally {
      this.busy = false;
    }
  }

  async plan(raw: unknown): Promise<PlanTestsResult> {
    return this.exclusive(async () => {
      const req = PlanTestsRequestDto.from(raw);
      const node = (await this.deps.collections.load()).node(req.requestId);
      const origin = node?.origin;
      if (node === undefined || node.kind !== 'request' || origin === undefined || !origin.key.startsWith('req:')) {
        throw new ApiTestError('NO_CODE', 'AI tests read the code behind a request, so pick a request that was made from a project (choose the project on the left).');
      }
      const base = req.request;
      const envs = await this.deps.envs.load();
      const env = envs.find(envs.selectedId);
      const vars = env?.variableMap() ?? new Map<string, string>();
      const url = base.url.replace(VAR_RE, (m: string, name: string) => vars.get(name) ?? m);
      if (/\{\{\s*base_url\s*\}\}/.test(url)) throw new ApiTestError('NO_BASE_URL', 'Set {{base_url}} in the selected environment (for example http://localhost:3000).');
      LocalTarget.assert(url);

      const survey = await this.deps.reader.survey(origin.project);
      const stack = ProjectStack.judge(StackFactsDto.from(survey));
      const files: SourceFile[] = await this.deps.reader.read(origin.project, stack.sourcePaths(survey.paths));
      const endpointKey = origin.key.slice('req:'.length);
      const endpoint = stack
        .extract(files)
        ?.groups.flatMap((g) => g.endpoints)
        .find((e) => `${e.method} ${e.path}` === endpointKey);
      if (endpoint?.file === undefined) throw new ApiTestError('NO_CODE', 'This endpoint was not found in the code anymore. Read the project again (↻) and pick the request again.');
      const code = pickContextFiles(endpoint.file, files);

      const label = endpointKey;
      const safe = ApiRequest.create(base).withSecretsAsVariables().request.props;
      const prompt = ApiTestPrompt.forPlan({ label, request: safe, env: env?.props.vars ?? [], code });
      const plan = TestPlanDto.from(await this.deps.plan(prompt), { id: this.deps.newId(), requestId: req.requestId, label, method: base.method }, this.deps.newId);
      this.remember(plan.id, { plan, base, code, report: null });
      return { ok: true as const, plan: TestPlanView.of(plan, base) };
    });
  }

  async run(raw: unknown): Promise<RunTestsResult> {
    return this.exclusive(async () => {
      const req = RunTestsRequestDto.from(raw);
      const stored = this.plans.get(req.planId);
      if (stored === undefined) throw new ApiTestError('UNKNOWN_PLAN', 'These cases are no longer available. Make the cases again.');
      const cases = stored.plan.pick(req.caseIds, req.confirmed);
      const envs = await this.deps.envs.load();
      const env = envs.find(envs.selectedId);
      const vars = env?.variableMap() ?? new Map<string, string>();
      const secretNames = new Set((env?.props.vars ?? []).filter((v) => v.secret).map((v) => v.name));
      const results: CaseResult[] = [];
      for (const c of cases) results.push(await this.runCase(c, stored.base, vars, secretNames));

      let report = TestReport.create(stored.plan, results, this.deps.now());
      if (report.failed().length > 0) {
        try {
          const notes = FixNotesDto.from(await this.deps.fixes(ApiTestPrompt.forFixes({ report, code: stored.code })));
          report = report.withFixes(notes.summary, notes.fixes);
        } catch {
          report = report.withFixes('수정 제안을 받지 못했어요(로그인이나 한도를 확인해 주세요). 결과 표는 그대로 볼 수 있어요.', []);
        }
      }
      stored.report = report;
      return { ok: true as const, report: TestReportView.of(report) };
    });
  }

  /** 케이스 하나: 변수 채우기 → 이 컴퓨터 주소인지 → (반복이면 차례로, 동시면 한꺼번에) 보내기 → 판정 */
  private async runCase(c: TestCase, base: ApiRequestProps, vars: ReadonlyMap<string, string>, secretNames: ReadonlySet<string>): Promise<CaseResult> {
    const request = ApiRequest.create(c.toRequest(base));
    const label = `${base.method} ${base.url}`;
    let prepared;
    try {
      prepared = request.prepare(vars, secretNames);
    } catch (e) {
      return CaseResult.notRun(c, label, message(e));
    }
    const sent = `${prepared.method} ${maskUrlSecrets(prepared.url, prepared.secrets)}`;
    if (!LocalTarget.isLocal(prepared.url)) return CaseResult.notRun(c, hideSecrets(sent, prepared.secrets), 'Not sent: the address is not on this computer.');
    const once = async (): Promise<ObservedResponse> => {
      const out = await this.deps.send(prepared, new AbortController().signal);
      return out.ok ? { status: out.response.status, body: out.response.body, ms: out.response.ms, error: null } : { status: null, body: '', ms: out.ms, error: out.error };
    };
    const observed: ObservedResponse[] = [];
    if (c.parallel > 1) observed.push(...(await Promise.all(Array.from({ length: c.parallel }, once))));
    else for (let i = 0; i < c.repeat; i++) observed.push(await once());
    return CaseResult.from(c, sent, observed, prepared.secrets);
  }

  async save(planId: unknown): Promise<SaveReportResult> {
    try {
      const report = typeof planId === 'string' ? this.plans.get(planId)?.report : undefined;
      if (report === null || report === undefined) throw new ApiTestError('NO_REPORT', 'Run the tests first.');
      const name = `api-test-${report.plan.props.label.replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 60) || 'report'}.md`;
      return { ok: true, saved: await this.deps.saveFile(name, report.toMarkdown()) };
    } catch (e) {
      return { ok: false, error: message(e) };
    }
  }
}
