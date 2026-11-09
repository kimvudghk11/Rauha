import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { basename, join } from 'node:path';
import {
  type AlsoRepo,
  AgentSdkTeamMember,
  AnalysisService,
  ChatSession,
  type ChatSessionDeps,
  DesignService,
  FileAnalysisDocs,
  FileCompanyBook,
  FileDesignStore,
  FileKnowledgeStore,
  FileLearningStore,
  FileRunLog,
  FileWorkLock,
  GitRepoReader,
  GitWorkspace,
  KnowledgeService,
  MinimalLoopService,
  NodeChecks,
  RoleSettingsDto,
  type RoleOverrides,
  SessionBudget,
  SqliteMemory,
  listSecretFiles,
  loadProfileConfig,
  loadSecretPolicy,
  projectLockFile,
  projectMemoryFile,
  realAskTimer,
  type MemberCall,
  type MemberResult,
  type PlanUsage,
  type RuleBook,
  type Profile,
  type PromptLibrary,
  type TeamMemberPort,
} from '@rauha/core';
import { RepoConversations } from './repo-conversations.js';
import type { TeamIo, TeamSession } from './team-work.js';

/** 사용자 PC 시간대 기준 YYYY-MM-DD. */
function localDate(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 기억은 git 저장소 최상위마다 하나. 하위 폴더에서 일해도 같은 프로젝트 기억을 쓴다. */
function projectRoot(dir: string): string {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || dir;
  } catch {
    return dir;
  }
}

function gitRemote(cwd: string): string | null {
  try {
    return execFileSync('git', ['remote', 'get-url', 'origin'], { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return null;
  }
}

const definedEnv = (env: NodeJS.ProcessEnv): Record<string, string> => Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => e[1] !== undefined));

/** 폴더 → 계정(프로필). 설정 파일이 없으면 기본 프로필이다. 계정 구분은 CLAUDE_CONFIG_DIR로만 한다. */
export async function profileResolver(home: string, account: string | null = null): Promise<(cwd: string) => Profile> {
  const configPath = process.env['RAUHA_CONFIG'] ?? join(home, '.rauha', 'config.toml');
  const book = (await loadProfileConfig(configPath)).toEntity();
  return (cwd) => book.resolve({ cwd, home, gitRemote: gitRemote(cwd), flag: account, env: process.env['RAUHA_PROFILE'] ?? null }).profile;
}

/** 설정 화면에서 고를 수 있는 계정(프로필) 이름들 */
export async function accountNames(home: string): Promise<string[]> {
  const configPath = process.env['RAUHA_CONFIG'] ?? join(home, '.rauha', 'config.toml');
  return (await loadProfileConfig(configPath)).toEntity().names();
}

/** 팀원 호출에 작업의 멈춤 신호를 이어 붙인다. 미리 띄워 두는 호출(prepare)은 한도를 쓰므로 넘기지 않는다. */
function stoppable(team: TeamMemberPort, signal: AbortSignal): TeamMemberPort {
  return {
    run: (call: MemberCall): Promise<MemberResult> => team.run({ ...call, signal: call.signal ?? signal }),
  };
}

export interface ComposeOptions {
  readonly home: string;
  readonly prompts: PromptLibrary;
  readonly profileFor: (root: string) => Profile;
  /** 1분마다 읽는 구독 사용률. 아직 못 읽었으면 null */
  readonly plan: () => PlanUsage | null;
  /** Claude Code 실행 파일(설치본은 asar 밖). 없으면 SDK 기본 */
  readonly claudeExecutable?: string | undefined;
  /** 사용자 규칙 모음(규칙 탭). 부를 때마다 최신 값을 돌려준다. */
  readonly rules?: (() => RuleBook) | undefined;
  /** 팀 설정(팀원별 켜기·모델·도구·지시). 부를 때마다 최신 값을 돌려준다. 없으면 기본 역할 설정 그대로. */
  readonly roleOverrides?: (() => RoleOverrides) | undefined;
  /** 분석 단계(조사 → 방향 비교 → 설계·계획)를 쓸지. 부를 때마다 최신 설정을 돌려준다. 없으면 쓴다. */
  readonly analysis?: (() => boolean) | undefined;
}

/** 작업 공간(rauha가 여는 폴더)과 그 안의 레포들, 그리고 이번 요청이 가리킨 다른 레포들(읽기만) */
export interface SessionScope {
  readonly workspaceRoot: string;
  readonly repos: readonly { readonly name: string; readonly root: string }[];
  readonly also: readonly { readonly name: string; readonly root: string }[];
}

/**
 * 작업 공간 정보를 ChatSession에 넘길 모양으로. 레포가 둘 이상일 때만 folder가 의미 있다.
 * 함께 읽을 레포는 work 없이 넘겨 읽기 전용이다(여러 저장소를 한 번에 고치지 않는다).
 */
export function scopeDeps(scope: SessionScope): { folder: ChatSessionDeps['folder']; also: AlsoRepo[] } {
  return {
    folder: scope.repos.length > 1 ? { root: scope.workspaceRoot, repos: scope.repos.map((r) => ({ name: r.name, root: r.root })) } : undefined,
    also: scope.also.map((r) => ({ name: r.name, root: r.root, knowledge: null })),
  };
}

