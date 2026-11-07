import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { existsSync } from 'node:fs';
import { app, BrowserWindow, ipcMain, Menu, Notification } from 'electron';
import { discoverRepos, PromptLibrary, readPlanUsage, type PlanUsage } from '@rauha/core';
import { JobRunner } from '@rauha/core/jobs';
import { boardView, IPC, type ApprovalChoice } from '../shared/ipc.js';
import { reviewChanges } from './team/git-review.js';
import { DEFAULT_PROTECTED_BRANCHES } from '../shared/approval-summary.js';
import { Approvals } from './team/approvals.js';
import { answerFor, approvalView } from './team/approval-view.js';
import { composeSession, profileResolver } from './team/compose.js';
import { fakeTeam } from './team/fake-team.js';
import { parseTarget, type TargetFolder } from './team/target.js';
import { teamWork } from './team/team-work.js';
import { appMenuTemplate, quitWhenAllClosed, windowChrome } from './platform/app-menu.js';
import { claudeBinaryPath, promptsDir as resolvePromptsDir, type ResourceEnv } from './platform/resources.js';
import { adoptShellPath } from './platform/shell-path.js';
import { findTerminalRauha, removeTerminalRauha, type TerminalRauhaFile } from './platform/terminal-rauha.js';
import { measureTyping } from './measure-typing.js';

/** VS Code Dark Modern 바탕색. 창이 그려지기 전 번쩍이지 않게 같은 색으로 연다. */
const BACKGROUND = '#1f1f1f';

let window: BrowserWindow | null = null;
let plan: PlanUsage | null = null;

/** 확인용: 실제 Claude를 부르지 않고 가짜 팀으로 돈다(RAUHA_FAKE_TEAM=1). */
const FAKE = process.env['RAUHA_FAKE_TEAM'] === '1';

const home = homedir();
const workDir = process.env['RAUHA_WORK_DIR'] ?? process.cwd();

/** 일을 맡길 수 있는 폴더들: 작업 폴더 안의 레포. 레포가 없으면 작업 폴더 하나. */
function folders(): TargetFolder[] {
  const roots = discoverRepos(workDir);
  const list = roots.length > 0 ? roots : [workDir];
  return list.map((root) => ({ name: basename(root), root }));
}

/** 설치본(asar 밖 resources)과 개발 실행 양쪽에서 파일을 찾는 데 쓰는 환경 */
const resourceEnv = (): ResourceEnv => ({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, appPath: app.getAppPath(), exists: existsSync });

/** 프롬프트 폴더: 환경 변수 → 설치본 resources/prompts → 개발 저장소의 prompts/. */
const promptsDir = (): string => resolvePromptsDir(resourceEnv(), process.env['RAUHA_PROMPTS_DIR']);

/** Claude Code 실행 파일(SDK의 플랫폼 패키지). 설치본은 asar 밖에서 찾는다. */
const claudeExecutable = (): string | undefined => claudeBinaryPath(resourceEnv(), process.platform, process.arch) ?? undefined;

/** 작업 id → 그 작업이 일하는 레포 폴더(허락 화면의 diff·영향을 그 레포에서 계산한다) */
const jobRoots = new Map<string, string>();

const approvals = new Approvals({
  newId: () => randomUUID(),
  now: () => new Date().toISOString(),
  onChange: (pending) => {
    window?.webContents.send(IPC.approvals, pending.map((p) => approvalView(p)));
  },
});

