import { randomUUID } from 'node:crypto';
import { homedir, release } from 'node:os';
import { basename, join } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, screen, shell } from 'electron';
import { DefaultRuleSet, DefaultRulesDto, DomainError, discoverRepos, draftRule, FileRuleStore, PromptLibrary, readPlanUsage, RuleBook, RuleBookDto, type PlanUsage } from '@rauha/core';
import { JobRunner } from '@rauha/core/jobs';
import { boardView, jobView, IPC, type ApprovalChoice, type RepoRow, type SettingsPatch } from '../shared/ipc.js';
import { canWork, DEFAULT_SETTINGS, updateSettings, type Settings } from '../shared/settings.js';
import { SettingsStore } from './settings-store.js';
import { CommandStore } from './command-store.js';
import { applyTeamOp, TeamSettingsStore, teamView } from './team-settings-store.js';
import { TeamSettings } from '../shared/team-settings.js';
import { DefaultRulesStore, applyDefaultRuleOp } from './default-rules-store.js';
import { scanWorkFolder } from './workspace/scan.js';
import { addWorktree, cleanupLeftovers, finishWorktree } from './workspace/git-worktree.js';
import { WorktreeLedger } from './workspace/worktree-ledger.js';
import { dispatchGit } from './git/git-dispatch.js';
import { RepoGate } from './git/repo-gate.js';
import { reviewChanges } from './team/git-review.js';
import { Approvals } from './team/approvals.js';
import { answerFor, approvalView } from './team/approval-view.js';
import { accountNames, composeSession, profileResolver } from './team/compose.js';
import { fakeTeam } from './team/fake-team.js';
import { parseTarget, type TargetFolder } from './team/target.js';
import { teamWork } from './team/team-work.js';
import { appMenuTemplate, quitWhenAllClosed, windowChrome } from './platform/app-menu.js';
import { claudeBinaryPath, promptsDir as resolvePromptsDir, type ResourceEnv } from './platform/resources.js';
import { displayKey, parseWindowFile, restoreBounds, type Rect } from './platform/window-state.js';
import { adoptShellPath } from './platform/shell-path.js';
import { findTerminalRauha, removeTerminalRauha, type TerminalRauhaFile } from './platform/terminal-rauha.js';
import { AppVersion } from '../shared/app-update.js';
import { UpdateService, type FetchLike } from './update/update-service.js';
import { FileUpdateStore } from './update/update-store.js';
import { fakeReleases } from './update/fake-releases.js';
import { ClaudeLogin } from './auth/claude-login.js';
import { measureTyping } from './measure-typing.js';
import { DATA_IPC } from '../shared/data-api.js';
import { summarizeRequest } from '../shared/approval-summary.js';
import { TodoStore } from './data/todo-store.js';
import { TodoService } from './data/todo-service.js';
import { RecordStore } from './data/record-store.js';
import { RecordService } from './data/record-service.js';
import { decisionOf, JobTrail } from './team/job-trail.js';
import { newlyChanged, snapshotChanges } from './team/changed-files.js';
import { recordInputOf } from './team/record-input.js';

/** VS Code Dark Modern 바탕색. 창이 그려지기 전 번쩍이지 않게 같은 색으로 연다. */
const BACKGROUND = '#1f1f1f';

let window: BrowserWindow | null = null;
let plan: PlanUsage | null = null;
let limitNotified = false;

/** 사용자 규칙(규칙 탭). 팀원이 도구를 부를 때마다 이 값을 읽으므로 고치면 바로 반영된다. */
const ruleStore = new FileRuleStore(join(homedir(), '.rauha', 'desktop', 'rules.json'));
let ruleBook: RuleBook = RuleBook.empty();
const defaultRulesStore = new DefaultRulesStore(join(homedir(), '.rauha', 'desktop', 'default-rules.json'));
let defaultRules = DefaultRuleSet.initial();
const teamStore = new TeamSettingsStore(join(homedir(), '.rauha', 'desktop', 'team.json'));
/** 팀 설정(팀원별 켜기·모델·도구·지시). 작업을 시작할 때마다 최신 값을 읽어 다음 작업부터 반영된다. */
let team = TeamSettings.initial();
/** 엔진이 읽는 규칙: 내 규칙 + 켜 둔 기본 규칙 */
const effectiveRules = (): RuleBook => RuleBook.of([...ruleBook.rules, ...defaultRules.toRules()]);

