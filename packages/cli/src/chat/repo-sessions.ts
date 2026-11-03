import { join } from 'node:path';
import {
  ChatSession,
  DesignService,
  discoverRepos,
  FileChatSnapshots,
  FileCompanyBook,
  FileDesignStore,
  FileLearningStore,
  FileWorkspaceStore,
  GitWorkspace,
  isRepo,
  loadSecretPolicy,
  SessionBudget,
  Workspace,
  WorkspaceSession,
  type ChatSnapshot,
  type DesignUserPort,
  type PermissionAsker,
  type PlanUsage,
  type ProgressPort,
  type Profile,
  type RepoSession,
  type UserPort,
  type WorkspaceRepo,
} from '@rauha/core';
import { localDate } from '../local-date.js';
import { createKnowledge, createLoop, createTeam, openMemory, projectRoot, roleSettings } from '../run.js';

/** 저장소 하나에 딸린 것들. 저장소마다 그 저장소의 계정(프로필)으로 팀원·기억·지식을 따로 둔다. */
export interface Bundle {
  readonly profile: Profile;
  readonly chat: ChatSession;
  readonly team: ReturnType<typeof createTeam>;
  readonly memory: ReturnType<typeof openMemory>;
  readonly snapshots: FileChatSnapshots;
}

export interface RepoSessionsInput {
  readonly workDir: string;
  readonly home: string;
  /** 지난 대화를 이어서 연다(--continue) */
  readonly resume: boolean;
  /** false면 리뷰·사실 점검 없이(--quick) */
  readonly threePass: boolean;
  /** 저장소마다 계정(프로필) 고르기 */
  readonly profileFor: (root: string) => Profile;
  readonly prompts: Parameters<typeof createTeam>[1];
  readonly ask: PermissionAsker;
  readonly user: UserPort;
  readonly designUser: DesignUserPort;
  readonly progress: ProgressPort;
  /** 1분마다 읽는 구독 사용률. 아직 못 읽었으면 null */
  readonly plan: () => PlanUsage | null;
}

/**
 * 작업 공간(띄운 폴더가 저장소면 그것 하나, 저장소들을 담은 폴더면 그 아래 저장소들, 없으면 띄운 폴더 하나)과
 * 저장소별 대화 묶음을 만든다. 묶음은 그 저장소를 처음 쓸 때 열린다.
 */
export async function openRepoSessions(p: RepoSessionsInput) {
  const { workDir, home } = p;
  const wsStore = new FileWorkspaceStore(join(home, '.rauha', 'workspaces'), workDir);
  const savedWs = await wsStore.load();
  const found = discoverRepos(workDir);
  /** /repo add로 더한 저장소들(다음에 열어도 남는다) */
  const extra = (savedWs?.extra ?? []).filter((r) => isRepo(r));
  const roots = [...(found.length > 0 ? found : [workDir]), ...extra];
  const workspace = Workspace.of(roots, savedWs?.current ?? (roots.length === 1 ? roots[0]! : null));
  const multi = () => workspace.repos.length > 1;
  const saveWs = () => void wsStore.save({ extra, current: workspace.current()?.root ?? null }).catch(() => undefined);

  const bundles = new Map<string, Bundle>();
  // --continue: 저장소마다 저장해 둔 대화를 미리 읽는다(세션은 그 저장소를 처음 쓸 때 연다).
  const resumed = new Map<string, ChatSnapshot | null>();
  if (p.resume) {
    for (const repo of workspace.repos) resumed.set(repo.root, await new FileChatSnapshots(p.profileFor(repo.root).sessionsDir(home), projectRoot(repo.root)).load());
  }

  const open = (repo: WorkspaceRepo): RepoSession => {
    const repoProfile = p.profileFor(repo.root);
    // 저장소가 여럿이면 진행 줄과 묻는 화면에 저장소 이름을 붙인다(여러 저장소가 함께 일할 때 어느 쪽 일인지 보이게).
    const label = (text: string) => (multi() ? `[${repo.name}] ${text}` : text);
    const progress: ProgressPort = { step: (message, role) => p.progress.step(label(message), role) };
    const ask: PermissionAsker = (request) => p.ask({ ...request, reason: label(request.reason) });
    const user: UserPort = {
      ...p.user,
      interactive: p.user.interactive,
      choose: (assumption) => p.user.choose({ ...assumption, question: label(assumption.question) }),
      confirmFact: (claim) => p.user.confirmFact(claim),
      pickPast: (candidates) => p.user.pickPast(candidates),
    };
    const ctx = { root: repo.root, profile: repoProfile, home, ask, user, progress, requireClean: true, threePass: p.threePass };
    const team = createTeam(ctx, p.prompts);
    const knowledge = createKnowledge(ctx, team);
    const memory = openMemory(ctx);
    const deps = {
      knowledge,
      repoName: repo.name,
      // /repo add로 저장소가 늘 수 있어 부를 때마다 읽는다.
      get folder() {
        return multi() ? { root: workDir, repos: workspace.repos.map((r) => ({ name: r.name, root: r.root })) } : undefined;
      },
      designer: new DesignService({ team, roles: roleSettings(), user: p.designUser, store: new FileDesignStore(repoProfile.designsDir(home), repo.root), progress, today: localDate }),
      newLoop: (carried: ReadonlyMap<string, string>) => createLoop(ctx, p.prompts, team, carried, knowledge),
      team,
      workspace: new GitWorkspace(repo.root, loadSecretPolicy(repo.root)),
      memory,
      user,
      progress,
      roles: roleSettings(),
      now: Date.now,
      newId: () => crypto.randomUUID(),
      today: localDate,
      learning: new FileLearningStore(repoProfile.learningDir(home), repo.root),
      company: new FileCompanyBook(repoProfile.companyDir(home), repo.root),
      // 한도를 얼마나 썼는지(1분마다 읽는 값). 빠듯하면 부서장이 아끼고, 위험하면 큰 요청을 미룬다.
      budget: () => SessionBudget.fromWindows([p.plan()?.session ?? null, p.plan()?.weekly ?? null]),
      nowText: () => `${new Date().toLocaleString('ko-KR', { dateStyle: 'full', timeStyle: 'short' })} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`,
    };
    const saved = resumed.get(repo.root) ?? null;
    const chat = saved !== null ? ChatSession.resume(deps, saved) : ChatSession.start(deps);
    bundles.set(repo.root, { profile: repoProfile, chat, team, memory, snapshots: new FileChatSnapshots(repoProfile.sessionsDir(home), projectRoot(repo.root)) });
    return { repo, profileName: repoProfile.name, chat, knowledge };
  };

  const ws = new WorkspaceSession({ workspace, open, user: p.user, onCurrent: () => saveWs() });

  /** 지금 저장소의 묶음(처음이면 연다). 지금 저장소가 없으면 null. */
  const current = (): Bundle | null => {
    const repo = ws.current();
    if (repo === null) return null;
    ws.session(repo);
    return bundles.get(repo.root) ?? null;
  };
  /** 입력 하나를 마칠 때마다 남겨 두어 --continue로 이어 연다. 저장 실패는 대화를 막지 않는다. */
  const remember = (bundle: Bundle | null | undefined) => {
    if (bundle) void bundle.snapshots.save(bundle.chat.snapshot(new Date().toISOString())).catch(() => undefined);
  };
  const bundleNamed = (name: string | null) => bundles.get(workspace.repos.find((r) => r.name === name)?.root ?? '') ?? null;

  return { workspace, found, extra, multi, saveWs, bundles, resumed, ws, current, remember, bundleNamed };
}
