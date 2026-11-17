import { basename } from 'node:path';
import { AUTO_API_MAX_ENDPOINTS, autoApiLine, baseUrlOf, changedEndpoints, guessLaunch, type ServerLaunch } from '../../shared/api-auto.js';
import { ProjectApiSpec, ProjectStack, StackFactsDto } from '../../shared/api-project.js';
import { ApiRequest } from '../../shared/api-request.js';
import { pickContextFiles } from '../../shared/api-test-context.js';
import { ApiTestPrompt, FixNotesDto, TestPlanDto } from '../../shared/api-test-dto.js';
import { CaseResult, TestReport, type TestCase } from '../../shared/api-test.js';
import { runApiCase, type ApiTestDeps } from './api-test-service.js';
import type { ProjectReaderPort } from './project-reader.js';

/** 띄운 서버. 시험이 끝나면 반드시 끈다 */
export interface StartedServer {
  stop(): Promise<void>;
}

export interface AutoApiDeps {
  readonly reader: ProjectReaderPort;
  /** 프로젝트 루트 기준 파일 글(없으면 null) */
  readonly readText: (root: string, rel: string) => Promise<string | null>;
  /** 프로젝트 루트에 있는 파일 이름들 */
  readonly listRoot: (root: string) => Promise<readonly string[]>;
  /** 듣고 있으면 null, 아니면 이유 */
  readonly probe: (url: string) => Promise<string | null>;
  /** 이 컴퓨터 주소로만 보내는 보내기 */
  readonly send: ApiTestDeps['send'];
  readonly plan: (prompt: string) => Promise<unknown>;
  readonly fixes: (prompt: string) => Promise<unknown>;
  /** 허락받은 방법으로 서버를 띄우고 baseUrl 이 들을 때까지 기다린다. 못 띄우면 이유 글 */
  readonly launch: (root: string, how: ServerLaunch, baseUrl: string) => Promise<StartedServer | string>;
  /** 사용자에게 허락을 묻는다(허락 카드). 허락하면 true */
  readonly ask: (detail: string, reason: string) => Promise<boolean>;
  /** 팀 대화에 한 줄(테스트 팀원 말) */
  readonly say: (line: string) => void;
  readonly newId: () => string;
  readonly now: () => Date;
  readonly platform: NodeJS.Platform;
}

export interface AutoApiResult {
  /** 결과 글에 붙일 한 줄 */
  readonly line: string;
  /** 실패가 있으면 같은 팀에 맡길 "이걸 고쳐 줘" 글, 없으면 null */
  readonly fixRequest: string | null;
}

const skipped = (reason: string): AutoApiResult => ({ line: autoApiLine({ endpoints: 0, passed: 0, failed: 0, skipped: reason }), fixRequest: null });

/**
 * 팀이 코드를 고친 뒤 rauha 가 알아서 하는 API 점검:
 * 바뀐 파일의 엔드포인트 찾기 → (꺼져 있으면 허락받고) 서버 띄우기 → 엔드포인트마다 케이스 만들기(모델 1번) → 이 컴퓨터로만 보내기
 * → 실패가 있으면 원인·수정 방향(모델 1번) → 띄운 서버 끄기. API 파일을 안 건드렸으면 아무것도 하지 않는다(모델 호출 0).
 */