/** 확인용: 실제 Claude를 부르지 않고 가짜 팀으로 돈다(RAUHA_FAKE_TEAM=1). */
const FAKE = process.env['RAUHA_FAKE_TEAM'] === '1';

const home = homedir();
/** 사용자 설정(작업 폴더·계정·알림·동시 실행 수 …). 시작할 때 파일에서 읽는다. */
const commandStore = new CommandStore(join(homedir(), '.rauha', 'desktop', 'commands.json'));
const settingsStore = new SettingsStore(join(homedir(), '.rauha', 'desktop', 'settings.json'));
let settings: Settings = DEFAULT_SETTINGS;

/** 작업 폴더: 환경 변수(확인용) → 설정에서 고른 폴더 → 실행한 폴더 */
const currentWorkDir = (): string => process.env['RAUHA_WORK_DIR'] ?? settings.workFolder ?? process.cwd();

/** 일을 맡길 수 있는 폴더들: 작업 폴더 안의 레포. 레포가 없으면 작업 폴더 하나. */
function folders(): TargetFolder[] {
  const roots = discoverRepos(currentWorkDir());
  const list = roots.length > 0 ? roots : [currentWorkDir()];
  return list.map((root) => ({ name: basename(root), root }));
}

/** 설치본(asar 밖 resources)과 개발 실행 양쪽에서 파일을 찾는 데 쓰는 환경 */
const resourceEnv = (): ResourceEnv => ({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, appPath: app.getAppPath(), exists: existsSync });

/** 프롬프트 폴더: 환경 변수 → 설치본 resources/prompts → 개발 저장소의 prompts/. */
const promptsDir = (): string => resolvePromptsDir(resourceEnv(), process.env['RAUHA_PROMPTS_DIR']);

/** Claude Code 실행 파일(SDK의 플랫폼 패키지). 설치본은 asar 밖에서 찾는다. */
const claudeExecutable = (): string | undefined => claudeBinaryPath(resourceEnv(), process.platform, process.arch) ?? undefined;

/** 같은 레포를 동시에 고치는 일이 서로의 변경을 망치지 않게 자리를 나눠 주는 장부(두 번째 작업부터 worktree) */
let ledger = WorktreeLedger.empty();
const worktreeRoot = (): string => join(app.getPath('userData'), 'worktrees');

/** 작업 id → 그 작업이 일하는 레포 폴더(허락 화면의 diff·영향을 그 레포에서 계산한다) */
const jobRoots = new Map<string, string>();

const approvals = new Approvals({
  newId: () => randomUUID(),
  now: () => new Date().toISOString(),
  onChange: (pending) => {
    window?.webContents.send(IPC.approvals, pending.map((p) => approvalView(p, settings.protectedBranches)));
  },
});

/** 허락이 새로 오면 Windows 알림으로도 알린다. 누르면 그 작업의 팀 상세(정리 보기)로 간다. */
function notifyApproval(jobId: string, headline: string): void {
  if (!settings.notify.choice || !Notification.isSupported() || window?.isFocused() === true) return;
  const n = new Notification({ title: '허락이 필요해요', body: headline });
  n.on('click', () => {
    window?.show();
    window?.focus();
    window?.webContents.send(IPC.openJob, jobId);
  });
  n.show();
}

/** 확인용: 진짜 팀을 조립만 해 본다(팀원을 부르지 않으니 한도를 쓰지 않는다). RAUHA_SMOKE_COMPOSE=1 */
async function smokeCompose(): Promise<void> {
  const sentence = process.env['RAUHA_SMOKE_DRAFT'];
  if (sentence !== undefined) {
    // 확인용: 규칙 말로 적기 정리를 한 번 돌려 본다(haiku 한 번)
    const profile = (await profileResolver(home, null))(currentWorkDir());
    console.log(JSON.stringify(await draftRule(sentence, { ...(process.env as Record<string, string>), ...profile.agentEnv(home) }, claudeExecutable())));
    app.quit();
    return;
  }
  const prompts = await PromptLibrary.load(promptsDir());
  const profileFor = await profileResolver(home, settings.account);
  const controller = new AbortController();
  const root = folders()[0]?.root ?? currentWorkDir();
  const session = composeSession(
    { home, prompts, profileFor, plan: () => null, claudeExecutable: claudeExecutable() },
    root,
    { progress: { step: () => undefined }, ask: async () => ({ kind: 'deny', note: null }), user: { interactive: false, choose: async () => 0, confirmFact: async () => ({ kind: 'unsure' }), pickPast: async () => null }, signal: controller.signal },
  );
  console.log(JSON.stringify({ composed: typeof session.handle, root, prompts: promptsDir() }));
  app.quit();
}

