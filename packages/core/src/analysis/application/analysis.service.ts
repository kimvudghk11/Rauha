import type { MemberRole } from '../../orchestration/application/dto/role-settings.dto.js';
import { RoleSettingsDto, type RoleSetting } from '../../orchestration/application/dto/role-settings.dto.js';
import type { MemberResult, ProgressPort, TeamMemberPort } from '../../orchestration/application/ports.js';
import { conversationBlock } from '../../orchestration/application/prompt-blocks.js';
import { SessionBudget } from '../../orchestration/domain/session-budget.js';
import type { ModelTier } from '../../orchestration/domain/team.js';
import { ToolKits } from '../../orchestration/domain/tool-kit.js';
import { DomainError } from '../../shared/domain-error.js';
import { AnalysisReach } from '../domain/analysis-reach.js';
import { AnalysisRun } from '../domain/analysis-run.js';
import { AnalysisDocDto } from './dto/analysis-doc.dto.js';
import { BlueprintDto, DirectionsDto, InvestigationDto } from './dto/analysis-dtos.js';
import { BLUEPRINT_SCHEMA, DIRECTIONS_SCHEMA, INVESTIGATION_SCHEMA } from './dto/analysis-schemas.js';
import type { AnalysisCost, AnalysisDocsPort, AnalysisInput, AnalysisPort, AnalysisResult, AnalysisUserPort, AskTimer } from './ports.js';

export type { AnalysisInput, AnalysisPort, AnalysisResult } from './ports.js';

/** 사용자가 카드에 답하기를 기다리는 한도. 지나면 카드를 닫고 그 단계에서 멈춘다(추천을 자동 채택하지 않는다). */
export const ASK_WAIT_MS = 30 * 60_000;
/** 형식을 못 맞춘 보고를 다시 받는 횟수(처음 한 번 + 다시 한 번) */
const ATTEMPTS = 2;

export interface AnalysisServiceDeps {
  readonly team: Pick<TeamMemberPort, 'run'>;
  readonly roles: RoleSettingsDto;
  readonly docs: AnalysisDocsPort;
  readonly progress: ProgressPort;
  readonly today: () => string;
  readonly newId: () => string;
  readonly timer: AskTimer;
  /** 사용자와 주고받을 화면. 없으면 방향 비교까지만 하고 멈춘다. */
  readonly user?: AnalysisUserPort | undefined;
  /** 구독 한도. 없으면 넉넉하다고 본다. */
  readonly budget?: (() => SessionBudget) | undefined;
  readonly waitMs?: number | undefined;
}

/** 한 번의 분석 동안만 쓰는 값(다음 분석에 남지 않게 지역으로 둔다) */
interface Session {
  readonly run: AnalysisRun;
  readonly input: AnalysisInput;
  path: string | null;
  docProblem: string | null;
  readonly cost: Record<ModelTier, { calls: number; costUsd: number }>;
}

/**
 * 분석: 조사 → 방향 비교 → (사용자가 방향 고르기) → 설계와 단계별 계획 → (사용자가 승인) → 작업 루프로 넘길 계획.
 * 규칙(순서, 멈출 곳, 모델 등급)은 AnalysisRun에 있고, 이 서비스는 팀원 호출·카드·문서 저장을 차례로 부르기만 한다.
 * 단계마다 같은 문서에 이어 써서, 도중에 멈춰도 거기까지는 남는다.
 */
export class AnalysisService implements AnalysisPort {
  constructor(private readonly deps: AnalysisServiceDeps) {}