/**
 * 폴더 하나에서 일하는 팀 세션을 만든다(조립만 한다). 작업마다 새로 만들지만 앞 대화(turns·남긴 파일)는 레포별 파일로 이어진다.
 * 기억·지식·학습 노트도 폴더(저장소) 단위로 파일에 있어 작업끼리 이어진다.
 */
export function composeSession(options: ComposeOptions, root: string, io: TeamIo, keyRoot: string = root, scope: SessionScope = { workspaceRoot: root, repos: [], also: [] }): TeamSession {
  const { home, prompts } = options;
  // keyRoot: 기억·지식·학습·규칙이 매이는 원래 레포 폴더. root는 팀원이 실제로 일하는 폴더(worktree면 임시 폴더)다.
  const profile = options.profileFor(keyRoot);
  const secrets = loadSecretPolicy(root);
  // 팀 설정을 얹은 뒤 환경 변수 고정(실험용)이 마지막으로 이긴다. 설정이 비어 있으면 기본 역할 설정 그대로다.
  const roles = RoleSettingsDto.defaults().withOverrides(options.roleOverrides?.() ?? {}).withEnv({ ...process.env });
  const inner = new AgentSdkTeamMember({
    cwd: root,
    env: { ...definedEnv(process.env), ...profile.agentEnv(home) },
    prompts,
    ask: io.ask,
    secrets,
    secretFiles: () => listSecretFiles(root, secrets),
    ...(options.claudeExecutable !== undefined ? { claudeExecutable: options.claudeExecutable } : {}),
    ...(options.rules !== undefined ? { rules: (tool: string, detail: string) => options.rules!().verdictFor(tool, detail, keyRoot), alwaysRules: () => options.rules!().alwaysTexts(keyRoot).map((t) => `- ${t}`).join('\n') } : {}),
  });
  const team = stoppable(inner, io.signal);
  const knowledge = new KnowledgeService({
    reader: new GitRepoReader(root, secrets),
    store: new FileKnowledgeStore(profile.knowledgeDir(home), keyRoot),
    team,
    roles,
    progress: io.progress,
    repoName: basename(projectRoot(keyRoot)),
  });
  const budget = () => SessionBudget.fromWindows([options.plan()?.session ?? null, options.plan()?.weekly ?? null]);
  const runId = randomUUID();
  const memory = SqliteMemory.open(projectMemoryFile(profile.memoryDir(home), projectRoot(keyRoot)));
  const { folder, also } = scopeDeps(scope);
  const deps: ChatSessionDeps = {
    knowledge,
    repoName: basename(keyRoot),
    folder,
    designer: new DesignService({
      team,
      roles,
      user: { discuss: async () => null, approve: async () => ({ kind: 'cancel' }) },
      store: new FileDesignStore(profile.designsDir(home), keyRoot),
      progress: io.progress,
      today: () => localDate(),
    }),
    newLoop: (carried) =>
      new MinimalLoopService({
        team,
        workspace: new GitWorkspace(root, secrets),
        checks: new NodeChecks(root),
        log: new FileRunLog(profile.runsDir(home), runId, new Date(), prompts.hash),
        progress: io.progress,
        user: io.user,
        roles,
        newId: () => runId,
        now: () => Date.now(),
        today: () => localDate(),
        badge: profile.badge(),
        requireClean: true,
        threePass: true,
        lock: new FileWorkLock(projectLockFile(join(home, '.rauha', 'locks'), projectRoot(root))),
        carried,
        knowledge,
      }),
    team,
    workspace: new GitWorkspace(root, secrets),
    memory,
    user: io.user,
    progress: io.progress,
    roles,
    now: Date.now,
    newId: () => randomUUID(),
    today: () => localDate(),
    learning: new FileLearningStore(profile.learningDir(home), keyRoot),
    company: new FileCompanyBook(profile.companyDir(home), keyRoot),
    budget,
    // 분석 문서는 원래 레포(keyRoot)의 docs 아래에 쓴다. 방향·승인 카드는 사용자와 주고받을 화면(io.user.analysis)이 있을 때만 묻는다.
    analyst:
      options.analysis?.() === false
        ? undefined
        : new AnalysisService({ team, roles, docs: new FileAnalysisDocs(keyRoot), progress: io.progress, today: () => localDate(), newId: () => randomUUID(), timer: realAskTimer, user: io.user.analysis, budget }),
    nowText: () => `${new Date().toLocaleString('ko-KR', { dateStyle: 'full', timeStyle: 'short' })} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`,
  };
  // 앞 대화는 레포(keyRoot)마다 파일에 이어 둔다: 업무가 열 때 받아 오고, 끝나면 새로 생긴 대화만 합쳐 저장한다.
  const conversations = RepoConversations.under(profile.sessionsDir(home));
  return {
    handle: async (input, depth) => {
      const conversation = await conversations.open(keyRoot).catch(() => null);
      const session = conversation?.base != null ? ChatSession.resume(deps, conversation.base) : ChatSession.start(deps);
      try {
        return await session.handle(input, also, depth);
      } finally {
        memory.close();
        // 저장에 실패해도 업무 결과는 그대로 보인다.
        await conversation?.finish(session.snapshot(new Date().toISOString())).catch(() => undefined);
      }
    },
  };
}
