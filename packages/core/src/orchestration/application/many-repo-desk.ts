import { DomainError } from '../../shared/domain-error.js';
import type { RepoPart, RepoPlan } from '../domain/repo-plan.js';
import { SessionBudget } from '../domain/session-budget.js';
import { ToolKits } from '../domain/tool-kit.js';
import { ContractCheckDto, RepoPlanDto, type FinishedRepo } from './dto/repo-plan.dto.js';
import { CONTRACT_CHECK_SCHEMA, REPO_PLAN_SCHEMA } from './dto/schemas.js';
import type { DeskHost } from './desk-host.js';
import type { RunOutcome } from './minimal-loop.service.js';
import type { ProgressPort } from './ports.js';
import { conversationBlock } from './prompt-blocks.js';
import type { RepoContractResult, RepoWorkResult, TurnOutcome } from './turn-outcome.js';

/** 동시에 고치는 저장소 수. 한도가 빠듯하면 하나씩. */
const PARALLEL = 3;

/** 함께 고칠 저장소 하나. work는 그 저장소의 대화 세션이 자기 팀·잠금·기억으로 작업 하나를 한다. */
export interface RepoRunner {
  readonly name: string;
  readonly root: string;
  work(request: string, block: string): Promise<TurnOutcome>;
}

export interface ManyRepoDeps {
  readonly progress: ProgressPort;
  readonly now: () => number;
  readonly budget?: () => SessionBudget;
}

/** 저장소 하나를 돌린 결과(일정 관리용) */
type Ran = { readonly repo: string; readonly outcome: RunOutcome | null; readonly note: string | null; readonly blocked: boolean };

const workOf = (turn: TurnOutcome): RunOutcome | null => (turn.kind === 'work' ? turn.outcome : null);
const noteOf = (turn: TurnOutcome): string | null => (turn.kind === 'notice' || turn.kind === 'blocked' ? turn.message : null);

/**
 * 여러 저장소를 한 번에 고치는 요청.
 * 1) 나누기 팀원이 저장소별 일, 저장소 사이의 약속, 경계의 엣지 케이스, 먼저 만들 순서를 정한다.
 * 2) 먼저 만들어야 하는 저장소부터 그 저장소의 세션으로 작업한다. 기다릴 것이 없는 저장소끼리는 동시에(최대 3개).
 *    앞 저장소가 멈추면 그것을 기다리던 저장소는 하지 않는다.
 * 3) 끝나면 약속이 양쪽 코드에서 맞는지 검사하고, 어긋난 저장소는 한 번만 더 고친다.
 */
export class ManyRepoDesk {
  constructor(
    private readonly host: DeskHost,
    private readonly deps: ManyRepoDeps,
  ) {}

  async run(input: string, conversation: string | null, runners: readonly RepoRunner[], known: readonly string[], started: number): Promise<TurnOutcome> {
    const planned = await this.plan(input, conversation, runners, known);
    if ('kind' in planned) return planned;
    const { plan, decisions } = planned;
    this.deps.progress.step(`저장소 ${plan.parts.length}곳을 이 순서로 고쳐요: ${plan.order().map((p) => p.repo + (p.dependsOn.length > 0 ? `(${p.dependsOn.join(', ')} 다음)` : '')).join(' → ')}`);

    const ran = await this.runAll(plan, runners);
    const contract = await this.checkContract(input, plan, runners, ran);
    const fixed = await this.fixMismatches(plan, runners, ran, contract.mismatches);

    const repos: RepoWorkResult[] = plan.order().map((part) => {
      const r = ran.get(part.repo);
      if (r === undefined) return { repo: part.repo, status: 'skipped', outcome: null, fixed: null, note: '기다리던 저장소가 멈춰서 하지 않았어요' };
      const fix = fixed.get(part.repo) ?? null;
      const status = (fix ?? r.outcome)?.status === 'complete' ? 'complete' : 'stopped';
      return { repo: part.repo, status, outcome: r.outcome, fixed: fix, note: r.note };
    });
    return { kind: 'repos', repos, contract: contract.results, decisions, durationMs: this.deps.now() - started };
  }

