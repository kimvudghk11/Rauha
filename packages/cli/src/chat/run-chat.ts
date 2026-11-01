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
  FileLearningStore,
  FileRoutineStore,
  Routine,
  FileDesignStore,
  FileWorkspaceStore,
  GitWorkspace,
  isRepo,
  loadSecretPolicy,
  Workspace,
  WorkspaceSession,
  type ChatSnapshot,
  type DesignUserPort,
  type RepoSession,
  type WorkspaceRepo,
  readPlanUsage, SessionBudget, type PermissionAsker, type PlanUsage, type Profile, type UserPort } from '@rauha/core';
import { FACT_ANSWERED, FACT_OPTIONS, PERMISSION_ANSWERED, PERMISSION_OPTIONS, toFactAnswer, toPermissionAnswer } from '../ask.js';
import { readLoginStatus } from '../login-status.js';
import { mascotView } from '../mascot.js';
import { copyToClipboard } from '../clipboard.js';
import { createNotifier, LONG_WORK_MS, NOTIFY_AFTER_MS, notifyIfLong, notifyWhile } from '../notify.js';
import { createKnowledge, createLoop, createTeam, definedEnv, loadPrompts, openMemory, projectRoot, roleSettings } from '../run.js';
import { ChatApp } from './chat-app.js';
import { chatProgress } from './chat-progress.js';
import { ChatStore, type Printable } from './chat-store.js';
import { localDate } from '../local-date.js';
import { runShell } from '../shell-run.js';
import { companyLines } from './company-lines.js';
import { learningLines } from './learning-lines.js';
import { dueNotice, ROUTINE_USAGE, routineLines } from './routine-lines.js';
import { teamLines } from './team-lines.js';
import { HELP_TEXT, parseCommand, type ChatCommand } from './commands.js';
import { parkingStream } from './cursor-park.js';
import { describeTurn } from './describe-turn.js';
import { InputHistoryFile } from './input-history.js';
import { isRauhaRepo, nodeExec, relaunch, repoRoot, runUpdate, withContinue } from '../update.js';
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

