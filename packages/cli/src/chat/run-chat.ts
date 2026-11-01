import { render } from 'ink';
import React from 'react';
import { execFile, spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  ChatSession,
  DesignService,
  discoverRepos,
  FileChatSnapshots,
  FileCompanyBook,
  FileDesignStore,
  FileLearningStore,
  FileRoutineStore,
  FileWorkspaceStore,
  GitWorkspace,
  isRepo,
  loadSecretPolicy,
  readPlanUsage,
  SessionBudget,
  Workspace,
  WorkspaceSession,
  type ChatSnapshot,
  type PlanUsage,
  type Profile,
  type RepoSession,
  type WorkspaceRepo,
} from '@rauha/core';
import { readLoginStatus } from '../login-status.js';
import { mascotView } from '../mascot.js';
import { createNotifier, LONG_WORK_MS, notifyIfLong } from '../notify.js';
import { createKnowledge, createLoop, createTeam, definedEnv, loadPrompts, openMemory, projectRoot, roleSettings } from '../run.js';
import { ChatApp } from './chat-app.js';
import { chatProgress } from './chat-progress.js';
import { ChatStore, type Printable } from './chat-store.js';
import { localDate } from '../local-date.js';
import { dueNotice } from './routine-lines.js';
import { createChatUser } from './chat-user.js';
import { queueCommand, runCommand, type ChatState, type CommandContext } from './command-handlers.js';
import { parseCommand, type ChatCommand } from './commands.js';
import { markStarted } from './routine-command.js';
import { parkingStream } from './cursor-park.js';
import { describeTurn } from './describe-turn.js';
import { InputHistoryFile } from './input-history.js';
import { relaunch, withContinue } from '../update.js';
import { startRefreshing } from './status-refresh.js';
import { statusLine, usageLines } from './usage-view.js';

export interface ChatOptions {
  readonly workDir: string;
  readonly profile: Profile;
  readonly home: string;
  readonly version: string;
  /** false면 리뷰·사실 점검 없이(--quick) */
  readonly threePass: boolean;
  /** 지난 대화를 이어서 연다(--continue) */
  readonly resume: boolean;
  /** 저장소마다 계정(프로필) 고르기. 폴더 규칙(config.toml)을 그 저장소 경로에 적용한다. */
  readonly profileFor: (root: string) => Profile;
}

const columns = () => process.stderr.columns ?? 80;
/** 쉬는 중 Ctrl+C를 두 번 눌러 끝낼 때 두 번째를 기다리는 시간 */
const EXIT_WINDOW_MS = 2000;
/** 상태 줄의 사용률을 다시 읽는 간격 */
const USAGE_REFRESH_MS = 60_000;

