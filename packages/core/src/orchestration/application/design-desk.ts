import type { DesignPort } from '../../design/application/design.service.js';
import { DesignDocDto } from '../../design/application/dto/design.dto.js';
import type { ModelTier } from '../domain/team.js';
import type { Known } from './desk-host.js';
import type { ProgressPort } from './ports.js';
import type { DesignTaskResult, TurnOutcome } from './turn-outcome.js';

/** 설계 데스크가 세션에서 빌리는 것: 저장소 지식, 기억, 작업 한 건 돌리기, 비용 합산, 기억·대화 남기기 */
export interface DesignHost {
  knowledge(): Promise<Known | null>;
  /** 요청과 관련된 지난 작업·결정을 팀원 입력용 블록으로. 없으면 null */
  memoryBlock(input: string): Promise<string | null>;
  /** 승인된 설계의 작업 하나를 최소 루프에 넣는다. block: 그 작업의 설계 블록 */
  work(request: string, block: string): Promise<TurnOutcome>;
  charge(cost: { readonly costUsd: number; readonly tier: ModelTier; readonly calls: number }): void;
  /** 설계의 이유를 기억에 남긴다 */
  remember(question: string, answer: string, basis: string | null): Promise<void>;
  /** 앞 대화에 한 줄 남긴다 */
  noteTurn(input: string, result: string): void;
}

export interface DesignDeps {
  readonly designer: DesignPort;
  readonly repoName?: string | undefined;
  readonly progress: ProgressPort;
  readonly now: () => number;
}

/**
 * 기능 요청: 설계 팀원과 충분히 이야기해 설계를 승인받고, 승인된 설계의 작업을 순서대로 최소 루프에 넣는다.
 * 앞 작업이 멈추면 그것에 의존하는 작업은 하지 않고, 의존하지 않는 작업은 계속한다.
 * 승인 뒤의 접수는 설계 블록을 기준으로 거의 묻지 않는다.
 */
export class DesignDesk {
  constructor(
    private readonly host: DesignHost,
    private readonly deps: DesignDeps,
  ) {}

  async run(input: string, conversation: string | null, started: number): Promise<TurnOutcome> {
    const known = await this.host.knowledge();
    const memory = await this.host.memoryBlock(input);
    const result = await this.deps.designer.run({
      request: input,
      repo: this.deps.repoName ?? '이 저장소',
      knowledge: known?.block ?? null,
      memory,
      conversation,
      basis: known?.basis ?? null,
    });
    this.host.charge(result.cost);
    if (result.kind === 'blocked') return { kind: 'blocked', ...result.block };
    if (result.kind === 'cancelled') {
      this.host.noteTurn(input, '설계를 그만둠');
      return { kind: 'notice', message: '설계를 그만뒀어요. 필요하면 다시 말씀해 주세요.' };
    }
    if (result.kind === 'failed') return { kind: 'notice', message: `설계를 끝내지 못했어요: ${result.message} 요청을 조금 더 구체적으로 다시 해 주세요.` };

    const { design, path } = result;
    // 설계의 이유를 기억에 남긴다. 나중에 질문에 설계의 이유로 답할 수 있다(작업 기억은 작업마다 따로 남는다).
    const decided = design.decisions.map((d) => `- ${d.what} (${d.by === 'user' ? '사용자가 정함' : 'rauha가 정함'})`);
    // 버린 안도 남긴다: "왜 결제 단계에서 계산 안 했어?"에 그때의 이유로 답한다.
    const rejected = design.architecture.alternatives.map((a) => `- 버린 안: ${a.option} — ${a.whyNot}`);
    await this.host.remember(`설계 ${design.title}: ${input}`, [design.purpose, `구조: ${design.architecture.overview}`, ...decided, ...rejected].join('\n'), known?.basis ?? null);
    const order = design.runOrder();
    const results: DesignTaskResult[] = [];
    const stopped = new Set<string>();
    for (const [i, task] of order.entries()) {
      if (design.isBlocked(task.id, stopped)) {
        stopped.add(task.id);
        results.push({ id: task.id, title: task.title, status: 'skipped', outcome: null });
        continue;
      }
      this.deps.progress.step(`설계 작업 ${i + 1}/${order.length}: ${task.title}`);
      const { request, block } = DesignDocDto.taskRequest(design, task, path);
      const turn = await this.host.work(request, block);
      const outcome = turn.kind === 'work' ? turn.outcome : null;
      const complete = outcome?.status === 'complete';
      if (!complete) stopped.add(task.id);
      results.push({ id: task.id, title: task.title, status: complete ? 'complete' : 'stopped', outcome });
    }
    this.host.noteTurn(input, `설계 "${design.title}" 작업 ${results.filter((r) => r.status === 'complete').length}/${results.length}개 완료`);
    return { kind: 'design', title: design.title, path, tasks: results, durationMs: this.deps.now() - started };
  }
}