  async run(input: AnalysisInput): Promise<AnalysisResult> {
    const run = AnalysisRun.start({ id: this.deps.newId(), request: input.request, reach: AnalysisReach.of(input.reach, input.request).limitedBy(this.budget()), date: this.deps.today() });
    const s: Session = { run, input, path: null, docProblem: null, cost: { haiku: { calls: 0, costUsd: 0 }, sonnet: { calls: 0, costUsd: 0 }, opus: { calls: 0, costUsd: 0 } } };

    for (let step = run.next(); step !== 'done'; step = run.next()) {
      if (run.pauseIfTight(this.budget())) break;
      if (step === 'investigate') await this.investigate(s);
      else if (step === 'compare') await this.compare(s);
      else if (step === 'choose') await this.choose(s);
      else if (step === 'blueprint') await this.blueprint(s);
      else if (step === 'approve') await this.approve(s);
      else {
        // implement: 작업 루프에 넘긴다. 문서에는 넘겼다고 남긴다.
        run.markImplemented();
      }
      await this.persist(s);
    }
    await this.persist(s);

    const cost: AnalysisCost[] = (Object.keys(s.cost) as ModelTier[]).filter((t) => s.cost[t].calls > 0).map((tier) => ({ tier, ...s.cost[tier] }));
    const brief = run.wasImplemented ? AnalysisDocDto.workBrief(run, s.path) : null;
    return { run, path: s.path, docProblem: s.docProblem, cost, brief, summary: AnalysisDocDto.toSummary(run, s.path, s.docProblem) };
  }

  // ── 단계 ──────────────────────────────────────────────────

  private async investigate(s: Session): Promise<void> {
    const { run, input } = s;
    this.deps.progress.step('원인을 조사하는 중…', input.role);
    const parts = [...this.head(input), '<job>investigate</job>'];
    const read = await this.ask(s, input.role, this.deps.roles.get(input.role), parts, INVESTIGATION_SCHEMA, (out) => InvestigationDto.from(out).toEntity(), ToolKits.for(input.role, input.request));
    if (read !== null) run.recordInvestigation(read);
  }

  private async compare(s: Session): Promise<void> {
    const { run, input } = s;
    this.deps.progress.step('고치는 방향을 비교하는 중…', input.role);
    const parts = [...this.head(input), this.investigationBlock(run), '<job>compare</job>'];
    const read = await this.ask(s, input.role, this.deps.roles.get(input.role), parts, DIRECTIONS_SCHEMA, (out) => DirectionsDto.from(out).toEntity(), ToolKits.for(input.role, input.request));
    if (read !== null) run.offerDirections(read);
  }

  private async choose(s: Session): Promise<void> {
    const { run } = s;
    const user = this.deps.user;
    if (user === undefined) return run.stop('no-screen');
    await this.persist(s);
    const reply = await this.wait((signal) => user.chooseDirection(AnalysisDocDto.directionCard(run, s.path), signal));
    if (reply === 'timeout') return run.stop('timeout');
    if (reply.kind === 'stop') return run.stop('user');
    try {
      run.choose(reply);
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      run.stop('user', `선택을 읽지 못해 여기서 멈췄어요: ${error.message}`);
    }
  }

  private async blueprint(s: Session): Promise<void> {
    const { run, input } = s;
    const tier = run.designTier({ routedFeature: input.routedFeature, repos: input.repos, budget: this.budget() });
    this.deps.progress.step(tier === 'opus' ? '큰 변경이라 설계와 계획을 더 신중하게 쓰는 중…' : '설계와 단계별 계획을 쓰는 중…', 'designer');
    const last = run.revisionNote === null ? '' : `<revision>\n사용자가 설계와 계획을 보고 말한 고칠 점입니다. 반영해서 다시 쓰세요.\n${run.revisionNote}\n</revision>`;
    const parts = [
      ...this.head(input),
      this.investigationBlock(run),
      `<directions>\n${DirectionsDto.toMarkdown(run.directions!, run.choice)}\n</directions>`,
      `<chosen_direction>\n${run.choice!.chosen}\n</chosen_direction>`,
      last,
      '<job>blueprint</job>',
    ];
    const read = await this.ask(s, 'designer', this.deps.roles.forBlueprint(tier), parts, BLUEPRINT_SCHEMA, (out) => BlueprintDto.from(out).toEntity(), ToolKits.for('designer', input.request));
    if (read !== null) run.recordBlueprint(read);
  }

  private async approve(s: Session): Promise<void> {
    const { run } = s;
    const user = this.deps.user;
    if (user === undefined) return run.stop('no-screen');
    await this.persist(s);
    const reply = await this.wait((signal) => user.decide(AnalysisDocDto.approvalCard(run, s.path), signal));
    if (reply === 'timeout') return run.stop('timeout');
    if (reply.kind === 'stop') return run.stop('user');
    if (reply.kind === 'revise') return run.reviseBlueprint(reply.note);
    run.approve();
  }

