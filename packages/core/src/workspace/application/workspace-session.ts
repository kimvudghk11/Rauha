import type { KnowledgePort } from '../../knowledge/application/ports.js';
import type { AlsoRepo, TurnOutcome } from '../../orchestration/application/chat-session.js';
import type { UserPort } from '../../orchestration/application/ports.js';
import type { Workspace, WorkspaceRepo } from '../domain/workspace.js';

/** 저장소 하나의 대화 세션과 그 저장소의 계정·지식 */
export interface RepoSession {
  readonly repo: WorkspaceRepo;
  readonly profileName: string;
  readonly chat: { handle(input: string, also?: readonly AlsoRepo[], force?: 'design'): Promise<TurnOutcome>; workIn?(request: string, block: string): Promise<TurnOutcome> };
  readonly knowledge: KnowledgePort | null;
}

export interface WorkspaceSessionDeps {
  readonly workspace: Workspace;
  /** 저장소 세션 만들기(저장소마다 한 번만 부른다) */
  readonly open: (repo: WorkspaceRepo) => RepoSession;
  readonly user: UserPort;
  /** 지금 저장소가 바뀌면(작업 공간 기억 저장, 상태 줄) */
  readonly onCurrent?: (repo: WorkspaceRepo) => void;
}

const UNSURE = '어느 저장소 일인지 알려 주세요. /repo <이름>으로 고를 수 있어요.';

/**
 * 여러 저장소 작업 공간. 메시지마다 저장소를 정하고(Workspace) 그 저장소의 대화 세션으로 넘긴다.
 * 못 정하면 사용자에게 고르게 하고, 여러 저장소 질문은 첫 저장소 세션이 나머지를 함께 받아 답한다.
 */
export class WorkspaceSession {
  private readonly opened = new Map<string, RepoSession>();

  constructor(private readonly deps: WorkspaceSessionDeps) {}

  /** force: /design처럼 라우터를 건너뛰고 설계부터 하게 할 때 */
  async handle(input: string, force?: 'design'): Promise<TurnOutcome & { readonly repo: string | null }> {
    const before = this.deps.workspace.current()?.root ?? null;
    const pick = this.deps.workspace.pick(input);
    const repos = pick.kind === 'one' ? [pick.repo] : pick.kind === 'many' ? pick.repos : await this.ask(pick.candidates);
    if (repos.length === 0) return { kind: 'notice', message: UNSURE, repo: null };
    this.announce(before);

    const [first, ...rest] = repos.map((r) => this.session(r)) as [RepoSession, ...RepoSession[]];
    const foreign = rest.find((s) => s.profileName !== first.profileName);
    if (foreign !== undefined) {
      return {
        kind: 'notice',
        message: `${foreign.repo.name}은 다른 계정(${foreign.profileName})의 저장소라서 함께 다룰 수 없어요. 저장소마다 나눠서 물어봐 주세요.`,
        repo: first.repo.name,
      };
    }
    // 다른 저장소의 몫은 그 저장소의 세션(그 저장소의 팀·작업 잠금·기억)이 한다.
    const also = rest.map((s): AlsoRepo => ({ name: s.repo.name, root: s.repo.root, knowledge: s.knowledge, ...(s.chat.workIn !== undefined ? { work: (request: string, block: string) => s.chat.workIn!(request, block) } : {}) }));
    return { ...(await first.chat.handle(input, also, force)), repo: first.repo.name };
  }

  select(name: string): WorkspaceRepo | null {
    const before = this.deps.workspace.current()?.root ?? null;
    const repo = this.deps.workspace.select(name);
    if (repo !== null) this.announce(before);
    return repo;
  }

  add(root: string): WorkspaceRepo {
    return this.deps.workspace.add(root);
  }

  current(): WorkspaceRepo | null {
    return this.deps.workspace.current();
  }

  repos(): readonly WorkspaceRepo[] {
    return this.deps.workspace.repos;
  }

  /** 저장소 세션(처음이면 연다) */
  session(repo: WorkspaceRepo): RepoSession {
    const found = this.opened.get(repo.root);
    if (found !== undefined) return found;
    const created = this.deps.open(repo);
    this.opened.set(repo.root, created);
    return created;
  }

  sessions(): readonly RepoSession[] {
    return [...this.opened.values()];
  }

  /** 사용자에게 저장소를 고르게 한다. 화면이 없거나 고르지 않으면 빈 목록. */
  private async ask(candidates: readonly WorkspaceRepo[]): Promise<WorkspaceRepo[]> {
    const { user, workspace } = this.deps;
    if (!user.interactive || user.pickRepo === undefined) return [];
    const name = await user.pickRepo(candidates.map((c) => ({ name: c.name, root: c.root })));
    const repo = name === null ? null : workspace.select(name);
    return repo === null ? [] : [repo];
  }

  private announce(before: string | null): void {
    const now = this.deps.workspace.current();
    if (now !== null && now.root !== before) this.deps.onCurrent?.(now);
  }
}