async function startRunner(): Promise<JobRunner> {
  let work;
  if (FAKE) {
    work = teamWork({ newSession: (io, job) => (jobRoots.set(job.id, folders()[0]?.root ?? currentWorkDir()), trail.repo(job.id, basename(folders()[0]?.root ?? currentWorkDir())), fakeTeam(io, job.request)), askUser: (jobId, request) => askWithNotice(jobId, request) });
  } else {
    const prompts = await PromptLibrary.load(promptsDir());
    const profileFor = await profileResolver(home, settings.account);
    work = teamWork({
      newSession: (io, job) => {
        const target = parseTarget(job.request, folders());
        const root = target.folder?.root ?? folders()[0]?.root ?? currentWorkDir();
        let note: string | null = null;
        return {
          note: () => note,
          handle: async (_input, depth) => {
            // 같은 레포에 두 번째로 오는 작업은 자기 worktree에서 일한다(첫 작업은 원래 폴더)
            const claim = ledger.claim(job.id, root, () => join(worktreeRoot(), `${basename(root)}-${job.id.slice(0, 8)}`));
            ledger = claim.ledger;
            const cwd = claim.place.kind === 'worktree' ? claim.place.path : root;
            jobRoots.set(job.id, cwd);
            trail.repo(job.id, basename(root));
            let before: Map<string, string> | null = null;
            try {
              if (claim.place.kind === 'worktree') await addWorktree(root, cwd);
              before = await snapshotChanges(cwd);
              const session = composeSession({ home, prompts, profileFor, plan: () => plan, claudeExecutable: claudeExecutable(), rules: effectiveRules, roleOverrides: () => team.overrides() }, cwd, io, root);
              return await session.handle(target.text, depth);
            } finally {
              // 바뀐 파일은 worktree를 정리(브랜치로 남김)하기 전에 읽는다. 알아내지 못하면 기록하지 않는다.
              const after = before === null ? null : await snapshotChanges(cwd);
              if (before !== null && after !== null) trail.files(job.id, newlyChanged(before, after));
              const released = ledger.release(job.id);
              ledger = released.ledger;
              if (released.worktree !== null) {
                const branch = await finishWorktree(root, released.worktree, job.id, job.request).catch(() => null);
                if (branch !== null) note = `같은 레포에서 다른 일이 함께 돌고 있어서 따로 작업했어요. 고친 내용은 브랜치 ${branch}에 있어요.`;
              }
            }
          },
        };
      },
      askUser: (jobId, request) => askWithNotice(jobId, request),
    });
    // 한도는 1분마다 읽어 둔다(새 작업을 시작할지 정하는 데 쓴다).
    const refresh = () => void readPlanUsage({ ...(process.env as Record<string, string>), ...profileFor(currentWorkDir()).agentEnv(home) }, undefined, claudeExecutable()).then((p) => {
      plan = p ?? plan;
      const pct = Math.max(plan?.session?.percent ?? 0, plan?.weekly?.percent ?? 0);
      if (pct >= 90 && !limitNotified && settings.notify.limit && Notification.isSupported()) {
        limitNotified = true;
        new Notification({ title: '한도가 90%에 닿았어요', body: '새 작업을 아껴 쓰는 게 좋아요.' }).show();
      }
      if (pct < 90) limitNotified = false;
    });
    refresh();
    setInterval(refresh, 60_000).unref();
  }
  const runner: JobRunner = JobRunner.start({
    work,
    limit: settings.concurrency,
    newId: () => randomUUID(),
    now: () => new Date().toISOString(),
    onChange: (board) => {
      window?.webContents.send(IPC.board, boardView(board));
      for (const job of board.jobs) {
        if (!job.isOver) continue;
        onJobOver(job);
        approvals.closeJob(job.id);
        if (job.status === 'done' && !doneNotified.has(job.id)) {
          doneNotified.add(job.id);
          notifyDone(job.id, job.request);
        }
      }
    },
  });
  return runner;
}

const doneNotified = new Set<string>();