  // ── 부르는 일 ─────────────────────────────────────────────

  /**
   * 팀원 한 번 호출. 보고 형식이 안 맞으면 이유를 달아 한 번 더 부르고, 그래도 안 되면 분석을 멈춘다.
   * 계정 문제로 막혔으면 바로 멈춘다(다시 불러도 같다). 읽은 값, 못 읽었으면 null.
   */
  private async ask<T>(s: Session, role: MemberRole, setting: RoleSetting, parts: readonly string[], schema: Record<string, unknown>, read: (output: unknown) => T, kits: ReturnType<typeof ToolKits.for>): Promise<T | null> {
    let feedback: string | null = null;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
      const result: MemberResult = await this.deps.team.run({
        role,
        setting,
        outputSchema: schema,
        canWrite: () => false,
        ...(s.input.readDirs !== undefined && s.input.readDirs.length > 0 ? { additionalDirectories: s.input.readDirs } : {}),
        ...(kits.length > 0 ? { kits } : {}),
        userMessage: [...parts, feedback === null ? '' : `<previous_attempt>\n지난 보고가 거부됐습니다: ${feedback}\n</previous_attempt>`].filter((p) => p !== '').join('\n\n'),
      });
      const spent = s.cost[setting.tier];
      spent.calls += 1;
      spent.costUsd += result.usage.costUsd;
      if (result.blocked) {
        if (result.blocked.reason === 'cancelled') s.run.stop('user', '작업을 멈춰서 여기서 멈췄어요.');
        else s.run.stop('blocked', result.blocked.message);
        return null;
      }
      try {
        return read(result.output);
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        feedback = error.message;
      }
    }
    s.run.stop('unreadable', `팀원의 보고를 읽지 못해 여기서 멈췄어요: ${feedback}`);
    return null;
  }

  /** 사용자의 답을 기다린다. 한도(기본 30분)가 지나면 카드를 닫고(signal) 'timeout'. */
  private async wait<T>(start: (signal: AbortSignal) => Promise<T>): Promise<T | 'timeout'> {
    const controller = new AbortController();
    const timer = this.deps.timer(this.deps.waitMs ?? ASK_WAIT_MS);
    try {
      return await Promise.race([start(controller.signal), timer.expired.then(() => 'timeout' as const)]);
    } finally {
      timer.cancel();
      controller.abort();
    }
  }

  /** 세 단계가 같은 앞부분을 같은 순서로 받아 프롬프트 캐시가 맞는다. 바뀌는 것(단계 표지)은 맨 뒤에 둔다. */
  private head(input: AnalysisInput): string[] {
    return [`<today>${this.deps.today()}</today>`, input.knowledge ?? '', input.workspace, input.memory ?? '', conversationBlock(input.conversation), `<request>\n${input.request}\n</request>`].filter((p) => p !== '');
  }

  private investigationBlock(run: AnalysisRun): string {
    return `<investigation>\n${InvestigationDto.toMarkdown(run.investigation!)}\n</investigation>`;
  }

  /** 지금까지의 산출물을 문서에 쓴다. 처음은 새 문서, 그 뒤는 이어 쓴다. 쓰지 못해도 분석은 계속한다(이유만 남긴다). */
  private async persist(s: Session): Promise<void> {
    if (s.run.investigation === null && s.run.stopped === null) return;
    const markdown = AnalysisDocDto.toMarkdown(s.run, { repo: s.input.repo, basis: s.input.basis });
    try {
      if (s.path === null) s.path = await this.deps.docs.create({ date: s.run.date, topic: s.run.request }, markdown);
      else await this.deps.docs.update(s.path, s.run.id, markdown);
      s.docProblem = null;
    } catch (error) {
      s.docProblem = error instanceof Error ? error.message : String(error);
    }
  }

  private budget(): SessionBudget {
    return this.deps.budget?.() ?? SessionBudget.ample();
  }
}
