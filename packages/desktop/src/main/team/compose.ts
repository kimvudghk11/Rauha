import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { basename, join } from 'node:path';
import {
  type AlsoRepo,
  AgentSdkTeamMember,
  ModelRoutingTeam,
  ModelSettingsDto,
  type ModelTier,
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
  projectChecks,
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
  type ConnectorServers,
  type PluginLoad,
  type LinkedDatabase,
  type MemberCall,
  type MemberResult,
  type PlanUsage,
  type RuleBook,
  type Profile,
  type PromptLibrary,
  type TeamMemberPort,
  type TodoCard,
  type DigestRepo,
  type WorkspaceFacts,
  recallBlock,
} from '@rauha/core';
import { RepoConversations } from './repo-conversations.js';
import { standupLog } from '../git/standup-log.js';
import { repoDigest } from '../git/repo-digest.js';
import { fileHistory, repoStatus, searchRepos, showCommit } from '../git/workspace-git.js';
import { dependencyManifests } from '../git/manifests.js';
import { readSpreadsheet } from '../files/spreadsheet.js';
import { ciLog, ciRuns } from '../github/ci-facts.js';
import type { ActionsClient } from '../github/actions-client.js';
import { workspaceFileReader } from './workspace-file.js';
import { MapRefresher, workspaceKnowledge } from './workspace-knowledge.js';
import type { TeamIo, TeamSession } from './team-work.js';

/** 작업 공간 변경 묶음을 다시 읽지 않고 쓰는 시간 */
const DIGEST_FRESH_MS = 30_000;
/** past_work 도구가 꺼내는 기억 수·글 길이 */
const PAST_WORK_RECALLS = 5;
const PAST_WORK_CHARS = 6_000;

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

/**
 * 계정을 그때그때 고르는 해석기: 설정 파일은 한 번 읽고, 계정(account)은 부를 때마다 받는다.
 * 앱을 켤 때 계정을 고정해 두면 설정에서 바꿔도 팀 작업이 예전 계정으로 가서(한도 찬 계정) 막힌다.
 */
export async function liveProfileResolver(home: string): Promise<(cwd: string, account: string | null) => Profile> {
  const configPath = process.env['RAUHA_CONFIG'] ?? join(home, '.rauha', 'config.toml');
  const book = (await loadProfileConfig(configPath)).toEntity();
  return (cwd, account) => book.resolve({ cwd, home, gitRemote: gitRemote(cwd), flag: account, env: process.env['RAUHA_PROFILE'] ?? null }).profile;
}

/** 설정 화면에서 고를 수 있는 계정(프로필) 이름들 */
export async function accountNames(home: string): Promise<string[]> {
  const configPath = process.env['RAUHA_CONFIG'] ?? join(home, '.rauha', 'config.toml');
  return (await loadProfileConfig(configPath)).toEntity().names();
}

/** 팀원 호출에 작업의 멈춤 신호를 이어 붙인다. 미리 띄워 두는 호출(prepare)은 한도를 쓰므로 넘기지 않는다. */
/** 지도만 맞추는 일은 팀원을 부르지 않는다(부르면 잘못이라 바로 실패시킨다) */
const NO_TEAM: TeamMemberPort = { run: async () => Promise.reject(new Error('지도 맞추기는 팀원을 부르지 않습니다')) };
let refresher: MapRefresher | null = null;

/** 앱 하나에 하나: 일마다 compose 가 불려도 같은 저장소를 10분 안에 다시 훑지 않게 */
function mapRefresher(dir: string, roles: RoleSettingsDto): MapRefresher {
  // 비밀 파일 규칙은 그 저장소 것을 쓴다
  refresher ??= new MapRefresher((root) =>
    new KnowledgeService({ reader: new GitRepoReader(root, loadSecretPolicy(root)), store: new FileKnowledgeStore(dir, root), team: NO_TEAM, roles, progress: { step: () => undefined }, repoName: basename(root) }).refreshMap(),
  );
  return refresher;
}