/** 할 일·기록(앱 데이터 폴더의 JSON 파일). 기록은 이 PC에만 둔다. 확인용으로 RAUHA_DATA_DIR로 폴더를 바꿀 수 있다. */
const dataDir = process.env['RAUHA_DATA_DIR'] ?? join(homedir(), '.rauha', 'desktop');
const todoService = new TodoService({
  store: new TodoStore(join(dataDir, 'todos.json')),
  newId: () => randomUUID(),
  now: () => new Date().toISOString(),
  submit: (text) => submitJob(text),
  onChange: (list) => window?.webContents.send(DATA_IPC.todoChanged, list),
});
const recordService = new RecordService({
  store: new RecordStore(join(dataDir, 'records.json')),
  onChange: (book) => window?.webContents.send(DATA_IPC.recordsChanged, book),
});
/** 작업이 도는 동안 기록에 쓸 것(허락 결정·바뀐 파일·레포)을 모아 둔다 */
const trail = new JobTrail();
const recorded = new Set<string>();

/** 팀(메인)에 일을 넘긴다. 폴더를 고르고 허락하기 전에는 일을 받지 않는다(엉뚱한 폴더에서 일하지 않게). 확인용 환경 변수가 있으면 건너뛴다. */
function submitJob(text: string): { id: string } | null {
  const ready = process.env['RAUHA_WORK_DIR'] !== undefined || FAKE || canWork(settings);
  return runnerRef !== null && ready ? runnerRef.submit(text) : null;
}

/** 끝난 작업을 기록으로 옮기고, 맡겨 둔 할 일을 끝/멈춤으로 바꾼다. 같은 작업은 한 번만 처리한다. */
function onJobOver(job: Parameters<typeof jobView>[0]): void {
  if (recorded.has(job.id)) return;
  recorded.add(job.id);
  // 허락을 닫는 답(작업 정리로 인한 거절)이 모두 들어온 뒤에 모은 것을 꺼낸다
  setTimeout(() => {
    const input = recordInputOf(jobView(job), trail.take(job.id), new Date().toISOString());
    if (input !== null) void recordService.capture(input);
  }, 0);
  void todoService.jobFinished(job.id, job.status === 'done' ? 'done' : 'stopped');
}

/** 작업이 끝나면(창이 가려져 있을 때만) 알린다. 누르면 그 작업의 팀 상세로 간다. */
function notifyDone(jobId: string, request: string): void {
  if (!settings.notify.done || !Notification.isSupported() || window?.isFocused() === true) return;
  const n = new Notification({ title: '작업이 끝났어요', body: request.length > 60 ? `${request.slice(0, 59)}…` : request });
  n.on('click', () => {
    window?.show();
    window?.focus();
    window?.webContents.send(IPC.openJob, jobId);
  });
  n.show();
}

function askWithNotice(jobId: string, request: Parameters<Approvals['ask']>[1]) {
  const answered = approvals.ask(jobId, request);
  const pending = approvals.pending().find((p) => p.jobId === jobId && p.request === request);
  if (pending !== undefined) notifyApproval(jobId, approvalView(pending, settings.protectedBranches).summary.headline);
  void answered.then((answer) => {
    // 작업이 끝나서 닫힌 허락(자동 거절)은 사용자가 정한 결정이 아니라서 기록하지 않는다
    if (runnerRef?.board.find(jobId)?.isOver === true) return;
    const { decision, note } = decisionOf(answer);
    trail.approval(jobId, { tool: request.tool, headline: summarizeRequest(request, settings.protectedBranches).headline, reason: request.reason, decision, note, at: new Date().toISOString() });
  });
  return answered;
}

/** 창 위치·크기는 모니터 구성별로 기억한다(모니터를 뺐다 꽂아도 제자리로). 확인용 실행에서는 쓰지 않는다. */
const windowFile = join(homedir(), '.rauha', 'desktop', 'windows.json');
const remembers = (): boolean => process.env['RAUHA_SMOKE_SHOT'] === undefined && process.env['RAUHA_MEASURE_TYPING'] === undefined;
const workAreas = (): Rect[] => {
  const primary = screen.getPrimaryDisplay();
  return [primary, ...screen.getAllDisplays().filter((d) => d.id !== primary.id)].map((d) => d.workArea);
};
const screenKey = (): string => displayKey(screen.getAllDisplays().map((d) => d.bounds));
const readWindows = () => {
  try {
    return parseWindowFile(JSON.parse(readFileSync(windowFile, 'utf8')));
  } catch {
    return {};
  }
};

