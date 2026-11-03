import { DomainError } from '../../shared/domain-error.js';

export interface DesignScenario {
  readonly given: string;
  readonly when: string;
  readonly then: string;
}

/** by: 사용자가 정한 것인지 rauha가 추천값으로 정한 것인지(안내서와 설계 문서에 구분해 보인다) */
export interface DesignDecision {
  readonly what: string;
  readonly by: 'user' | 'rauha';
}

/** 설계가 나눈 작업 하나. 접수 팀장이 다시 크기를 매기지 않는다(설계가 S·M 크기로 나눈다). */
export interface DesignTask {
  readonly id: string;
  readonly title: string;
  /** 건드려도 되는 경로 패턴 */
  readonly scope: readonly string[];
  readonly acceptance: readonly string[];
  readonly dependsOn: readonly string[];
}

/** 구조의 한 부분: 무엇이 무엇을 맡고 어디에 사는지 */
export interface DesignComponent {
  readonly name: string;
  readonly responsibility: string;
  /** 파일이나 폴더(새로 만들 곳이면 만들 곳) */
  readonly location: string;
}

/** 검토하고 버린 안. 나중에 "왜 이렇게 안 했어?"에 답이 된다. */
export interface DesignAlternative {
  readonly option: string;
  readonly whyNot: string;
}

/** 어떤 층·부품으로 나누고 데이터가 어떻게 흐르는지. 작은 기능이면 구성 요소 하나, 흐름 한두 줄로 충분하다. */
export interface DesignArchitecture {
  readonly overview: string;
  readonly components: readonly DesignComponent[];
  readonly flow: readonly string[];
  readonly alternatives: readonly DesignAlternative[];
}

/** 구현 전에 잡아 두는 엣지 케이스. 맡은 작업(task)의 테스트로 먼저 잠근다. */
export interface DesignEdgeCase {
  readonly case: string;
  readonly handling: string;
  readonly task: string;
}

export interface DesignProps {
  readonly title: string;
  readonly purpose: string;
  readonly goals: readonly string[];
  readonly nonGoals: readonly string[];
  readonly scenarios: readonly DesignScenario[];
  readonly decisions: readonly DesignDecision[];
  readonly tasks: readonly DesignTask[];
  readonly risks: readonly string[];
  readonly architecture: DesignArchitecture;
  readonly edgeCases: readonly DesignEdgeCase[];
}

const MAX_TASKS = 8;

/** 사용자가 질문에 "알아서 해"처럼 답해 추천값에 맡기는 말 */
const DELEGATION = /^(알아서|그냥\s*해\s*줘|추천\s*(대로|값)|맡길게|(너|네|니)가\s*정해|rauha가\s*정해)/;

export function isDelegation(answer: string): boolean {
  return DELEGATION.test(answer.trim());
}

/**
 * 승인받을 설계. 만들 때 모든 규칙을 확인한다: 작업은 1~8개, id가 겹치지 않고, 의존은 있는 작업이며 순환하지 않고,
 * 작업마다 범위와 수용 기준이 있다. 승인된 뒤에는 이 순서대로 작업을 하나씩 최소 루프에 넣는다.
 */
export class Design {
  private constructor(private readonly props: DesignProps) {}