function stoppable(team: TeamMemberPort, signal: AbortSignal): TeamMemberPort {
  return {
    run: (call: MemberCall): Promise<MemberResult> => team.run({ ...call, signal: call.signal ?? signal }),
  };
}

export interface ComposeOptions {
  readonly home: string;
  /** 메인 채팅 기본을 "원문 그대로 Claude"로(라우터·답변 틀·키워드 가로채기 없이). 팀 흐름은 handle(..., 'team') 으로만 */
  readonly direct?: boolean;
  /** rauha 노트(기억·항상 룰). 메인 채팅 Claude 가 remember·keep_rule 로 쓰고, 모든 팀원에게 붙는다 */
  readonly notebook?: {
    readonly remember: (note: { readonly title: string; readonly text: string; readonly source: string | null }) => Promise<string>;
    readonly keepRule: (path: string) => Promise<string>;
    readonly memoryBlock: () => string;
    readonly rulesBlock: () => string;
  };
  /** 사용자의 Claude Code 지시(~/.claude/CLAUDE.md + @import). 팀원도 Claude Code 처럼 따른다 */
  readonly claudeMd?: () => string;
  /** 메인 채팅 Claude 의 add_todo: 할 일 탭에 카드 하나. 결과 한 줄 */
  readonly addTodo?: (card: { readonly title: string; readonly note: string; readonly checklist: readonly string[] }) => Promise<string>;
  /** "투두 정리해줘"로 뽑은 할 일을 할 일 탭에 카드 하나(여럿이면 체크리스트)로 넣는다. 없으면 투두 요청도 평소처럼 라우터로 간다 */
  readonly addTodos?: (card: TodoCard) => Promise<void>;
  /** 할 일 탭의 끝나지 않은 할 일(카드 제목·안 끝난 체크리스트 글) */
  readonly openTodos?: () => Promise<readonly string[]>;
  /** GitHub Actions 읽기(Actions 탭·CI 감시와 같은 클라이언트). 있으면 팀원이 ci_runs·ci_log 도구를 쓴다 */
  readonly actions?: () => ActionsClient;
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
  /** 팀원이 읽기만 할 수 있는 작업 폴더 밖 폴더들(채팅에 붙인 이미지 임시 폴더). 없으면 없음. */
  readonly readRoots?: readonly string[] | undefined;
  /** 등급별 모델 ID(설정의 Models). 부를 때마다 최신 값을 돌려준다. 없거나 이상한 값은 기본 모델이다. */
  readonly models?: (() => Readonly<Partial<Record<ModelTier, string>>>) | undefined;
  /** 모델을 쓸 수 없어 다른 모델로 대신 실행했을 때의 한 줄 안내(결과 글 끝에 붙인다). 진행 표시에는 항상 보인다. */
  readonly onFallback?: ((line: string) => void) | undefined;
  /** 사용자 말에서 배운 답변 취향(팀원 프롬프트 끝에 붙는다) */
  readonly styleNotes?: (() => string) | undefined;
  /** 설정에서 연결한 커넥터(노션·컨플루언스 …). 부를 때마다 최신 목록. 없으면 붙이지 않는다. */
  readonly connectors?: (() => ConnectorServers) | undefined;
  /** 설정에서 켜 둔 플러그인·사용자 스킬 폴더. 부를 때마다 최신 목록. 없으면 붙이지 않는다. */
  readonly plugins?: (() => readonly PluginLoad[]) | undefined;
  /** 레포 폴더에 연결된 DB(DB 탭에 저장한 연결 중 레포 설정과 맞는 것). 코드 작업 팀원에게 읽기 전용 도구로 붙는다. 없으면 붙이지 않는다. */
  readonly database?: ((repoRoot: string) => Promise<LinkedDatabase | null>) | undefined;
  /** 지금 AWS 상태 한 줄(프로필·리전·VPN). AWS 작업 팀원에게만 붙는다. 없으면 붙이지 않는다. */
  readonly awsNow?: (() => string) | undefined;
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
    // read: 답의 근거가 다른 레포 파일일 때 그 레포의 규칙(비밀 파일 제외)으로 읽어 확인한다.
    also: scope.also.map((r) => ({ name: r.name, root: r.root, knowledge: null, read: (path: string) => new GitWorkspace(r.root, loadSecretPolicy(r.root)).readFile(path) })),
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
  // 작업 공간의 모든 저장소(하나면 이 저장소). 스탠드업·변경 묶음·rauha 작업 공간 도구가 같이 쓴다(모델 호출 없음).
  const workspaceRepos = scope.repos.length > 0 ? scope.repos : [{ name: basename(keyRoot), root: keyRoot }];
  // 팀원이 도구를 여러 번 불러도 git 을 저장소마다 매번 돌리지 않게 잠깐 담아 둔다
  let changes: { at: number; value: Promise<DigestRepo[]> } | null = null;
  const repoChanges = (): Promise<DigestRepo[]> => {
    if (changes === null || Date.now() - changes.at > DIGEST_FRESH_MS) changes = { at: Date.now(), value: repoDigest(workspaceRepos) };
    return changes.value;
  };
  const actions = options.actions;
  const workspaceFacts: WorkspaceFacts = {
    repos: () => workspaceRepos,
    repoChanges,
    myCommits: (since) => standupLog(workspaceRepos, since),
    today: () => localDate(),
    repoStatus,
    search: searchRepos,
    fileHistory,
    showCommit,
    // 기억은 아래에서 연다(도구는 팀원이 일하는 중에만 불리므로 그때는 열려 있다)
    pastWork: async (query) => recallBlock(await memory.search(query, PAST_WORK_RECALLS), PAST_WORK_CHARS),
    companyNotes: async () => (await new FileCompanyBook(profile.companyDir(home), keyRoot).load()).block(),
    dependencies: dependencyManifests,
    // 회계·클라우드 비용·데이터 팀원이 CSV·엑셀을 읽는다(비밀 파일은 막는다)
    readSpreadsheet: async (repo, path) => {
      if (loadSecretPolicy(repo.root).isSecret(path)) throw new Error('비밀 파일이라 읽지 않아요');
      return readSpreadsheet(join(repo.root, path));
    },
    ...(options.openTodos !== undefined ? { openTodos: options.openTodos } : {}),
    ...(options.addTodo !== undefined ? { addTodo: options.addTodo } : {}),
    ...(options.notebook !== undefined ? { remember: options.notebook.remember, keepRule: options.notebook.keepRule } : {}),
    ...(actions !== undefined ? { ciRuns: (repos) => ciRuns(actions(), repos), ciLog: (repo, runId) => ciLog(actions(), repo, runId) } : {}),
  };
  const inner = new AgentSdkTeamMember({
    workspace: () => workspaceFacts,
    cwd: root,
    env: { ...definedEnv(process.env), ...profile.agentEnv(home) },
    prompts,
    ask: io.ask,
    secrets,
    secretFiles: () => listSecretFiles(root, secrets),
    ...(options.claudeExecutable !== undefined ? { claudeExecutable: options.claudeExecutable } : {}),
    ...((options.readRoots?.length ?? 0) > 0 ? { readRoots: options.readRoots! } : {}),
    ...(options.connectors !== undefined ? { connectors: options.connectors } : {}),
    ...(options.plugins !== undefined ? { plugins: options.plugins } : {}),
    // .env 같은 레포 설정은 원래 레포(keyRoot)에 있다(worktree 에는 커밋 안 한 설정 파일이 없다)
    ...(options.database !== undefined ? { database: () => options.database!(keyRoot) } : {}),
    ...(options.rules !== undefined ? { rules: (tool: string, detail: string) => options.rules!().verdictFor(tool, detail, keyRoot) } : {}),
    // 항상 지킬 것: 규칙 탭 글 + rauha 노트의 룰 파일(지금 내용). 어느 폴더에서 일하든 모든 팀원에게
    alwaysRules: () => [options.rules?.().alwaysTexts(keyRoot).map((t) => `- ${t}`).join('\n') ?? '', options.notebook?.rulesBlock() ?? ''].filter((s) => s !== '').join('\n\n'),
    ...(options.claudeMd !== undefined ? { claudeMd: options.claudeMd } : {}),
    ...(options.notebook !== undefined ? { memoryNotes: options.notebook.memoryBlock } : {}),
    ...(options.styleNotes !== undefined ? { styleNotes: options.styleNotes } : {}),
    ...(options.awsNow !== undefined ? { awsNow: options.awsNow } : {}),
  });
  const team = stoppable(new ModelRoutingTeam(inner, () => ModelSettingsDto.from(options.models?.()).toEntity(), (line) => {
    io.progress.step(line);
    options.onFallback?.(line);
  }), io.signal);
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
    ...(options.direct === true ? { direct: true } : {}),
    knowledge,
    repoName: basename(keyRoot),
    workRoot: root,
    folder,
    // 작업 공간의 다른 저장소들이 저장해 둔 지식(파일만 읽음): 한 번 읽은 저장소를 질문·일마다 다시 읽지 않게
    ...(folder !== undefined && folder.repos.length > 1
      ? {
          workspaceKnowledge: async () => {
            const items = await workspaceKnowledge(folder.repos, keyRoot, (repoRoot) => new FileKnowledgeStore(profile.knowledgeDir(home), repoRoot).load());
            // 뒤에서 모델 없이 지도를 맞춘다: 아직 모르는 저장소도 다음 질문부터는 처음부터 다시 읽지 않는다
            void mapRefresher(profile.knowledgeDir(home), roles).refresh(folder.repos.filter((r) => items.some((i) => i.name === r.name)).map((r) => r.root));
            return items;
          },
        }
      : {}),
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
        // 저장소에 맞는 검사: Node(test 스크립트) 또는 안드로이드·자바·코틀린·Go·Python·Rust·Flutter·Swift 패키지
        checks: projectChecks(root),
        log: new FileRunLog(profile.runsDir(home), runId, new Date(), prompts.hash),
        progress: io.progress,
        user: io.user,
        roles,
        newId: () => runId,
        now: () => Date.now(),
        today: () => localDate(),
        badge: profile.badge(),
        // 커밋하지 않은 변경이 있어도 막지 않는다: 시작 때의 모습을 기준으로 삼고, 섞인 파일은 결과 카드에 알린다
        requireClean: false,
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
    // 스탠드업·퇴근 정리: 작업 공간의 모든 저장소(하나면 이 저장소)에서 내 커밋을 git 으로 모은다(모델 호출 없음)
    ...(options.addTodos !== undefined ? { addTodos: options.addTodos } : {}),
    workspaceRoot: scope.workspaceRoot,
    // 할 일 파일 근거 확인: 작업 공간 폴더와 레포들 안만(비밀 파일 제외)
    readWorkspaceFile: workspaceFileReader([root, keyRoot, scope.workspaceRoot, ...scope.repos.map((r) => r.root)]),
    workLog: (since) => standupLog(workspaceRepos, since),
    // "모든 레포 체인지로그·커밋 봐줘": 모든 저장소의 최근 커밋·태그·CHANGELOG 를 rauha 가 먼저 모은다(모델 호출 없음)
    repoDigest: repoChanges,
    ...(options.openTodos !== undefined ? { openTodos: options.openTodos } : {}),
  };
  // 앞 대화는 레포(keyRoot)마다 파일에 이어 둔다: 업무가 열 때 받아 오고, 끝나면 새로 생긴 대화만 합쳐 저장한다.
  const conversations = RepoConversations.under(profile.sessionsDir(home));
  // 레포가 여럿인 작업 공간이면 다른 레포 대화도 함께 이어 받는다(읽기만; 파일 목록은 레포별).
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const siblings = scope.repos.length > 1 ? scope.repos.filter((r) => norm(r.root) !== norm(keyRoot)) : [];
  return {
    handle: async (input, depth) => {
      const conversation = await conversations.open(keyRoot, siblings).catch(() => null);
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