const NO_CURRENT = '  어느 저장소인지 먼저 정해 주세요. /repo <이름>으로 고를 수 있어요.';

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

  const askPermission: PermissionAsker = async (request) => {
    const screen = view?.permission(request, columns()) ?? `⚠ 위험 동작 허락? ${request.reason}\n  ${request.detail}`;
    const compactScreen = view?.permission(request, columns(), true);
    const index = (await store.ask({ kind: 'menu', screen, compactScreen, options: PERMISSION_OPTIONS })) as number;
    const note = index === 3 ? ((await store.ask({ kind: 'text', label: '팀원에게 전할 이유' })) as string) : null;
    store.print(`  → ${PERMISSION_ANSWERED[index < 0 ? 2 : index]}`);
    return toPermissionAnswer(index, note);
  };
  const asker: UserPort = {
    interactive: true,
    choose: async (assumption) => {
      const options = [`${assumption.chosen}  (추천)`, ...assumption.alternatives];
      const index = (await store.ask({ kind: 'menu', screen: `? ${assumption.question}`, options })) as number;
      return index < 0 ? 0 : index;
    },
    confirmFact: async (claim) => {
      const screen = view?.factCheck(claim.text, columns()) ?? `? 근거를 확인하지 못했어요. 맞나요?\n  ${claim.text}`;
      const compactScreen = view?.factCheck(claim.text, columns(), true);
      const index = (await store.ask({ kind: 'menu', screen, compactScreen, options: FACT_OPTIONS })) as number;
      const correction = index === 1 ? ((await store.ask({ kind: 'text', label: '바로잡을 내용' })) as string) : null;
      store.print(`  → ${FACT_ANSWERED[index < 0 ? 2 : index]}`);
      return toFactAnswer(index, correction);
    },
    pickPast: async (candidates) => {
      const screen = view?.pastPick(columns()) ?? '? 혹시 이 작업을 말씀하시는 건가요?';
      const options = [...candidates.map((c) => `${c.title}  (${c.at.slice(0, 16).replace('T', ' ')})`), '아니요, 새 작업이에요'];
      const compactScreen = view?.pastPick(columns(), true);
      const index = (await store.ask({ kind: 'menu', screen, compactScreen, options })) as number;
      return index >= 0 && index < candidates.length ? candidates[index]!.id : null;
    },
  };

  // 사용자가 바로 답하지 않는 질문은 운영체제 알림으로도 알린다(바로 답하면 알림은 뜨지 않는다).
  const notifier = createNotifier();
  const asking = <T>(body: string, task: () => Promise<T>) => notifyWhile(notifier, NOTIFY_AFTER_MS, `${profile.badge()} 선택이 필요해요`, body, task);
  const ask: PermissionAsker = (request) => asking(`${request.tool} 실행 허락: ${request.detail}`, () => askPermission(request));
  const user: UserPort = {
    interactive: true,
    choose: (assumption) => asking(`요청의 해석을 정해 주세요: ${assumption.question}`, () => asker.choose(assumption)),
    confirmFact: (claim) => asking(`근거를 못 찾은 사실이 맞는지 알려 주세요: ${claim.text}`, () => asker.confirmFact(claim)),
    pickPast: (candidates) => asking('이 작업이 맞는지 알려 주세요', () => asker.pickPast(candidates)),
    discuss: (q) =>
      asking(`설계 질문에 답해 주세요: ${q.question}`, async () => {
        store.printLines(['', `  ? 설계 질문 ${q.round}: ${q.question}`]);
        if (q.suggestion !== null) store.print(`    추천: ${q.suggestion}`);
        store.print('    (Enter 또는 "알아서 해" = 추천대로, /cancel = 설계 그만두기)');
        const text = ((await store.ask({ kind: 'text', label: '답' })) as string).trim();
        return text.toLowerCase() === '/cancel' ? null : text;
      }),
    approve: (plan) =>
      asking(`설계를 보고 승인해 주세요: ${plan.title}`, async () => {
        store.printLines(['', ...plan.summary, `  설계 문서: ${plan.path} (직접 고쳐도 돼요)`, '']);
        const index = (await store.ask({ kind: 'menu', screen: '? 이 설계로 진행할까요?', options: ['승인하고 시작', '고칠 점 말하기', '그만두기'] })) as number;
        if (index === 0) return { kind: 'approve' } as const;
        if (index !== 1) return { kind: 'cancel' } as const;
        const note = ((await store.ask({ kind: 'text', label: '고칠 점' })) as string).trim();
        return note === '' ? ({ kind: 'cancel' } as const) : ({ kind: 'revise', note } as const);
      }),
    pickRepo: (candidates) =>
      asking('어느 저장소 일인지 골라 주세요', async () => {
        const index = (await store.ask({ kind: 'menu', screen: '? 어느 저장소 일인가요?', options: candidates.map((c) => c.name) })) as number;
        return index >= 0 && index < candidates.length ? candidates[index]!.name : null;
      }),
  };

  const prompts = await loadPrompts();

  /** 설계 서비스가 쓰는 사용자 쪽(위 user의 설계 대화 부분) */
  const designUser: DesignUserPort = { discuss: (q) => user.discuss!(q), approve: (plan) => user.approve!(plan) };

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
  /** 마지막 작업의 읽기 안내서. 결과 카드 대신 자세히 볼 때 /guide로 연다. */
  let lastGuide: string | null = null;
  /** 마지막 답 글(/copy로 클립보드에 복사한다) */
  let lastAnswer: string | null = null;
  /** /update로 갱신을 마쳐 화면을 닫은 뒤 다시 띄워야 하는지 */
  let restartAfterExit = false;
  /** 마지막으로 보낸 요청 글(/retry로 다시 보낸다) */
  let lastRequest: string | null = null;

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
  const SHELL_TIMEOUT_MS = 120_000;
  let running = false;
  function submit(text: string): void {
    void inputHistory.append(text);
    // 쌓아 둔 입력을 다루는 명령은 줄 서지 않고 바로 처리한다.
    const command = parseCommand(text);
    if (command?.kind === 'queue') return queueCommand(command.action);
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

  function queueCommand(action: 'show' | 'clear'): void {
    if (action === 'clear') {
      const dropped = store.clearQueue();
      store.print(dropped > 0 ? `  기다리던 입력 ${dropped}개를 지웠어요.` : '  기다리는 입력이 없어요.');
      return;
    }
    const queued = store.queue;
    store.printLines(queued.length === 0 ? ['  기다리는 입력이 없어요.'] : ['', `  기다리는 입력 ${queued.length}개 (/queue clear로 비워요)`, ...queued.map((t, i) => `    ${i + 1}. ${t}`)]);
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

  async function handle(text: string): Promise<void> {
    const command = parseCommand(text);
    if (command !== null) {
      switch (command.kind) {
        case 'clear':
          for (const b of bundles.values()) {
            b.chat.clear();
            remember(b);
          }
          // 터미널의 clear처럼 화면과 스크롤까지 지우고 배너부터 새로 그린다.
          store.clearScreen();
          return;
        case 'status': {
          const b = current();
          if (b === null) return store.print(NO_CURRENT);
          const s = b.chat.status();
          store.print(`  ${multi() ? `[${ws.current()?.name}] ` : ''}대화 ${s.turns}번 · 이어 일할 파일 ${s.carriedFiles}개 · 마지막 작업: ${s.lastTitle ?? '없음'}`);
          return;
        }
        case 'usage':
          await usageTimer.now();
          store.printLines(usageLines(plan, totalUsage(), new Date(), undefined, view?.gauge));
          return;
        case 'update': {
          if (!isRauhaRepo()) {
            store.print('  rauha가 저장소에서 실행 중이 아니라 갱신할 수 없어요. 저장소에서 yarn rauha update를 실행해 주세요.');
            return;
          }
          store.setBusy(true);
          store.print('\n  새 버전이 있는지 확인해요…');
          const result = await runUpdate(repoRoot(), nodeExec(), (line) => store.print(line));
          store.setBusy(false);
          if (!result.ok || !result.built) return;
          // 방금 빌드한 코드로 뜨도록, 이 화면을 닫고 같은 터미널에서 새 프로세스로 다시 띄운다(지난 작업 기억은 파일에 있어 남는다).
          store.print('  다시 띄울게요.');
          restartAfterExit = true;
          app.unmount();
          return;
        }
        case 'guide':
          store.print(lastGuide !== null ? `\n${lastGuide}\n` : '  아직 끝난 작업이 없어요.');
          return;
        case 'repo':
          return repoCommand(command);
        case 'review': {
          const b = current();
          if (b === null) return store.print(NO_CURRENT);
          store.printLines(userTurn(text));
          b.team.resume();
          store.setBusy(true);
          try {
            const turn = await b.chat.review(command.target);
            finishWorking();
            store.printLines(describeTurn(turn, view));
          } catch (error) {
            finishWorking();
            store.print(`rauha: ${(error as Error).message}`);
          } finally {
            store.setBusy(false);
            remember(b);
          }
          return;
        }
        case 'design': {
          if (command.request === null) return store.print('  /design <요청>으로 설계부터 시작해요. 예: /design 쿠폰 기능 만들어줘');
          return runTurn(text, command.request, 'design');
        }
        case 'queue':
          return queueCommand(command.action);
        case 'routine': {
          const routines = routineStore();
          const book = await routines.load();
          if (command.action === 'usage') return store.printLines(['', ...ROUTINE_USAGE, '']);
          if (command.action === 'list') return store.printLines(routineLines(book, today()));
          if (command.action === 'run') {
            const due = book.due(today());
            if (due.length === 0) return store.print('  때가 된 정기 업무가 없어요.');
            await routines.save(book.markRun(due.map((r) => r.id), today()));
            store.print(`  정기 업무 ${due.length}개를 차례로 실행해요.`);
            for (const r of due) store.enqueue(r.request);
            return;
          }
          try {
            if (command.action === 'add') {
              await routines.save(book.add(Routine.create({ id: crypto.randomUUID(), request: command.request, cadence: command.cadence, today: today() })));
              return store.print(`  정기 업무를 등록했어요: ${command.request}  (${command.cadence.kind === 'daily' ? '매일' : '매주'}, 때가 되면 알려 드려요)`);
            }
            if (command.action === 'remove') {
              await routines.save(book.remove(command.number));
              return store.print(`  ${command.number}번 정기 업무를 지웠어요.`);
            }
          } catch (error) {
            return store.print(`  ${(error as Error).message}`);
          }
        }
        case 'learn': {
          const b = current();
          if (b === null) return store.print(NO_CURRENT);
          store.printLines(learningLines(await b.chat.learningNotes()));
          return;
        }
        case 'company': {
          const b = current();
          if (b === null) return store.print(NO_CURRENT);
          store.printLines(companyLines(await b.chat.companyEntries()));
          return;
        }
        case 'team':
          store.printLines(teamLines(roleSettings()));
          return;
        case 'shell': {
          if (command.command === null) return store.print('  !<명령>으로 바로 실행해요. 예: !aws s3 ls');
          store.printLines(userTurn(text));
          store.setBusy(true);
          try {
            const result = await runShell(command.command, ws.current()?.root ?? workDir, SHELL_TIMEOUT_MS);
            const body = result.output.trimEnd();
            const status = result.timedOut ? `  ${SHELL_TIMEOUT_MS / 1000}초가 지나 멈췄어요.` : result.exitCode === 0 ? null : `  종료 코드 ${result.exitCode ?? '-'}`;
            store.printLines([...(body === '' ? [] : body.split(/\r?\n/).map((l) => `  ${l}`)), ...(status === null ? [] : [status])]);
          } finally {
            store.setBusy(false);
          }
          return;
        }
        case 'copy': {
          const text = lastAnswer ?? lastGuide;
          if (text === null) return store.print('  복사할 답이 아직 없어요.');
          store.print((await copyToClipboard(text)) ? '  마지막 답을 클립보드에 복사했어요.' : '  클립보드에 복사하지 못했어요. (Windows는 PowerShell, macOS는 pbcopy, Linux는 xclip이 필요해요)');
          return;
        }
        case 'retry':
          if (lastRequest === null) return store.print('  다시 보낼 요청이 아직 없어요.');
          return runTurn(lastRequest, lastRequest);
        case 'help':
          store.print(HELP_TEXT);
          return;
        case 'exit':
          app.unmount();
          return;
        case 'unknown':
          store.print(`  ${command.name}는 없는 명령이에요. /help로 명령을 볼 수 있어요.`);
          return;
      }
    }
    lastRequest = text;
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
        lastGuide = turn.outcome.guide.toMarkdown();
        lastAnswer = null;
      }
      if (turn.kind === 'answer') lastAnswer = turn.answer;
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
  if (restartAfterExit) return relaunch(spawn, process.execPath, process.execArgv, process.argv[1]!, withContinue(process.argv.slice(2)));
  process.stderr.write('\n  대화를 마쳤어요. 이어서 하려면 rauha -c\n');
  return 0;
}