export async function autoApiCheck(deps: AutoApiDeps, root: string, changed: readonly { readonly path: string; readonly kind: string }[]): Promise<AutoApiResult | null> {
  const survey = await deps.reader.survey(root);
  const stack = ProjectStack.judge(StackFactsDto.from(survey));
  if (!stack.makesApi()) return null;
  const files = await deps.reader.read(root, stack.sourcePaths(survey.paths));
  const api = stack.extract(files);
  if (api === null) return null;
  const targets = changedEndpoints(api.groups.flatMap((g) => g.endpoints), changed);
  if (targets.length === 0) return null;

  const spec = ProjectApiSpec.fromExtracted(root, basename(root), api);
  const baseUrl = baseUrlOf(stack.kind, api.port, await deps.readText(root, '.env'));
  const vars = new Map(spec.variables.map((v) => [v.name, v.value] as const));
  vars.set('base_url', baseUrl);
  const secretNames = new Set(spec.variables.filter((v) => v.secret).map((v) => v.name));
  const env = spec.variables.map((v) => (v.name === 'base_url' ? { ...v, value: baseUrl } : v));
  const label = targets.map((e) => `${e.method} ${e.path}`).join(', ');

  let started: StartedServer | null = null;
  // 띄우기를 허락받을 때 "데이터가 바뀔 수 있다"도 함께 물었다. 이미 떠 있던 서버면 데이터를 바꾸는 케이스는 따로 묻는다
  let mayChangeData = false;
  try {
    if ((await deps.probe(baseUrl)) !== null) {
      const pkg = await deps.readText(root, 'package.json');
      let scripts: Record<string, string> = {};
      try {
        const parsed: unknown = pkg === null ? null : JSON.parse(pkg);
        const s = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>)['scripts'] : null;
        if (typeof s === 'object' && s !== null) scripts = Object.fromEntries(Object.entries(s).filter((e): e is [string, string] => typeof e[1] === 'string'));
      } catch {
        /* 깨진 package.json 이면 스크립트 없이 고른다 */
      }
      const how = guessLaunch({ stack: stack.kind, scripts, rootFiles: await deps.listRoot(root), platform: deps.platform });
      if (how === null) return skipped(`${baseUrl} 에 서버가 꺼져 있고, 띄울 명령(start:dev·dev·start 스크립트, gradlew, docker compose)을 찾지 못했어요`);
      const ok = await deps.ask(
        how.command,
        `팀이 만든 API(${label})를 이 컴퓨터에서 직접 불러 보려고 서버를 띄워요. 개발 DB 데이터가 바뀔 수 있어요(만들기·고치기·지우기 케이스). 시험이 끝나면 끕니다.`,
      );
      if (!ok) return skipped('서버를 띄우지 않기로 했어요');
      deps.say(`서버를 띄울게요(${how.command}). ${baseUrl} 이 응답할 때까지 기다려요`);
      const launched = await deps.launch(root, how, baseUrl);
      if (typeof launched === 'string') return skipped(`서버를 띄우지 못했어요: ${launched}`);
      started = launched;
      mayChangeData = true;
    }

    let endpoints = 0;
    let passed = 0;
    let failed = 0;
    const fixes: string[] = [];
    for (const e of targets.slice(0, AUTO_API_MAX_ENDPOINTS)) {
      const key = `${e.method} ${e.path}`;
      const generated = spec.groups.flatMap((g) => g.requests).find((r) => r.key === key);
      if (generated === undefined || e.file === undefined) continue;
      const base = ApiRequest.create({ id: deps.newId(), ...generated.request }).props;
      const code = pickContextFiles(e.file, files);
      deps.say(`${key} 를 시험할 케이스를 코드에서 뽑을게요`);
      const prompt = ApiTestPrompt.forPlan({ label: key, request: ApiRequest.create(base).withSecretsAsVariables().request.props, env, code });
      const plan = TestPlanDto.from(await deps.plan(prompt), { id: deps.newId(), requestId: base.id, label: key, method: base.method }, deps.newId);
      const risky = plan.cases.filter((c) => plan.isRisky(c));
      if (!mayChangeData && risky.length > 0) {
        mayChangeData = await deps.ask(`${key}: 데이터를 바꾸는 케이스 ${risky.length}개`, `이미 켜져 있는 서버(${baseUrl})의 데이터가 바뀔 수 있어요. 거절하면 읽기 케이스만 보내요.`);
      }
      const cases: TestCase[] = plan.cases.filter((c) => mayChangeData || !plan.isRisky(c));
      const results: CaseResult[] = [];
      for (const c of cases) {
        if (results.some((r) => r.serverDown())) results.push(CaseResult.skippedServerDown(c, `${base.method} ${base.url}`));
        else results.push(await runApiCase(deps.send, c, base, vars, secretNames));
      }
      let report = TestReport.create(plan, results, deps.now(), { env: null, baseUrl });
      if (report.failed().length > 0) {
        try {
          const notes = FixNotesDto.from(await deps.fixes(ApiTestPrompt.forFixes({ report, code })));
          report = report.withFixes(notes.summary, notes.fixes);
        } catch {
          /* 수정 제안 없이도 실패 목록은 넘긴다 */
        }
        fixes.push(report.fixRequest());
      }
      const n = report.counts();
      endpoints += 1;
      passed += n.pass;
      failed += n.fail;
      deps.say(`${key}: 케이스 ${n.total}개 중 통과 ${n.pass}, 실패 ${n.fail}${n.error > 0 ? `, 보내지 못함 ${n.error}` : ''}`);
    }
    if (endpoints === 0) return null;
    return { line: autoApiLine({ endpoints, passed, failed, skipped: null }), fixRequest: fixes.length === 0 ? null : fixes.join('\n\n') };
  } finally {
    if (started !== null) await started.stop().catch(() => undefined);
  }
}