/** 지금 브랜치 이름. git이 없거나 실패하면 null. */
async function currentBranch(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await promisify(execFile)('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/** 저장소의 파일 목록(추적 중이거나 아직 추적하지 않지만 무시되지 않은 것). git이 없거나 실패하면 빈 목록. */
async function listFiles(cwd: string): Promise<string[]> {
  try {
    const { stdout } = await promisify(execFile)('git', ['ls-files', '-co', '--exclude-standard'], { cwd, maxBuffer: 32 * 1024 * 1024 });
    return stdout.split(/\r?\n/).filter((l) => l !== '');
  } catch {
    return [];
  }
}

/** rauha(인자 없음): Claude Code 같은 대화 화면. 화면이 없으면 열지 않는다. */
export async function runChat(options: ChatOptions): Promise<number> {
  if (process.stdin.isTTY !== true || process.stderr.isTTY !== true) {
    process.stdout.write('대화 모드는 터미널에서만 열 수 있어요. rauha -p "<요청>"을 쓰세요.\n');
    return 1;
  }
  const { workDir, profile, home } = options;
  const view = mascotView(process.stderr.getColorDepth(), `v${options.version}`, profile.badge());
  const store = new ChatStore();
  // 보낸 입력은 파일에 남겨 다음에 열어도 위 화살표로 부를 수 있다.
  const inputHistory = new InputHistoryFile(join(home, '.rauha', 'input-history.txt'));
  store.restoreHistory(await inputHistory.load());

  /** 사용자가 보낸 입력을 대화에 남기는 줄들. 화면이 있으면 지난 답과 나누는 가로줄과 막대를 쓴다. */
  const userTurn = (text: string): Printable[] => (view === null ? ['', `> ${text}`] : ['', (columns: number) => view.userTurn(text, columns)]);

  const progress = chatProgress(store, view, Date.now);
  const finishWorking = progress.finish;

  // 사용자가 바로 답하지 않는 질문은 운영체제 알림으로도 알린다(바로 답하면 알림은 뜨지 않는다).
  const notifier = createNotifier();
  const { ask, user, designUser } = createChatUser({ store, view, notifier, badge: profile.badge(), columns });

  const prompts = await loadPrompts();

  // 작업 공간: 띄운 폴더가 저장소면 그것 하나, 저장소들을 담은 폴더면 그 아래 저장소들, 없으면 띄운 폴더 하나.
  const wsStore = new FileWorkspaceStore(join(home, '.rauha', 'workspaces'), workDir);
  const savedWs = await wsStore.load();
  const found = discoverRepos(workDir);
  const extra = (savedWs?.extra ?? []).filter((r) => isRepo(r));
  const roots = [...(found.length > 0 ? found : [workDir]), ...extra];
  const workspace = Workspace.of(roots, savedWs?.current ?? (roots.length === 1 ? roots[0]! : null));
  const multi = () => workspace.repos.length > 1;
  const saveWs = () => void wsStore.save({ extra, current: workspace.current()?.root ?? null }).catch(() => undefined);

  /** 저장소 하나에 딸린 것들. 저장소마다 그 저장소의 계정(프로필)으로 팀원·기억·지식을 따로 둔다. */
  interface Bundle {
    readonly profile: Profile;
    readonly chat: ChatSession;
    readonly team: ReturnType<typeof createTeam>;
    readonly memory: ReturnType<typeof openMemory>;
    readonly snapshots: FileChatSnapshots;
  }
  const bundles = new Map<string, Bundle>();
  // --continue: 저장소마다 저장해 둔 대화를 미리 읽는다(세션은 그 저장소를 처음 쓸 때 연다).
  const resumed = new Map<string, ChatSnapshot | null>();
  if (options.resume) {
    for (const repo of workspace.repos) resumed.set(repo.root, await new FileChatSnapshots(options.profileFor(repo.root).sessionsDir(home), projectRoot(repo.root)).load());
  }

  const open = (repo: WorkspaceRepo): RepoSession => {
    const repoProfile = options.profileFor(repo.root);
    const ctx = { root: repo.root, profile: repoProfile, home, ask, user, progress, requireClean: true, threePass: options.threePass };
    const team = createTeam(ctx, prompts);
    const knowledge = createKnowledge(ctx, team);
    const memory = openMemory(ctx);
    const deps = {
      knowledge,
      repoName: repo.name,
      // /repo add로 저장소가 늘 수 있어 부를 때마다 읽는다.
      get folder() {
        return multi() ? { root: workDir, repos: workspace.repos.map((r) => ({ name: r.name, root: r.root })) } : undefined;
      },
      designer: new DesignService({ team, roles: roleSettings(), user: designUser, store: new FileDesignStore(repoProfile.designsDir(home), repo.root), progress, today: localDate }),
      newLoop: (carried: ReadonlyMap<string, string>) => createLoop(ctx, prompts, team, carried, knowledge),
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
      budget: () => SessionBudget.fromWindows([plan?.session ?? null, plan?.weekly ?? null]),
      nowText: () => `${new Date().toLocaleString('ko-KR', { dateStyle: 'full', timeStyle: 'short' })} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`,
    };
    const saved = resumed.get(repo.root) ?? null;
    const chat = saved !== null ? ChatSession.resume(deps, saved) : ChatSession.start(deps);
    bundles.set(repo.root, { profile: repoProfile, chat, team, memory, snapshots: new FileChatSnapshots(repoProfile.sessionsDir(home), projectRoot(repo.root)) });
    return { repo, profileName: repoProfile.name, chat, knowledge };
  };
  const ws = new WorkspaceSession({ workspace, open, user, onCurrent: () => saveWs() });
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
  // 지금 저장소가 있으면 미리 연다(라우터·답변 팀원을 미리 띄워 첫 질문이 빠르게).
  const first = current();
  /** /guide·/copy·/retry·/update가 이어서 쓰는 상태 */
  const state: ChatState = { lastGuide: null, lastAnswer: null, lastRequest: null, restartAfterExit: false };

  // @를 치면 보여 줄 파일 목록. 저장소가 바뀌거나 일이 끝나면 다시 읽는다.
  let fileList: string[] = [];
  const refreshFiles = () => void listFiles(ws.current()?.root ?? workDir).then((list) => (fileList = list));
  refreshFiles();

  const screen = parkingStream(process.stderr);
  const app = render(
    React.createElement(ChatApp, {
      store,
      banner: (width: number, rows: number) => view?.banner(workDir, width, rows) ?? `${profile.badge()} ${workDir}`,
      view,
      onSubmit: (text: string) => submit(text),
      onInterrupt: () => interrupt(),
      cursor: screen.park,
      files: () => fileList,
    }),
    { stdout: screen.stream, exitOnCtrlC: false },
  );

  // 정기 업무: 자동으로 돌지 않는다. 때가 된 것을 알리기만 하고, /routine run을 할 때 돈다.
  const today = () => localDate();
  const routineStore = () => {
    const root = ws.current()?.root ?? workDir;
    return new FileRoutineStore(options.profileFor(root).routinesDir(home), root);
  };
  void routineStore()
    .load()
    .then((book) => {
      const notice = dueNotice(book, today());
      if (notice !== null) store.printLines(notice);
    })
    .catch(() => undefined);
  if (multi()) store.print(`  작업 공간 저장소 ${workspace.repos.length}개: ${workspace.repos.map((r) => r.name).join(', ')} · /repo로 고를 수 있어요`);
  if (options.resume) {
    const s = first?.chat.status();
    const any = [...resumed.values()].some((v) => v !== null);
    store.print(any && s ? `  지난 대화를 이어요 · 대화 ${s.turns}번 · 마지막 작업: ${s.lastTitle ?? '없음'}` : '  이어 갈 대화가 없어서 새로 시작해요.');
  }

  // 로그인이 풀려 있으면 첫 요청에서 알기 전에 미리 알린다(풀린 채로 두면 요청이 엉뚱하게 처리된 적이 있다). 프로필마다 한 번, 모르면 조용히.
  for (const checked of new Set(workspace.repos.map((r) => options.profileFor(r.root)))) {
    void readLoginStatus({ ...definedEnv(process.env), ...checked.agentEnv(home) }).then((loggedIn) => {
      if (loggedIn === false) store.print(`  ⚠ ${checked.badge()} Claude에 로그인되어 있지 않아요. /exit로 나가서 ${checked.name === 'personal' ? 'rauha login' : `rauha login --profile ${checked.name}`}을 실행한 뒤 다시 와 주세요.`);
    });
  }

  // 일하는 중에 받은 입력은 대기열에 세우고, 지금 일이 끝나면 넣은 순서대로 하나씩 처리한다.
  let running = false;
  function submit(text: string): void {
    void inputHistory.append(text);
    // 쌓아 둔 입력을 다루는 명령은 줄 서지 않고 바로 처리한다.
    const command = parseCommand(text);
    if (command?.kind === 'queue') return queueCommand(store, command.action);
    if (running) {
      store.enqueue(text);
      return;
    }
    void drain(text);
  }
  async function drain(first: string): Promise<void> {
    running = true;
    try {
      for (let next: string | undefined = first; next !== undefined; next = store.dequeue()) await handle(next).catch((error: Error) => store.print(`rauha: ${error.message}`));
    } finally {
      running = false;
    }
  }

  // Ctrl+C: 일하는 중이면 그 작업만 멈춘다(팀원 호출을 끊고 기다리던 질문은 거절로 닫는다).
  // 쉬는 중이면 2초 안에 한 번 더 눌러야 끝난다.
  let lastInterrupt = 0;
  function interrupt(): void {
    if (store.busy) {
      for (const b of bundles.values()) b.team.cancel();
      store.cancelPrompts();
      const dropped = store.clearQueue();
      store.print(dropped > 0 ? `  멈추는 중이에요… (기다리던 입력 ${dropped}개도 지웠어요)` : '  멈추는 중이에요…');
      return;
    }
    if (Date.now() - lastInterrupt < EXIT_WINDOW_MS) {
      // 알림을 지운 화면이 한 번 그려진 뒤 닫는다(바로 닫으면 마지막 화면에 알림이 남는다).
      store.setNotice('');
      setTimeout(() => app.unmount(), 50);
      return;
    }
    lastInterrupt = Date.now();
    // 지난 출력에 남기지 않고 입력창 아래에 잠깐 띄운다(Claude Code·Kiro처럼).
    store.setNotice('한 번 더 Ctrl+C(또는 Ctrl+D)를 누르면 끝나요');
    setTimeout(() => store.setNotice(''), EXIT_WINDOW_MS).unref();
  }

  const commandContext: CommandContext = {
    store,
    view,
    state,
    roles: roleSettings(),
    current,
    repoLabel: () => (multi() ? `[${ws.current()?.name}] ` : ''),
    clearAll: () => {
      for (const b of bundles.values()) {
        b.chat.clear();
        remember(b);
      }
    },
    remember: (repo) => remember([...bundles.values()].find((b) => b.chat === repo.chat)),
    showUsage: async () => {
      await usageTimer.now();
      store.printLines(usageLines(plan, totalUsage(), new Date(), undefined, view?.gauge));
    },
    repoCommand,
    userTurn,
    finishWorking,
    runTurn,
    unmount: () => app.unmount(),
    shellDir: () => ws.current()?.root ?? workDir,
    routines: {
      store: routineStore,
      today,
      // /routine run: 대기열에 넣고, 실제로 시작될 때 handle이 오늘 했다고 표시한다.
      startLater: (request, id) => {
        startingRoutines.set(request, id);
        store.enqueue(request);
      },
    },
  };

  /** /routine run으로 대기열에 넣은 업무(요청 글 → 업무 번호). 실제로 시작될 때 오늘 했다고 표시한다. */
  const startingRoutines = new Map<string, string>();

  async function handle(text: string): Promise<void> {
    const routineId = startingRoutines.get(text);
    if (routineId !== undefined) {
      startingRoutines.delete(text);
      void markStarted(routineStore(), routineId, today());
    }
    const command = parseCommand(text);
    if (command !== null) return runCommand(commandContext, command, text);
    state.lastRequest = text;
    return runTurn(text, text);
  }

  /** 입력 하나를 작업 공간에 보내고 결과를 화면에 낸다. shown: 화면에 "> " 뒤로 보일 글, force: /design처럼 라우터를 건너뛸 때 */
  async function runTurn(shown: string, request: string, force?: 'design'): Promise<void> {
    store.printLines(userTurn(shown));
    for (const b of bundles.values()) b.team.resume();
    store.setBusy(true);
    const startedAt = Date.now();
    let handled: string | null = null;
    try {
      const turn = await ws.handle(request, force);
      handled = turn.repo;
      if (turn.kind === 'work') {
        state.lastGuide = turn.outcome.guide.toMarkdown();
        state.lastAnswer = null;
      }
      if (turn.kind === 'answer') state.lastAnswer = turn.answer;
      finishWorking();
      if (multi() && turn.repo !== null) store.print(`  [${turn.repo}]`);
      store.printLines(describeTurn(turn, view));
    } catch (error) {
      finishWorking();
      store.print(`rauha: ${(error as Error).message}`);
    } finally {
      store.setBusy(false);
      // 오래 걸린 일이 끝나면 다른 창에 있어도 알 수 있게 알린다.
      notifyIfLong(notifier, startedAt, Date.now(), LONG_WORK_MS, `${profile.badge()} 작업이 끝났어요`, shown);
      remember(bundleNamed(handled));
      void usageTimer.now();
      refreshFiles();
    }
  }

  /** 열린 저장소 세션들의 호출 수를 더한다. */
  function totalUsage() {
    const calls = { haiku: 0, sonnet: 0, opus: 0 };
    let costUsd = 0;
    for (const b of bundles.values()) {
      const u = b.chat.usage();
      costUsd += u.costUsd;
      for (const tier of Object.keys(calls) as (keyof typeof calls)[]) calls[tier] += u.calls[tier];
    }
    return { calls, costUsd };
  }

  async function repoCommand(command: Extract<ChatCommand, { kind: 'repo' }>): Promise<void> {
    if (command.action === 'add') {
      const path = resolve(workDir, command.path);
      if (!isRepo(path)) return store.print(`  ${command.path}는 git 저장소가 아니에요.`);
      const repo = ws.add(path);
      const known = (list: readonly string[]) => list.some((e) => e.toLowerCase() === path.toLowerCase());
      if (!known(extra) && !known(found)) extra.push(path);
      saveWs();
      return store.print(`  작업 공간에 더했어요: ${repo.name}`);
    }
    if (command.action === 'select') {
      const repo = ws.select(command.name);
      if (repo === null) return store.print(`  ${command.name} 저장소가 작업 공간에 없어요. /repo로 목록을 볼 수 있어요.`);
      void usageTimer.now();
      refreshFiles();
      return store.print(`  지금 저장소: ${repo.name}`);
    }
    const now = ws.current()?.root ?? null;
    const lines = await Promise.all(
      workspace.repos.map(async (r) => `  ${r.root === now ? '▸' : ' '} ${r.name}  ${(await currentBranch(r.root)) ?? '-'}  (${options.profileFor(r.root).name})`),
    );
    store.printLines(['', `  작업 공간 저장소 ${workspace.repos.length}개`, ...lines, '']);
  }

  // 상태 줄: 시작할 때, 입력 하나가 끝날 때, 그리고 입력이 없어도 1분마다 사용률을 새로 읽는다(모델을 부르지 않는다).
  // 세션 한도가 풀린 뒤에도 옛 퍼센트가 남아 있지 않게 하려고. 읽기에 실패하면 마지막으로 읽은 값을 그대로 둔다.
  let plan: PlanUsage | null = null;
  const usageTimer = startRefreshing(async () => {
    const repo = ws.current();
    const shown = repo === null ? profile : options.profileFor(repo.root);
    const agentEnv = { ...definedEnv(process.env), ...shown.agentEnv(home) };
    const [usage, branch] = await Promise.all([readPlanUsage(agentEnv), currentBranch(repo?.root ?? workDir)]);
    plan = usage ?? plan;
    store.setStatus(statusLine(shown.badge(), plan, branch, view?.gauge, multi() ? (repo?.name ?? null) : null));
  }, USAGE_REFRESH_MS);

  await app.waitUntilExit();
  screen.release();
  usageTimer.stop();
  for (const b of bundles.values()) {
    b.team.close();
    b.memory.close();
  }
  if (state.restartAfterExit) return relaunch(spawn, process.execPath, process.execArgv, process.argv[1]!, withContinue(process.argv.slice(2)));
  process.stderr.write('\n  대화를 마쳤어요. 이어서 하려면 rauha -c\n');
  return 0;
}
