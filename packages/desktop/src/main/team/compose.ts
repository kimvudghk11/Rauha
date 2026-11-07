import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { basename, join } from 'node:path';
import {
  AgentSdkTeamMember,
  ChatSession,
  DesignService,
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
  SessionBudget,
  SqliteMemory,
  listSecretFiles,
  loadProfileConfig,
  loadSecretPolicy,
  projectLockFile,
  projectMemoryFile,
  type MemberCall,
  type MemberResult,
  type PlanUsage,
  type Profile,
  type PromptLibrary,
  type TeamMemberPort,
} from '@rauha/core';
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
export async function profileResolver(home: string): Promise<(cwd: string) => Profile> {
  const configPath = process.env['RAUHA_CONFIG'] ?? join(home, '.rauha', 'config.toml');
  const book = (await loadProfileConfig(configPath)).toEntity();
  return (cwd) => book.resolve({ cwd, home, gitRemote: gitRemote(cwd), flag: null, env: process.env['RAUHA_PROFILE'] ?? null }).profile;
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
}

/**
 * 폴더 하나에서 일하는 팀 세션을 만든다(조립만 한다). 작업마다 새로 만들어 대화 상태를 나눠 갖지 않는다.
 * 기억·지식·학습 노트는 폴더(저장소) 단위로 파일에 있어 작업끼리 이어진다.
 */
export function composeSession(options: ComposeOptions, root: string, io: TeamIo): TeamSession {
  const { home, prompts } = options;
  const profile = options.profileFor(root);
  const secrets = loadSecretPolicy(root);
  const roles = RoleSettingsDto.defaults().withEnv({ ...process.env });
  const inner = new AgentSdkTeamMember({
    cwd: root,
    env: { ...definedEnv(process.env), ...profile.agentEnv(home) },
    prompts,
    ask: io.ask,
    secrets,
    secretFiles: () => listSecretFiles(root, secrets),
    ...(options.claudeExecutable !== undefined ? { claudeExecutable: options.claudeExecutable } : {}),
  });
  const team = stoppable(inner, io.signal);
  const knowledge = new KnowledgeService({
    reader: new GitRepoReader(root, secrets),
    store: new FileKnowledgeStore(profile.knowledgeDir(home), root),
    team,
    roles,
    progress: io.progress,
    repoName: basename(projectRoot(root)),
  });
  const runId = randomUUID();
  const memory = SqliteMemory.open(projectMemoryFile(profile.memoryDir(home), projectRoot(root)));
  const session = ChatSession.start({
    knowledge,
    repoName: basename(root),
    designer: new DesignService({
      team,
      roles,
      user: { discuss: async () => null, approve: async () => ({ kind: 'cancel' }) },
      store: new FileDesignStore(profile.designsDir(home), root),
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
    learning: new FileLearningStore(profile.learningDir(home), root),
    company: new FileCompanyBook(profile.companyDir(home), root),
    budget: () => SessionBudget.fromWindows([options.plan()?.session ?? null, options.plan()?.weekly ?? null]),
    nowText: () => `${new Date().toLocaleString('ko-KR', { dateStyle: 'full', timeStyle: 'short' })} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`,
  });
  return {
    handle: async (input) => {
      try {
        return await session.handle(input);
      } finally {
        memory.close();
      }
    },
  };
}
