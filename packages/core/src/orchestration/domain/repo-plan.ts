import { DomainError } from '../../shared/domain-error.js';

/** 저장소 하나에 시킬 일. dependsOn: 이 저장소보다 먼저 끝나야 하는 저장소(예: 웹은 API를 기다린다) */
export interface RepoPart {
  readonly repo: string;
  readonly request: string;
  readonly dependsOn: readonly string[];
}

/** 저장소 사이에 맞아야 하는 약속(API 경로, 요청·응답 필드, 이벤트 이름, 공유 타입) */
export interface RepoContract {
  readonly what: string;
  readonly between: readonly string[];
  /** 정확한 모양: 경로, 필드 이름과 타입 */
  readonly shape: string;
}

/** 저장소 경계에서 생기는 엣지 케이스. 맡은 저장소의 테스트로 잠근다. */
export interface RepoEdgeCase {
  readonly case: string;
  readonly handling: string;
  readonly repo: string;
}

export interface RepoPlanProps {
  readonly parts: readonly RepoPart[];
  readonly contract: readonly RepoContract[];
  readonly edgeCases: readonly RepoEdgeCase[];
}

/**
 * 여러 저장소를 고치는 요청의 계획. 만들 때 규칙을 모두 확인한다: 작업 공간의 저장소만, 저장소마다 한 번,
 * 기다리는 저장소는 계획 안에 있고 순서가 돌지 않으며, 약속은 계획 안의 저장소 둘 이상 사이에 있다.
 * 먼저 만들어야 하는 저장소부터 시작하고, 기다릴 것이 없는 저장소끼리는 함께 시작한다.
 */
export class RepoPlan {
  private constructor(private readonly props: RepoPlanProps) {}

  static of(props: RepoPlanProps, workspaceRepos: readonly string[]): RepoPlan {
    const invalid = (message: string) => new DomainError('INVALID_REPO_PLAN', message);
    if (props.parts.length === 0) throw invalid('고칠 저장소가 하나도 없습니다.');
    const names = new Set<string>();
    for (const part of props.parts) {
      if (!workspaceRepos.includes(part.repo)) throw invalid(`작업 공간에 없는 저장소입니다: ${part.repo} (있는 것: ${workspaceRepos.join(', ')})`);
      if (names.has(part.repo)) throw invalid(`저장소가 두 번 나옵니다: ${part.repo}. 한 저장소의 일은 한 덩어리로 쓰세요.`);
      names.add(part.repo);
    }
    for (const part of props.parts) {
      for (const dep of part.dependsOn) {
        if (dep === part.repo) throw invalid(`${part.repo}가 자기 자신을 기다립니다.`);
        if (!names.has(dep)) throw invalid(`${part.repo}가 계획에 없는 저장소(${dep})를 기다립니다.`);
      }
    }
    for (const item of props.contract) {
      if (new Set(item.between).size < 2) throw invalid(`약속(${item.what})은 저장소 둘 이상 사이에 있어야 합니다.`);
      const outside = item.between.find((repo) => !names.has(repo));
      if (outside !== undefined) throw invalid(`약속(${item.what})에 계획에 없는 저장소(${outside})가 있습니다.`);
    }
    for (const edge of props.edgeCases) {
      if (!names.has(edge.repo)) throw invalid(`엣지 케이스(${edge.case})를 맡은 저장소(${edge.repo})가 계획에 없습니다.`);
    }
    const plan = new RepoPlan(props);
    if (plan.order().length !== props.parts.length) throw invalid('저장소들이 서로를 기다려 순서가 돕니다.');
    return plan;
  }

  get parts(): readonly RepoPart[] {
    return this.props.parts;
  }
  get contract(): readonly RepoContract[] {
    return this.props.contract;
  }
  get edgeCases(): readonly RepoEdgeCase[] {
    return this.props.edgeCases;
  }

  /** 지금 시작해도 되는 저장소: 아직 시작하지 않았고, 기다리는 저장소가 모두 끝까지 해냈다. */
  startable(completed: ReadonlySet<string>, started: ReadonlySet<string>): RepoPart[] {
    return this.props.parts.filter((p) => !started.has(p.repo) && p.dependsOn.every((dep) => completed.has(dep)));
  }

  /** 이 저장소가 (간접으로도) 기다리는 저장소 중 하나라도 멈췄는지 */
  isBlocked(repo: string, stopped: ReadonlySet<string>): boolean {
    const byRepo = new Map(this.props.parts.map((p) => [p.repo, p]));
    const seen = new Set<string>();
    const walk = (name: string): boolean =>
      (byRepo.get(name)?.dependsOn ?? []).some((dep) => {
        if (stopped.has(dep)) return true;
        if (seen.has(dep)) return false;
        seen.add(dep);
        return walk(dep);
      });
    return walk(repo);
  }

  contractFor(repo: string): RepoContract[] {
    return this.props.contract.filter((c) => c.between.includes(repo));
  }

  edgeCasesOf(repo: string): RepoEdgeCase[] {
    return this.props.edgeCases.filter((e) => e.repo === repo);
  }

  /** 먼저 만들 저장소가 앞인 순서. 순서가 돌면 그 앞까지만 나온다. */
  order(): RepoPart[] {
    const done = new Set<string>();
    const result: RepoPart[] = [];
    let progressed = true;
    while (result.length < this.props.parts.length && progressed) {
      progressed = false;
      for (const part of this.props.parts) {
        if (done.has(part.repo) || !part.dependsOn.every((dep) => done.has(dep))) continue;
        done.add(part.repo);
        result.push(part);
        progressed = true;
        break;
      }
    }
    return result;
  }
}