  static of(props: DesignProps): Design {
    const invalid = (message: string) => new DomainError('INVALID_DESIGN', message);
    if (props.title.trim() === '') throw invalid('설계 제목이 비었습니다.');
    if (props.purpose.trim() === '') throw invalid('설계의 목적이 비었습니다.');
    if (props.scenarios.length === 0) throw invalid('동작 시나리오가 하나도 없습니다.');
    if (props.tasks.length === 0) throw invalid('작업이 하나도 없습니다.');
    if (props.architecture.overview.trim() === '') throw invalid('구조 설명(architecture.overview)이 비었습니다.');
    if (props.architecture.components.length === 0) throw invalid('구성 요소(architecture.components)가 하나도 없습니다.');
    if (props.edgeCases.length === 0) throw invalid('엣지 케이스가 하나도 없습니다. 빈 값·경계 값·중복·동시 요청·바깥 실패 중 이 기능에 해당하는 것을 적으세요.');
    if (props.tasks.length > MAX_TASKS) throw invalid(`작업이 ${MAX_TASKS}개를 넘습니다. 설계를 더 작게 나누거나 단계로 묶으세요.`);

    const ids = new Set<string>();
    for (const task of props.tasks) {
      if (ids.has(task.id)) throw invalid(`작업 id가 겹칩니다: ${task.id}`);
      ids.add(task.id);
      if (task.scope.length === 0) throw invalid(`작업 ${task.id}에 범위가 없습니다.`);
      if (task.acceptance.length === 0) throw invalid(`작업 ${task.id}에 수용 기준이 없습니다.`);
    }
    for (const task of props.tasks) {
      for (const dep of task.dependsOn) {
        if (dep === task.id) throw invalid(`작업 ${task.id}가 자기 자신에 의존합니다.`);
        if (!ids.has(dep)) throw invalid(`작업 ${task.id}가 없는 작업(${dep})에 의존합니다.`);
      }
    }
    for (const edge of props.edgeCases) {
      if (!ids.has(edge.task)) throw invalid(`엣지 케이스(${edge.case})를 맡은 작업(${edge.task})이 없습니다.`);
    }
    const design = new Design(props);
    if (design.order().length !== props.tasks.length) throw invalid('작업의 의존이 순환합니다.');
    return design;
  }

  get title(): string {
    return this.props.title;
  }
  get purpose(): string {
    return this.props.purpose;
  }
  get goals(): readonly string[] {
    return this.props.goals;
  }
  get nonGoals(): readonly string[] {
    return this.props.nonGoals;
  }
  get scenarios(): readonly DesignScenario[] {
    return this.props.scenarios;
  }
  get decisions(): readonly DesignDecision[] {
    return this.props.decisions;
  }
  get tasks(): readonly DesignTask[] {
    return this.props.tasks;
  }
  get risks(): readonly string[] {
    return this.props.risks;
  }

  get architecture(): DesignArchitecture {
    return this.props.architecture;
  }
  get edgeCases(): readonly DesignEdgeCase[] {
    return this.props.edgeCases;
  }

  /** 이 작업이 맡은 엣지 케이스 */
  edgeCasesOf(taskId: string): DesignEdgeCase[] {
    return this.props.edgeCases.filter((e) => e.task === taskId);
  }

  decidedBy(who: DesignDecision['by']): DesignDecision[] {
    return this.props.decisions.filter((d) => d.by === who);
  }

  /** 실행 순서: 의존하는 작업이 먼저, 그 밖에는 적은 순서대로 */
  runOrder(): DesignTask[] {
    return this.order();
  }

  /** 이 작업이 (간접으로도) 의존하는 작업 중 하나라도 멈췄거나 막혔는지 */
  isBlocked(taskId: string, stopped: ReadonlySet<string>): boolean {
    const byId = new Map(this.props.tasks.map((t) => [t.id, t]));
    const seen = new Set<string>();
    const walk = (id: string): boolean =>
      (byId.get(id)?.dependsOn ?? []).some((dep) => {
        if (stopped.has(dep)) return true;
        if (seen.has(dep)) return false;
        seen.add(dep);
        return walk(dep);
      });
    return walk(taskId);
  }

  private order(): DesignTask[] {
    const done = new Set<string>();
    const result: DesignTask[] = [];
    let progressed = true;
    while (result.length < this.props.tasks.length && progressed) {
      progressed = false;
      for (const task of this.props.tasks) {
        if (done.has(task.id) || !task.dependsOn.every((dep) => done.has(dep))) continue;
        done.add(task.id);
        result.push(task);
        progressed = true;
        break;
      }
    }
    return result;
  }
}