function open(runner: JobRunner): void {
  const placed = restoreBounds(remembers() ? (readWindows()[screenKey()] ?? null) : null, workAreas(), { width: 1280, height: 820 });
  window = new BrowserWindow({
    x: placed.x,
    y: placed.y,
    width: placed.width,
    height: placed.height,
    minWidth: 480,
    minHeight: 360,
    // 자동 확인 실행(스모크·측정)은 창을 화면에 띄우지 않는다: 사용자가 쓰는 모니터를 가리지 않게
    show: remembers(),
    backgroundColor: BACKGROUND,
    title: 'Rauha',
    icon: join(app.getAppPath(), 'build', 'icon.png'),
    ...windowChrome(process.platform, release()),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (placed.maximized) window.maximize();
  if (remembers()) {
    let timer: NodeJS.Timeout | undefined;
    const save = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (window === null || window.isMinimized() || window.isFullScreen()) return;
        try {
          const all = { ...readWindows(), [screenKey()]: { ...window.getNormalBounds(), maximized: window.isMaximized() } };
          mkdirSync(dirname(windowFile), { recursive: true });
          writeFileSync(windowFile, JSON.stringify(all, null, 2));
        } catch {
          /* 기억 못 해도 창은 그대로 쓴다 */
        }
      }, 500);
    };
    window.on('resize', save);
    window.on('move', save);
  }
  window.on('closed', () => (window = null));
  // 전체 화면에서는 맥 신호등이 사라지므로 화면의 제목줄도 접는다
  window.on('enter-full-screen', () => window?.webContents.send(IPC.fullScreen, true));
  window.on('leave-full-screen', () => window?.webContents.send(IPC.fullScreen, false));
  const fakePlatform = process.env['RAUHA_SMOKE_SHOT'] !== undefined ? process.env['RAUHA_SMOKE_PLATFORM'] : undefined;
  void window.loadFile(join(__dirname, 'renderer', 'index.html'), fakePlatform === undefined ? undefined : { query: { platform: fakePlatform } });
  const shot = process.env['RAUHA_SMOKE_SHOT'];
  if (shot !== undefined) window.webContents.once('did-finish-load', () => void smoke(runner, shot));
  const typing = process.env['RAUHA_MEASURE_TYPING'];
  if (typing !== undefined)
    window.webContents.once('did-finish-load', () =>
      void measureTyping(window!, typing, () => ['결제 타임아웃 원인 찾아줘', '온보딩 시안 3개', '주간보고 초안', 'VPC 피어링 정리 문서', '정산 배치 알림'].forEach((t) => runner.submit(t))).then(() => app.quit()),
    );
}