  /** 나누기. 계획 규칙을 어기면 이유를 알려 한 번 다시 쓰게 한다. */
  private async plan(input: string, conversation: string | null, runners: readonly RepoRunner[], known: readonly string[]): Promise<{ plan: RepoPlan; decisions: string[] } | TurnOutcome> {
    const names = runners.map((r) => r.name);
    let feedback: string | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await this.host.member(
        'splitter',
        [
          '<job>plan</job>',
          `<repos>\n${runners.map((r) => `- ${r.name}: ${r.root}`).join('\n')}\n</repos>`,
          ...known,
          conversationBlock(conversation),
          feedback !== null ? `<feedback>\n지난 계획이 규칙을 어겼습니다: ${feedback}\n고쳐서 다시 내세요.\n</feedback>` : '',
          `<request>\n${input}\n</request>`,
        ],
        REPO_PLAN_SCHEMA,
        { dirs: runners.slice(1).map((r) => r.root), kits: ToolKits.for('splitter', input) },
      );
      if (result.blocked) return { kind: 'blocked', ...result.blocked };
      try {
        return RepoPlanDto.from(result.output, names);
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        feedback = error.message;
      }
    }
    return { kind: 'notice', message: `저장소별로 나누지 못했어요: ${feedback ?? ''} 저장소마다 나눠서 요청해 주세요.` };
  }

  /** 먼저 만들 저장소부터, 기다릴 것이 없는 저장소끼리는 함께. 계정이 막히면 새로 시작하지 않는다. */
  private async runAll(plan: RepoPlan, runners: readonly RepoRunner[]): Promise<Map<string, Ran>> {
    const limit = (this.deps.budget?.() ?? SessionBudget.ample()).saving ? 1 : PARALLEL;
    const completed = new Set<string>();
    const stopped = new Set<string>();
    const started = new Set<string>();
    const ran = new Map<string, Ran>();
    const running = new Map<string, Promise<void>>();
    let halted = false;

    const launch = (part: RepoPart) => {
      started.add(part.repo);
      const finished: FinishedRepo[] = part.dependsOn.flatMap((dep) => {
        const outcome = ran.get(dep)?.outcome;
        return outcome ? [{ repo: dep, title: outcome.title, files: outcome.changedInRun.map((c) => c.path) }] : [];
      });
      const { request, block } = RepoPlanDto.task(plan, part, finished);
      const runner = runners.find((r) => r.name === part.repo)!;
      const job = runner.work(request, block).then((turn) => {
        const outcome = workOf(turn);
        ran.set(part.repo, { repo: part.repo, outcome, note: noteOf(turn), blocked: turn.kind === 'blocked' });
        (outcome?.status === 'complete' ? completed : stopped).add(part.repo);
        halted ||= turn.kind === 'blocked';
        running.delete(part.repo);
      });
      running.set(part.repo, job);
    };

    for (;;) {
      // 기다리던 저장소가 멈췄으면 그 저장소는 시작하지 않은 채로 둔다(결과에서 '하지 않음').
      for (const part of plan.parts) if (!started.has(part.repo) && plan.isBlocked(part.repo, stopped)) started.add(part.repo);
      if (!halted) for (const part of plan.startable(completed, started).slice(0, Math.max(0, limit - running.size))) launch(part);
      if (running.size === 0) break;
      await Promise.race(running.values());
    }
    return ran;
  }

  /** 약속이 있고 그 약속의 저장소가 모두 끝났을 때만 검사한다. 검사는 결과를 막지 않는다. */
  private async checkContract(input: string, plan: RepoPlan, runners: readonly RepoRunner[], ran: ReadonlyMap<string, Ran>): Promise<{ results: RepoContractResult[]; mismatches: ReturnType<ContractCheckDto['mismatches']> }> {
    const done = (repo: string) => ran.get(repo)?.outcome?.status === 'complete';
    const checkable = plan.contract.filter((c) => c.between.every(done));
    const unchecked = (what: string): RepoContractResult => ({ what, checked: false, ok: false, evidence: '', fixedIn: null });
    if (checkable.length === 0) return { results: plan.contract.map((c) => unchecked(c.what)), mismatches: [] };

    const changed = plan.parts.flatMap((p) => {
      const files = ran.get(p.repo)?.outcome?.changedInRun.map((c) => c.path) ?? [];
      return files.length > 0 ? [`- ${p.repo}: ${files.join(', ')}`] : [];
    });
    const result = await this.host.member(
      'splitter',
      [
        '<job>check</job>',
        `<repos>\n${runners.map((r) => `- ${r.name}: ${r.root}`).join('\n')}\n</repos>`,
        `<contract>\n${checkable.map((c) => `- ${c.what} (${c.between.join(' ↔ ')}): ${c.shape}`).join('\n')}\n</contract>`,
        `<changed>\n${changed.join('\n')}\n</changed>`,
        `<request>\n${input}\n</request>`,
      ],
      CONTRACT_CHECK_SCHEMA,
      { dirs: runners.slice(1).map((r) => r.root) },
    );
    const check = ContractCheckDto.from(result.blocked ? null : result.output, plan);
    const mismatches = check.mismatches();
    const results = plan.contract.map((c) => {
      const item = check.items.find((i) => i.what === c.what);
      if (item === undefined) return unchecked(c.what);
      return { what: c.what, checked: true, ok: item.ok, evidence: item.evidence, fixedIn: mismatches.find((m) => m.what === c.what)?.repo ?? null };
    });
    return { results, mismatches };
  }

  /** 어긋난 약속마다 그 저장소에서 한 번만 더 고친다(저장소마다 하나로 묶는다). */
  private async fixMismatches(plan: RepoPlan, runners: readonly RepoRunner[], ran: ReadonlyMap<string, Ran>, mismatches: ReturnType<ContractCheckDto['mismatches']>): Promise<Map<string, RunOutcome>> {
    const byRepo = new Map<string, string[]>();
    for (const m of mismatches) byRepo.set(m.repo, [...(byRepo.get(m.repo) ?? []), `- ${m.what}: ${m.fix} (근거: ${m.evidence})`]);
    const fixed = new Map<string, RunOutcome>();
    await Promise.all(
      [...byRepo].map(async ([repo, fixes]) => {
        const part = plan.parts.find((p) => p.repo === repo)!;
        const finished: FinishedRepo[] = plan.parts.flatMap((p) => {
          const outcome = p.repo !== repo ? ran.get(p.repo)?.outcome : undefined;
          return outcome ? [{ repo: p.repo, title: outcome.title, files: outcome.changedInRun.map((c) => c.path) }] : [];
        });
        const { block } = RepoPlanDto.task(plan, part, finished);
        this.deps.progress.step(`[${repo}] 저장소 사이 약속이 어긋나 한 번 더 고쳐요`);
        const turn = await runners.find((r) => r.name === repo)!.work(`저장소 사이의 약속에 맞게 고친다\n${fixes.join('\n')}`, block);
        const outcome = workOf(turn);
        if (outcome !== null) fixed.set(repo, outcome);
      }),
    );
    return fixed;
  }
}