/** 허락이 새로 오면 Windows 알림으로도 알린다. 누르면 그 작업의 팀 상세(정리 보기)로 간다. */
function notifyApproval(jobId: string, headline: string): void {
  if (!Notification.isSupported() || window?.isFocused() === true) return;
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
  const prompts = await PromptLibrary.load(promptsDir());
  const profileFor = await profileResolver(home);
  const controller = new AbortController();
  const root = folders()[0]?.root ?? workDir;
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
    work = teamWork({ newSession: (io, job) => (jobRoots.set(job.id, folders()[0]?.root ?? workDir), fakeTeam(io, job.request)), askUser: (jobId, request) => askWithNotice(jobId, request) });
  } else {
    const prompts = await PromptLibrary.load(promptsDir());
    const profileFor = await profileResolver(home);
    work = teamWork({
      newSession: (io, job) => {
        const target = parseTarget(job.request, folders());
        const root = target.folder?.root ?? folders()[0]?.root ?? workDir;
        jobRoots.set(job.id, root);
        const session = composeSession({ home, prompts, profileFor, plan: () => plan, claudeExecutable: claudeExecutable() }, root, io);
        return { handle: () => session.handle(target.text) };
      },
      askUser: (jobId, request) => askWithNotice(jobId, request),
    });
    // 한도는 1분마다 읽어 둔다(새 작업을 시작할지 정하는 데 쓴다).
    const refresh = () => void readPlanUsage({ ...(process.env as Record<string, string>), ...profileFor(workDir).agentEnv(home) }, undefined, claudeExecutable()).then((p) => (plan = p ?? plan));
    refresh();
    setInterval(refresh, 60_000).unref();
  }
  const runner: JobRunner = JobRunner.start({
    work,
    newId: () => randomUUID(),
    now: () => new Date().toISOString(),
    onChange: (board) => {
      window?.webContents.send(IPC.board, boardView(board));
      for (const job of board.jobs) if (job.isOver) approvals.closeJob(job.id);
    },
  });
  return runner;
}

function askWithNotice(jobId: string, request: Parameters<Approvals['ask']>[1]) {
  const answered = approvals.ask(jobId, request);
  const pending = approvals.pending().find((p) => p.jobId === jobId && p.request === request);
  if (pending !== undefined) notifyApproval(jobId, approvalView(pending).summary.headline);
  return answered;
}

function open(runner: JobRunner): void {
  window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 480,
    minHeight: 360,
    backgroundColor: BACKGROUND,
    title: 'rauha',
    icon: join(app.getAppPath(), 'build', 'icon.png'),
    ...windowChrome(process.platform),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.on('closed', () => (window = null));
  void window.loadFile(join(__dirname, 'renderer', 'index.html'));
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
    await window!.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(click)})?.click()`);
    await new Promise((r) => setTimeout(r, 500));
  }
  const image = await window!.webContents.capturePage();
  writeFileSync(path, image.toPNG());
  console.log(JSON.stringify(boardView(runner.board).jobs.map((j) => [j.status, j.role, j.lastLine, j.stopReason, j.result?.slice(0, 200)])));
  app.quit();
}

let runnerRef: JobRunner | null = null;

function installMenu(): void {
  const template = appMenuTemplate(process.platform, 'rauha', () => window?.webContents.send(IPC.openTab, 'settings'));
  Menu.setApplicationMenu(template === null ? null : Menu.buildFromTemplate(template));
}

void app.whenReady().then(async () => {
  // Finder·Dock으로 연 앱은 셸 PATH를 못 받는다. 로그인 셸에서 읽어 합친다(Windows는 그대로).
  await adoptShellPath();
  installMenu();
  if (process.env['RAUHA_SMOKE_COMPOSE'] === '1') return smokeCompose();
  const runner = await startRunner();
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
    const job = typeof text === 'string' ? runner.submit(text) : null;
    return job === null ? null : boardView(runner.board).jobs.find((j) => j.id === job.id) ?? null;
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
    const summary = approvalView(pending).summary;
    return reviewChanges(root, DEFAULT_PROTECTED_BRANCHES, summary.protectedBranch);
  });
  ipcMain.handle(IPC.approvalsNow, () => approvals.pending().map((p) => approvalView(p)));
  ipcMain.on(IPC.approvalAnswer, (_e, id: unknown, choice: unknown) => {
    if (typeof id === 'string' && typeof choice === 'object' && choice !== null && 'kind' in choice) approvals.answer(id, answerFor(choice as ApprovalChoice));
  });
  open(runner);
});
app.on('window-all-closed', () => {
  if (quitWhenAllClosed(process.platform)) app.quit();
});
// macOS: Dock 아이콘을 눌렀을 때 창이 없으면 다시 연다.
app.on('activate', () => {
  if (window === null && runnerRef !== null) open(runnerRef);
});