/** 확인용: 일 5개(하나는 허락 요청)를 연달아 넣고 화면을 찍은 뒤 끝낸다(RAUHA_SMOKE_SHOT=찍을 png 경로). */
async function smoke(runner: JobRunner, path: string): Promise<void> {
  const { writeFileSync } = await import('node:fs');
  const only = process.env['RAUHA_SMOKE_REQUEST'];
  for (const text of only !== undefined ? [only] : ['결제 타임아웃 원인 찾아줘', '온보딩 시안 3개', '주간보고 허락 초안', 'VPC 피어링 정리 문서', '정산 배치 알림']) runner.submit(text);
  await new Promise((r) => setTimeout(r, Number(process.env['RAUHA_SMOKE_WAIT'] ?? '4300')));
  const width = Number(process.env['RAUHA_SMOKE_WIDTH'] ?? '0');
  if (width > 0) {
    window?.setSize(width, Number(process.env['RAUHA_SMOKE_HEIGHT'] ?? '640'));
    await new Promise((r) => setTimeout(r, 500));
  }
  const click = process.env['RAUHA_SMOKE_CLICK'];
  if (click !== undefined) {
    // 여러 번 누르려면 ;; 로 이어 쓴다(예: 첫 실행 확인 창을 닫고 탭을 연다)
    for (const selector of click.split(';;')) {
      await window!.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)})?.click()`);
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  // 확인용: 입력창에 글을 쳐 넣는다(예: /re 를 쳐서 명령 자동완성을 본다)
  const type = process.env['RAUHA_SMOKE_TYPE'];
  if (type !== undefined) {
    await window!.webContents.executeJavaScript(`(() => { const i = document.querySelector('.composer textarea'); i.value = ${JSON.stringify(type)}; i.dispatchEvent(new Event('input')); i.focus(); })()`);
    await new Promise((r) => setTimeout(r, 300));
  }
  const image = await window!.webContents.capturePage();
  writeFileSync(path, image.toPNG());
  console.log(JSON.stringify(boardView(runner.board).jobs.map((j) => [j.status, j.role, j.lastLine, j.stopReason, j.result?.slice(0, 200)])));
  app.quit();
}

let runnerRef: JobRunner | null = null;

const UPDATE_FIRST_MS = 5_000;
const UPDATE_EVERY_MS = 6 * 60 * 60 * 1000;

/** 새 버전 알림: 시작 5초 뒤 한 번, 이후 6시간마다 확인한다. 자동 설치는 없다(내려받기는 브라우저로). */
function startUpdates(): void {
  if (process.env['RAUHA_SMOKE_COMPOSE'] === '1' || process.env['RAUHA_MEASURE_TYPING'] !== undefined) return;
  const current = AppVersion.parse(app.getVersion());
  if (current === null) return;
  const fakeUpdate = process.env['RAUHA_FAKE_UPDATE'] === '1';
  const fake: FetchLike = async () => ({ ok: true, json: async () => fakeReleases() });
  const service = new UpdateService({
    fetch: fakeUpdate ? fake : (url, init) => fetch(url, init),
    // 확인용 가짜 응답은 진짜 기록 파일을 건드리지 않는다
    store: fakeUpdate ? { load: async () => null, save: async () => undefined } : new FileUpdateStore(join(app.getPath('userData'), 'update.json')),
    current,
    platform: process.platform,
    arch: process.arch,
    now: () => new Date(),
    enabled: () => settings.autoUpdateCheck,
    openExternal: (url) => shell.openExternal(url),
    onChange: (view) => window?.webContents.send(IPC.updateState, view),
  });
  ipcMain.handle(IPC.updateState, () => service.view());
  ipcMain.handle(IPC.updateCheck, () => service.check());
  ipcMain.handle(IPC.updateDownload, () => service.download());
  ipcMain.handle(IPC.updateDismiss, () => service.dismiss());
  void service.init().then(() => {
    setTimeout(() => void service.autoCheck(), UPDATE_FIRST_MS);
    setInterval(() => void service.autoCheck(), UPDATE_EVERY_MS);
  });
}

/** 앱 안 Claude 로그인: 앱에 들어 있는 실행 파일을 지금 계정의 설정 폴더로 돌린다. 확인용 가짜 팀 실행에서만 실행 파일을 바꿀 수 있다. */
function startAuth(): void {
  const login = new ClaudeLogin({
    executable: () => (FAKE ? process.env['RAUHA_CLAUDE_EXECUTABLE'] : undefined) ?? claudeExecutable(),
    env: async () => {
      const profile = (await profileResolver(home, settings.account))(currentWorkDir());
      const agentEnv = profile.agentEnv(home);
      const dir = agentEnv['CLAUDE_CONFIG_DIR'];
      if (dir !== undefined) mkdirSync(dir, { recursive: true });
      return { ...process.env, ...agentEnv };
    },
    openExternal: (url) => shell.openExternal(url),
    onChange: (view) => window?.webContents.send(IPC.authState, view),
  });
  ipcMain.handle(IPC.authStatus, () => login.status());
  ipcMain.handle(IPC.authLogin, () => {
    void login.start();
    return login.view();
  });
  ipcMain.on(IPC.authCancel, () => login.cancel());
}

function installMenu(): void {
  const template = appMenuTemplate(process.platform, 'Rauha', () => window?.webContents.send(IPC.openTab, 'settings'));
  Menu.setApplicationMenu(template === null ? null : Menu.buildFromTemplate(template));
}

void app.whenReady().then(async () => {
  // Finder·Dock으로 연 앱은 셸 PATH를 못 받는다. 로그인 셸에서 읽어 합친다(Windows는 그대로).
  await adoptShellPath();
  installMenu();
  if (process.env['RAUHA_SMOKE_COMPOSE'] === '1') return smokeCompose();
  // 앱이 꺼지면서 정리하지 못한 worktree를 치운다(바뀐 내용은 작업 브랜치로 남긴다)
  await cleanupLeftovers(worktreeRoot()).catch(() => 0);
  settings = await settingsStore.load();
  ruleBook = await ruleStore.load().catch(() => RuleBook.empty());
  defaultRules = await defaultRulesStore.load();
  team = await teamStore.load();
  await todoService.releaseOrphans(new Set());
  const runner = await startRunner();
  ipcMain.handle(IPC.settingsGet, () => (process.env['RAUHA_WORK_DIR'] !== undefined ? { ...settings, workFolder: currentWorkDir(), folderApproved: true, firstRunDone: true } : settings));
  ipcMain.handle(IPC.settingsUpdate, async (_e, patch: unknown) => {
    settings = updateSettings(settings, (typeof patch === 'object' && patch !== null ? patch : {}) as SettingsPatch);
    await settingsStore.save(settings);
    return settings;
  });
  ipcMain.handle(IPC.usageGet, () => (plan === null ? null : { session: plan.session, weekly: plan.weekly }));
  ipcMain.handle(IPC.accountsList, async () => {
    // 설정 파일이 깨졌어도 설정 화면은 열려야 한다(계정 목록만 비운다).
    const names = await accountNames(home).catch(() => []);
    return { names, selected: settings.account };
  });
  ipcMain.handle(IPC.folderPick, async () => {
    const result = await dialog.showOpenDialog(window ?? undefined!, { properties: ['openDirectory', 'createDirectory'], title: '작업 폴더 고르기' });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle(IPC.reposList, async (): Promise<RepoRow[]> => {
    const entries = await scanWorkFolder(currentWorkDir());
    const working = (root: string) => runner.board.jobs.filter((j) => !j.isOver && (jobRoots.get(j.id) === root || ledger.repoOf(j.id) === root)).length;
    return entries.map((e) => ({ name: e.name, root: e.root, relative: e.relative, kind: e.kind, status: e.status, working: working(e.root), worktrees: ledger.worktreeJobs(e.root) }));
  });
  // git 탭: 앱이 작업 폴더에서 찾은 레포의 루트에서만 git을 돌린다
  const gitGate = new RepoGate(async () => (await scanWorkFolder(currentWorkDir())).filter((e) => e.kind === 'repo').map((e) => e.root));
  ipcMain.handle(IPC.gitCall, (_e, fn: unknown, root: unknown, arg: unknown) =>
    dispatchGit({ gate: gitGate, protectedBranches: () => settings.protectedBranches, openExternal: (url) => shell.openExternal(url) }, fn, root, arg),
  );
  ipcMain.handle(IPC.commandsGet, () => commandStore.load());
  ipcMain.handle(DATA_IPC.todoGet, () => todoService.get());
  ipcMain.handle(DATA_IPC.todoApply, (_e, op: unknown) => todoService.apply(op));
  ipcMain.handle(DATA_IPC.recordsGet, () => recordService.get());
  ipcMain.handle(DATA_IPC.recordsApply, (_e, op: unknown) => recordService.apply(op));
  ipcMain.handle(IPC.commandsSave, (_e, book: unknown) => commandStore.save(book));
  ipcMain.handle(IPC.teamGet, () => teamView(team));
  ipcMain.handle(IPC.teamApply, async (_e, op: unknown) => {
    const res = applyTeamOp(team, op);
    if (!res.ok) return res;
    team = res.settings;
    await teamStore.save(team);
    return { ok: true, view: res.view };
  });
  ipcMain.handle(IPC.defaultRulesList, () => DefaultRulesDto.view(defaultRules));
  ipcMain.handle(IPC.defaultRulesApply, async (_e, op: unknown) => {
    const res = applyDefaultRuleOp(defaultRules, op);
    if (!res.ok) return res;
    defaultRules = res.set;
    await defaultRulesStore.save(defaultRules);
    return { ok: true, rules: DefaultRulesDto.view(defaultRules) };
  });
  const rulesView = () => RuleBookDto.fromEntity(ruleBook).toJSON().rules;
  ipcMain.handle(IPC.rulesList, rulesView);
  ipcMain.handle(IPC.rulesDraft, async (_e, sentence: unknown) => {
    if (typeof sentence !== 'string' || sentence.trim() === '') return { ok: false, error: '규칙을 말로 적어 주세요.' };
    try {
      const profile = (await profileResolver(home, settings.account))(currentWorkDir());
      const draft = await draftRule(sentence.trim().slice(0, 500), { ...(process.env as Record<string, string>), ...profile.agentEnv(home) }, claudeExecutable());
      // 폴더 이름만 말했으면 작업 폴더 안의 그 폴더 경로로 바꾼다(규칙은 경로로 범위를 가른다)
      const named = draft.scope === 'folder' && draft.path !== null ? folders().find((f) => f.name.toLowerCase() === draft.path!.toLowerCase()) : undefined;
      const scope = draft.scope === 'workspace' ? { kind: 'workspace' as const, path: currentWorkDir() } : draft.scope === 'folder' ? { kind: 'folder' as const, path: named?.root ?? draft.path ?? '' } : { kind: 'global' as const };
      return { ok: true, draft: { text: draft.text, bucket: draft.bucket, scope, tools: draft.tools, includes: draft.includes } };
    } catch (error) {
      return { ok: false, error: error instanceof DomainError ? error.message : '규칙을 정리하지 못했어요. 로그인이나 한도를 확인해 주세요.' };
    }
  });
  ipcMain.handle(IPC.rulesAdd, async (_e, rule: unknown) => {
    try {
      const next = RuleBookDto.from({ rules: [...rulesView(), rule] }).toEntity();
      await ruleStore.save(next);
      ruleBook = next;
      return { ok: true, rules: rulesView() };
    } catch (error) {
      return { ok: false, error: error instanceof DomainError ? error.message : '규칙을 저장하지 못했어요.' };
    }
  });
  ipcMain.handle(IPC.rulesRemove, async (_e, id: unknown) => {
    if (typeof id === 'string') {
      ruleBook = ruleBook.remove(id);
      await ruleStore.save(ruleBook);
    }
    return rulesView();
  });
  runnerRef = runner;
  let terminalFound: TerminalRauhaFile[] = [];
  ipcMain.handle(IPC.terminalFind, async () => {
    terminalFound = await findTerminalRauha({ platform: process.platform, home, pathEnv: process.env['PATH'] ?? '' });
    return terminalFound.map((f) => ({ path: f.path, entry: f.entry }));
  });
  // 방금 찾아서 보여 준 파일 중 사용자가 확인한 것만 지운다(화면이 보낸 임의 경로는 지우지 않는다).
  ipcMain.handle(IPC.terminalRemove, (_e, paths: unknown) => {
    const wanted = Array.isArray(paths) ? paths.filter((p): p is string => typeof p === 'string') : [];
    return removeTerminalRauha(terminalFound.filter((f) => wanted.includes(f.path)));
  });
  ipcMain.handle(IPC.submit, (_e, text: unknown) => {
    // 폴더를 고르고 허락하기 전에는 일을 받지 않는다(엉뚱한 폴더에서 일하지 않게). 확인용 환경 변수가 있으면 건너뛴다.
    const job = typeof text === 'string' ? submitJob(text) : null;
    return job === null ? null : boardView(runner.board).jobs.find((j) => j.id === job.id) ?? null;
  });
  ipcMain.handle(IPC.deeper, (_e, id: unknown) => {
    const done = typeof id === 'string' ? runner.board.find(id) : null;
    if (done === null || !done.resultMeta.canGoDeeper) return null;
    const next = runner.submit(done.request, { deep: true });
    if (next === null) return null;
    const root = jobRoots.get(done.id);
    if (root !== undefined) jobRoots.set(next.id, root);
    return boardView(runner.board).jobs.find((j) => j.id === next.id) ?? null;
  });
  ipcMain.on(IPC.stop, (_e, id: unknown) => {
    if (typeof id !== 'string') return;
    runner.stop(id);
    approvals.closeJob(id);
  });
  ipcMain.handle(IPC.boardNow, () => boardView(runner.board));
  ipcMain.handle(IPC.approvalReview, async (_e, id: unknown) => {
    const pending = approvals.pending().find((p) => p.id === id);
    const root = pending === undefined ? undefined : jobRoots.get(pending.jobId);
    if (pending === undefined || root === undefined) return null;
    const summary = approvalView(pending, settings.protectedBranches).summary;
    return reviewChanges(root, settings.protectedBranches, summary.protectedBranch);
  });
  ipcMain.handle(IPC.approvalsNow, () => approvals.pending().map((p) => approvalView(p, settings.protectedBranches)));
  ipcMain.on(IPC.approvalAnswer, (_e, id: unknown, choice: unknown) => {
    if (typeof id === 'string' && typeof choice === 'object' && choice !== null && 'kind' in choice) approvals.answer(id, answerFor(choice as ApprovalChoice));
  });
  startAuth();
  startUpdates();
  open(runner);
});
app.on('window-all-closed', () => {
  if (quitWhenAllClosed(process.platform)) app.quit();
});
// macOS: Dock 아이콘을 눌렀을 때 창이 없으면 다시 연다.
app.on('activate', () => {
  if (window === null && runnerRef !== null) open(runnerRef);
});
