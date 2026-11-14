import { randomUUID } from 'node:crypto';
import { cpus, homedir, release, userInfo } from 'node:os';
import { basename, join, resolve as resolvePath } from 'node:path';
import { CLAUDE_HISTORY_IPC } from '../shared/claude-history-ipc.js';
import { ClaudeHistoryService } from './history/claude-history-service.js';
import { accessSync, constants as fsConstants, existsSync, readdirSync, statSync } from 'node:fs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, Notification, safeStorage, screen, shell, type IpcMainInvokeEvent } from 'electron';
import { DefaultRuleSet, DefaultRulesDto, DomainError, discoverRepos, draftBlog, draftRule, FileRuleStore, loadSecretPolicy, PromptLibrary, readPlanUsage, RuleBook, RuleBookDto, type PlanUsage } from '@rauha/core';
import { JobRunner } from '@rauha/core/jobs';
import { replaceRule, ruleSizeError, type RuleView } from '../shared/rules-form.js';
import { boardView, jobView, IPC, type ApprovalChoice, type DiagnosticsResult, type RepoRow, type SettingsPatch } from '../shared/ipc.js';
import { canWork, DEFAULT_SETTINGS, forgetRecentFolder, updateSettings, type Settings } from '../shared/settings.js';
import { SettingsStore } from './settings-store.js';
import { CommandStore } from './command-store.js';
import { applyTeamOp, TeamSettingsStore, teamView } from './team-settings-store.js';
import { TeamSettings } from '../shared/team-settings.js';
import { DefaultRulesStore, applyDefaultRuleOp } from './default-rules-store.js';
import { scanWorkFolder } from './workspace/scan.js';
import { addWorktree, cleanupLeftovers, finishWorktree, initRepo, insideRepo } from './workspace/git-worktree.js';
import { carryFiles } from './workspace/carry-files.js';
import { ConversationResetDto, type ConversationResetResult } from '../shared/conversation-reset.js';
import { RepoConversations } from './team/repo-conversations.js';
import { WorktreeLedger } from './workspace/worktree-ledger.js';
import { dispatchGit } from './git/git-dispatch.js';
import { ghCliToken, GithubActionsClient } from './github/actions-client.js';
import { CHECKPOINT_IPC } from '../shared/checkpoint-api.js';
import { dispatchCheckpoint } from './team/checkpoint-dispatch.js';
import { RepoGate } from './git/repo-gate.js';
import { reviewChanges } from './team/git-review.js';
import { Approvals } from './team/approvals.js';
import { answerFor, approvalView } from './team/approval-view.js';
import { accountNames, composeSession, profileResolver } from './team/compose.js';
import { fakeTeam } from './team/fake-team.js';
import { parseTarget, type TargetFolder } from './team/target.js';
import { resolveMentions } from './team/mention-context.js';
import { AttachmentStore, type StagedImages } from './team/attachment-store.js';
import { ImageUploadDto } from '../shared/image-attach.js';
import { withAttachments } from '../shared/file-mention.js';
import type { CodeFiles } from './code/code-files.js';
import { teamWork, type TeamIo, type TeamSession } from './team/team-work.js';
import { appMenuTemplate, quitWhenAllClosed, windowChrome } from './platform/app-menu.js';
import { claudeBinaryPath, fallbackWorkDir, promptsDir as resolvePromptsDir, type ResourceEnv } from './platform/resources.js';
import { displayKey, parseWindowFile, isAutomatedRun, placeOnDisplay, restoreBounds, testDisplay, type Rect } from './platform/window-state.js';
import { adoptShellPath } from './platform/shell-path.js';
import { findTerminalRauha, removeTerminalRauha, type TerminalRauhaFile } from './platform/terminal-rauha.js';
import { AppVersion } from '../shared/app-update.js';
import { UpdateService, type FetchLike } from './update/update-service.js';
import { FileUpdateStore } from './update/update-store.js';
import { fakeInstaller, fakeReleases } from './update/fake-releases.js';
import { canWriteDir, FileAttemptStore } from './update/update-files.js';
import { createInstaller } from './update/installer.js';
import { ClaudeLogin } from './auth/claude-login.js';
import { AppLog } from './diagnostics/app-log.js';
import { collectSnapshot } from './diagnostics/collect.js';
import { startupFailure } from './diagnostics/startup-failure.js';
import { startsAsNewProject, workFolderProblem } from '../shared/work-folder.js';
import { DiagnosticReport, Redactor } from '../shared/diagnostics.js';
import type { AccountCheck } from '../shared/account-state.js';
import type { UpdateView } from '../shared/update-record.js';
import { UsageService } from './usage/usage-service.js';
import { registerUsageIpc, toUsageView } from './usage/usage-ipc.js';
import { USAGE_IPC } from '../shared/usage-api.js';
import { READ_EVERY_MS } from '../shared/usage-freshness.js';
import { measureTyping } from './measure-typing.js';
import { DATA_IPC } from '../shared/data-api.js';
import { registerWorkbench } from './workbench-ipc.js';
import { registerApiIpc } from './api/api-ipc.js';
import { FAKE_TEST_MODEL } from './api/api-test-fake.js';
import { planTestCases, suggestFixes } from './api/api-test-model.js';
import { registerDockerIpc } from './docker/docker-ipc.js';
import { registerDbIpc } from './db/db-ipc.js';
import type { DbService } from './db/db-service.js';
import { linkRepoDatabase } from './db/team-db.js';
import { registerBlogIpc } from './blog/blog-ipc.js';
import { registerConnectorIpc } from './connectors/connector-ipc.js';
import type { ConnectorService } from './connectors/connector-service.js';
import { registerPluginIpc } from './plugins/plugin-ipc.js';
import type { PluginService } from './plugins/plugin-service.js';
import { summarizeRequest } from '../shared/approval-summary.js';
import { TodoStore } from './data/todo-store.js';
import { TodoService } from './data/todo-service.js';
import { RecordStore } from './data/record-store.js';
import { ChatHistoryStore } from './data/chat-history-store.js';
import { ChatHistoryKeeper } from './team/chat-history-keeper.js';
import { CheckpointStore } from './data/checkpoint-store.js';
import { CheckpointKeeper } from './team/checkpoint-keeper.js';
import { RecordService } from './data/record-service.js';
import { decisionOf, JobTrail } from './team/job-trail.js';
import { askCardFlow } from './team/ask-flow.js';
import { newlyChanged, snapshotChanges } from './team/changed-files.js';
import { recordInputOf } from './team/record-input.js';
import { externalUrlOf, isAppPage } from '../shared/navigation-guard.js';
import { guardIpcMain, isTrustedSender } from './ipc-guard.js';

/** VS Code Dark Modern 바탕색. 창이 그려지기 전 번쩍이지 않게 같은 색으로 연다. */
const BACKGROUND = '#1f1f1f';

/** 기본 브라우저로는 https 주소만 연다(다른 방식·사용자 정보가 든 주소는 조용히 버린다). */
const openSafe = async (url: string): Promise<void> => {
  // 열 때는 사용자가 넘긴 글이 아니라 파싱해서 다듬은 주소를 쓴다
  const safe = externalUrlOf(url);
  if (safe !== null) await shell.openExternal(safe);
};

let window: BrowserWindow | null = null;

// 모든 IPC(handle·on)는 우리 창의 최상위 앱 화면에서 온 것만 받는다. 이 아래에서 등록하는 채널(다른 파일이 ipcMain 을 받아 등록하는 것 포함)이 모두 해당된다.
guardIpcMain(ipcMain, (event) => {
  const e = event as IpcMainInvokeEvent;
  const frame = e.senderFrame ?? null;
  return isTrustedSender({ fromWindow: window !== null && e.sender === window.webContents, frameUrl: frame?.url, isTopFrame: frame !== null && frame.parent === null }, window?.webContents.getURL() ?? '');
});
// 이 앱이 만드는 모든 화면(webContents)에서: 웹뷰 붙이기와 서버 리다이렉트로 옮겨 가는 것을 막는다
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.on('will-redirect', (event, url) => {
    if (!isAppPage(url, contents.getURL())) {
      event.preventDefault();
      void openSafe(url).catch(() => undefined);
    }
  });
});
let limitNotified = false;

/** 앱 오류 로그: 처리 안 된 오류와 화면(renderer)의 콘솔 error를 가려서 최근 200줄 + userData/logs/app.log에 쌓는다. 진단 정보 복사가 쓴다. */
const userName = (): string => {
  try {
    return userInfo().username;
  } catch {
    return basename(homedir());
  }
};
const appLog = new AppLog({ dir: join(app.getPath('userData'), 'logs'), now: () => new Date(), redactor: Redactor.of(homedir(), userName()) });
const errorText = (error: unknown): string => (error instanceof Error ? (error.stack ?? error.message) : String(error));
// uncaughtExceptionMonitor는 지켜보기만 해서 Electron의 기본 오류 창 동작을 바꾸지 않는다
process.on('uncaughtExceptionMonitor', (error) => appLog.record('main', errorText(error)));
process.on('unhandledRejection', (reason) => {
  appLog.record('main', `처리 안 된 Promise 거절: ${errorText(reason)}`);
  console.error(reason);
});

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

/** 작업 폴더: 환경 변수(확인용) → 설정에서 고른 폴더 → (개발) 실행한 폴더 / (설치본) 빈 폴더 */
const currentWorkDir = (): string => process.env['RAUHA_WORK_DIR'] ?? settings.workFolder ?? fallbackWorkDir({ packaged: app.isPackaged, userDataPath: app.getPath('userData'), cwd: process.cwd() });

/** 확인용 실행(RAUHA_FAKE_TEAM)에서 모델 대신 돌려주는 블로그 초안 */
const FAKE_BLOG_DRAFT = (tone: string): string => `# 가짜 초안\n\n(${tone}) 모델을 부르지 않고 만든 글이에요.`;

/** 폴더가 지금 있는지(지워지거나 옮겨졌을 수 있다) */
function folderFacts(path: string): { exists: boolean; isDirectory: boolean } {
  try {
    return { exists: true, isDirectory: statSync(path).isDirectory() };
  } catch {
    return { exists: false, isDirectory: false };
  }
}

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

/** 구독 한도를 읽는 유일한 곳(상태 줄·설정·새 작업 판단이 같은 값을 받는다). 확인용 가짜 팀 실행에서는 읽지 않는다. */
const usage = new UsageService({
  read: async () => {
    if (FAKE) return null;
    const profile = (await profileResolver(home, settings.account))(currentWorkDir());
    return readPlanUsage({ ...(process.env as Record<string, string>), ...profile.agentEnv(home) }, undefined, claudeExecutable());
  },
  now: () => Date.now(),
  onChange: (snap) => {
    window?.webContents.send(USAGE_IPC.changed, toUsageView(snap));
    const pct = Math.max(snap.plan?.session?.percent ?? 0, snap.plan?.weekly?.percent ?? 0);
    if (pct >= 90 && !limitNotified && settings.notify.limit && Notification.isSupported()) {
      limitNotified = true;
      new Notification({ title: '한도가 90%에 닿았어요', body: '새 작업을 아껴 쓰는 게 좋아요.' }).show();
    }
    if (pct < 90) limitNotified = false;
  },
});

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
function notifyApproval(jobId: string, headline: string, title = '허락이 필요해요'): void {
  if (!settings.notify.choice || !Notification.isSupported() || window?.isFocused() === true) return;
  const n = new Notification({ title, body: headline });
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

/** 레포의 앞 대화가 가리키는 파일(원래 폴더에 커밋 안 한 채 있는 것)을 새 worktree로 복사한다. 원래 폴더는 건드리지 않는다. */
async function carryPreviousFiles(root: string, worktree: string): Promise<void> {
  const profile = (await profileResolver(home, settings.account))(root);
  const conversation = await RepoConversations.under(profile.sessionsDir(home)).open(root);
  const paths = (conversation.base?.carried ?? []).map(([path]) => path);
  if (paths.length > 0) await carryFiles(root, worktree, paths, loadSecretPolicy(root));
}

/** 코드 탭과 같은 파일 읽기 길(작업 폴더 밖·비밀 파일·링크 검사 포함). 채팅의 @파일 언급을 읽을 때 쓴다. */
let codeFiles: CodeFiles | null = null;

/** 확인용 가짜 팀 세션: 진짜와 같은 체크포인트 기록을 남긴다(RAUHA_FAKE_EDIT=1 이면 가짜 팀이 작업 폴더 파일을 바꾼다) */
function fakeSession(io: TeamIo, jobId: string, request: string): TeamSession {
  const root = folders()[0]?.root ?? currentWorkDir();
  jobRoots.set(jobId, root);
  trail.repo(jobId, basename(root));
  const inner = fakeTeam(io, request, root);
  return {
    handle: async (input, depth) => {
      await checkpoints.begin(jobId, { repoRoot: root, cwd: root, place: 'repo' });
      try {
        return await inner.handle(input, depth);
      } finally {
        await checkpoints.finishInPlace(jobId);
      }
    },
  };
}

async function startRunner(): Promise<JobRunner> {
  let work;
  if (FAKE) {
    work = teamWork({ newSession: (io, job) => fakeSession(io, job.id, job.request), askUser: (jobId, request) => askWithNotice(jobId, request), askCard: (jobId, payload, signal) => askCard(jobId, payload, signal) });
  } else {
    const prompts = await PromptLibrary.load(promptsDir());
    const profileFor = await profileResolver(home, settings.account);
    work = teamWork({
      newSession: (io, job) => {
        const all = folders();
        const target = parseTarget(job.request, all);
        const root = target.folder?.root ?? all[0]?.root ?? currentWorkDir();
        let note: string | null = null;
        const fallbacks = new Set<string>();
        return {
          note: () => [...fallbacks, ...(note === null ? [] : [note])].join('\n') || null,
          handle: async (_input, depth) => {
            const problem = workFolderProblem(root, folderFacts(root));
            if (problem !== null) throw new Error(problem);
            // 빈 폴더에서 "만들어 줘"로 시작하면 git 저장소로 시작해 준다(사용자 파일이 있는 폴더는 건드리지 않는다)
            if (startsAsNewProject({ ...folderFacts(root), insideRepo: await insideRepo(root), entries: readdirSync(root) })) await initRepo(root).catch(() => undefined);
            // 같은 레포에 두 번째로 오는 작업은 자기 worktree에서 일한다(첫 작업은 원래 폴더)
            const claim = ledger.claim(job.id, root, () => join(worktreeRoot(), `${basename(root)}-${job.id.slice(0, 8)}`));
            ledger = claim.ledger;
            const cwd = claim.place.kind === 'worktree' ? claim.place.path : root;
            jobRoots.set(job.id, cwd);
            trail.repo(job.id, basename(root));
            let before: Map<string, string> | null = null;
            try {
              if (claim.place.kind === 'worktree') {
                await addWorktree(root, cwd);
                // worktree는 HEAD에서 만들어져 앞 업무가 남긴 커밋 안 한 파일이 없다 → 앞 대화가 가리키는 파일만(비밀·링크 제외) 복사해 이어 일하게 한다
                await carryPreviousFiles(root, cwd).catch(() => undefined);
              }
              before = await snapshotChanges(cwd);
              // 되돌리기·변경 보기를 위한 기준(HEAD·시작 때 파일 상태). worktree 작업은 그 브랜치가 체크포인트다.
              await checkpoints.begin(job.id, { repoRoot: root, cwd, place: claim.place.kind === 'worktree' ? 'worktree' : 'repo' });
              // 채팅에 붙인 이미지: 팀원은 이 임시 폴더만 읽을 수 있고(Read), 요청 앞에 그 경로를 적어 준다
              const staged = jobImages.get(job.id);
              const session = composeSession({ home, prompts, profileFor, plan: () => usage.current().plan, claudeExecutable: claudeExecutable(), rules: effectiveRules, roleOverrides: () => team.overrides(), analysis: () => settings.analysisFlow, models: () => settings.models, onFallback: (line) => fallbacks.add(line), readRoots: staged === undefined ? [] : [staged.dir], connectors: () => connectorService?.servers() ?? { servers: {}, tools: [], names: [] }, plugins: () => pluginService?.loads() ?? [], database: (repo) => (dbService === null ? Promise.resolve(null) : linkRepoDatabase(repo, dbService)) }, cwd, io, root, { workspaceRoot: currentWorkDir(), repos: all, also: target.also });
              const mentioned = codeFiles === null ? [] : await resolveMentions(target.text, codeFiles);
              return await session.handle(withAttachments(mentioned, staged?.paths ?? [], target.text), depth);
            } finally {
              // 바뀐 파일은 worktree를 정리(브랜치로 남김)하기 전에 읽는다. 알아내지 못하면 기록하지 않는다.
              const after = before === null ? null : await snapshotChanges(cwd);
              if (before !== null && after !== null) trail.files(job.id, newlyChanged(before, after));
              await checkpoints.finishInPlace(job.id);
              const released = ledger.release(job.id);
              ledger = released.ledger;
              if (released.worktree !== null) {
                const branch = await finishWorktree(root, released.worktree, job.id, job.request).catch(() => null);
                await checkpoints.finishBranch(job.id, branch);
                if (branch !== null) note = `같은 레포에서 다른 일이 함께 돌고 있어서 따로 작업했어요. 고친 내용은 브랜치 ${branch}에 있어요.`;
              }
            }
          },
        };
      },
      askUser: (jobId, request) => askWithNotice(jobId, request),
      askCard: (jobId, payload, signal) => askCard(jobId, payload, signal),
    });
    // 한도는 평소 25초마다, 설정을 열 때·창에 초점이 올 때·일이 끝날 때 읽는다(읽는 곳은 usage 하나).
    void usage.refresh('interval');
    setInterval(() => void usage.refresh('interval'), READ_EVERY_MS).unref();
  }
  const runner: JobRunner = JobRunner.start({
    work,
    limit: settings.concurrency,
    newId: () => randomUUID(),
    now: () => new Date().toISOString(),
    onChange: (board) => {
      const view = boardView(board);
      window?.webContents.send(IPC.board, view);
      void chatHistoryReady.then(() => chatHistory.observe(view.jobs));
      for (const job of board.jobs) {
        if (!job.isOver) continue;
        onJobOver(job);
        approvals.closeJob(job.id);
        if (!usageOverSeen.has(job.id)) {
          usageOverSeen.add(job.id);
          void usage.refresh('job-over');
        }
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
const usageOverSeen = new Set<string>();

/** 할 일·기록(앱 데이터 폴더의 JSON 파일). 기록은 이 PC에만 둔다. 확인용으로 RAUHA_DATA_DIR로 폴더를 바꿀 수 있다. */
const dataDir = process.env['RAUHA_DATA_DIR'] ?? join(homedir(), '.rauha', 'desktop');
/** 설정 → 커넥터(노션·컨플루언스 …). 앱이 뜬 뒤 등록된다. */
let connectorService: ConnectorService | null = null;
/** 설정 → 플러그인·스킬. 앱이 뜬 뒤 등록된다. */
let pluginService: PluginService | null = null;
/** DB 탭의 저장한 연결. 팀원 DB 도구가 레포에 맞는 연결을 여기서 찾는다. 앱이 뜬 뒤 등록된다. */
let dbService: DbService | null = null;
/** 채팅에 붙인 이미지의 임시 자리(앱 데이터 폴더). 작업 폴더·저장소에는 두지 않고, 일이 끝나면 지운다. */
const attachments = new AttachmentStore(join(dataDir, 'attachments'));
const jobImages = new Map<string, StagedImages>();
const todoService = new TodoService({
  store: new TodoStore(join(dataDir, 'todos.json')),
  newId: () => randomUUID(),
  now: () => new Date().toISOString(),
  submit: (text) => submitJob(text),
  onChange: (list) => window?.webContents.send(DATA_IPC.todoChanged, list),
});
/** 채팅 말풍선 기록: 앱을 다시 켜도 끝난 일의 요청·결과가 말풍선으로 돌아온다. 대화 초기화·/clear 때 비운다. */
const chatHistory = new ChatHistoryKeeper(new ChatHistoryStore(join(dataDir, 'chat-history.json')));
const chatHistoryReady = chatHistory.load().catch(() => undefined);
const recordService = new RecordService({
  store: new RecordStore(join(dataDir, 'records.json')),
  onChange: (book) => window?.webContents.send(DATA_IPC.recordsChanged, book),
});
/** 작업이 도는 동안 기록에 쓸 것(허락 결정·바뀐 파일·레포)을 모아 둔다 */
const trail = new JobTrail();
/** 작업 체크포인트(시작 기준·변경 목록)와 되돌리기 안전 백업: 앱 데이터 폴더 */
const checkpoints = new CheckpointKeeper({
  store: new CheckpointStore(dataDir),
  secretOf: (root) => {
    const policy = loadSecretPolicy(root);
    return (rel) => policy.isSecret(rel);
  },
  protectedBranches: () => settings.protectedBranches,
  newId: () => randomUUID(),
  now: () => new Date().toISOString(),
});
const checkpointsReady = checkpoints.load().catch(() => undefined);
const recorded = new Set<string>();
/** 분석의 질문 카드(방향 고르기·계획 승인): 허락 창구에 올리고, 고른 방향을 기록거리로 남긴다 */
const askCard = askCardFlow({
  approvals,
  trail,
  notify: (jobId, headline) => notifyApproval(jobId, headline, '내 선택이 필요해요'),
  isOver: (jobId) => runnerRef?.board.find(jobId)?.isOver === true,
});

/** 팀(메인)에 일을 넘긴다. 폴더를 고르고 허락하기 전에는 일을 받지 않는다(엉뚱한 폴더에서 일하지 않게). 확인용 환경 변수가 있으면 건너뛴다. */
const submitReady = (): boolean => runnerRef !== null && (process.env['RAUHA_WORK_DIR'] !== undefined || FAKE || canWork(settings));
function submitJob(text: string): { id: string } | null {
  return submitReady() ? runnerRef!.submit(text) : null;
}

/** 끝난 작업을 기록으로 옮기고, 맡겨 둔 할 일을 끝/멈춤으로 바꾼다. 같은 작업은 한 번만 처리한다. */
function onJobOver(job: Parameters<typeof jobView>[0]): void {
  if (recorded.has(job.id)) return;
  recorded.add(job.id);
  const staged = jobImages.get(job.id);
  if (staged !== undefined) {
    jobImages.delete(job.id);
    void attachments.cleanup(staged.dir).catch(() => undefined);
  }
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
  // 확인용: RAUHA_DISPLAY=2 처럼 정하면 창을 그 모니터(1이 주 모니터)에 띄운다. 쓰는 모니터를 가리지 않고 눈으로 따라가 볼 때 쓴다.
  // 시험 실행(RAUHA_ 환경 변수가 있는 실행)은 정하지 않아도 2번 모니터에 띄우고, 2번이 없으면 창을 아예 보이지 않는다(1번 모니터를 가리지 않게).
  const auto = isAutomatedRun(process.env);
  const forced = placeOnDisplay(testDisplay(process.env), workAreas(), { width: 1280, height: 820 });
  const placed = forced ?? restoreBounds(remembers() ? (readWindows()[screenKey()] ?? null) : null, workAreas(), { width: 1280, height: 820 });
  window = new BrowserWindow({
    x: placed.x,
    y: placed.y,
    width: placed.width,
    height: placed.height,
    minWidth: 480,
    minHeight: 360,
    // 자동 확인 실행(스모크·측정)은 창을 화면에 띄우지 않는다: 사용자가 쓰는 모니터를 가리지 않게
    show: remembers() && (!auto || forced !== null),
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
      // 자동 확인 실행은 창이 숨겨져 있어도 화면이 계속 그려지게 한다
      backgroundThrottling: remembers(),
    },
  });
  if (placed.maximized) window.maximize();
  // 화면은 앱 안 파일 하나뿐이다. 새 창은 만들지 않고, 다른 곳으로 옮겨 가는 것도 막는다(https 주소는 기본 브라우저로).
  window.webContents.setWindowOpenHandler(({ url }) => {
    void openSafe(url).catch(() => undefined);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAppPage(url, window?.webContents.getURL() ?? '')) {
      event.preventDefault();
      void openSafe(url).catch(() => undefined);
    }
  });
  window.webContents.session.setPermissionRequestHandler((_wc, _permission, done) => done(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  if (remembers() && !auto) {
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
  window.webContents.on('console-message', (details) => {
    if (details.level === 'error') appLog.record('renderer', `${details.message} (${basename(details.sourceId)}:${details.lineNumber})`);
  });
  window.webContents.on('render-process-gone', (_event, details) => appLog.record('renderer', `화면 프로세스가 끝났어요: ${details.reason} (코드 ${details.exitCode})`));
  window.webContents.on('did-fail-load', (_event, code, description, url) => appLog.record('renderer', `화면을 못 불러왔어요: ${description} (${code}) ${basename(url)}`));
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

let authCheck: (() => Promise<AccountCheck>) | null = null;
let updateView: (() => UpdateView) | null = null;

/** 진단 정보 복사: 상태를 모아 가린 마크다운을 클립보드에 넣는다. 확인용 실행(창 숨김)에서는 사용자의 클립보드를 건드리지 않는다. */
async function copyDiagnostics(): Promise<DiagnosticsResult> {
  try {
    const work = process.env['RAUHA_WORK_DIR'] ?? settings.workFolder ?? null;
    const executable = (path: string): boolean => {
      try {
        accessSync(path, fsConstants.X_OK);
        return true;
      } catch {
        return false;
      }
    };
    const win = window;
    const bounds = win?.getBounds();
    const chrome = windowChrome(process.platform, release());
    const snapshot = await collectSnapshot({
      now: () => new Date(),
      app: { version: app.getVersion(), packaged: app.isPackaged },
      os: { platform: process.platform, version: process.getSystemVersion(), arch: process.arch, chip: cpus()[0]?.model.trim() ?? null },
      runtime: { electron: process.versions.electron ?? '', node: process.versions.node, chrome: process.versions.chrome ?? '' },
      workFolder: work,
      fs: { exists: existsSync, executable },
      repoCount: async () => (work === null ? null : (await scanWorkFolder(work)).filter((e) => e.kind === 'repo').length),
      claudePath: claudeExecutable(),
      auth: () => (authCheck === null ? Promise.reject(new Error('로그인 확인이 아직 준비되지 않았어요')) : authCheck()),
      pathEnv: process.env['PATH'] ?? '',
      env: process.env,
      tools: ['git', 'aws', 'gh', 'node'],
      usage: () => {
        const health = usage.health();
        return { readAt: health.readAt, failure: health.failure };
      },
      update: () => updateView?.() ?? null,
      logs: () => appLog.lines(),
      window: () => (bounds === undefined ? null : { width: bounds.width, height: bounds.height, displays: screen.getAllDisplays().length }),
      mac: () => (process.platform === 'darwin' && win != null ? { titleBarStyle: chrome.titleBarStyle ?? 'default', trafficLight: chrome.trafficLightPosition ?? null, fullScreen: win.isFullScreen() } : null),
    });
    const markdown = DiagnosticReport.of(snapshot, Redactor.of(home, userName())).toMarkdown();
    const copied = remembers();
    if (copied) clipboard.writeText(markdown);
    return { ok: true, copied, lines: markdown.split('\n').length, markdown };
  } catch (error) {
    appLog.record('main', `진단 정보를 만들지 못했어요: ${errorText(error)}`);
    return { ok: false, error: '진단 정보를 만들지 못했어요.' };
  }
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
  // 확인용: 화면에서 식을 돌려 결과를 글로 찍는다(클릭 뒤 화면은 숨김 창에서 그려지지 않으니 글자로 확인한다). 예: 버튼 누른 뒤 안내 글
  const evaluate = process.env['RAUHA_SMOKE_EVAL'];
  if (evaluate !== undefined) {
    const waitMs = Number(process.env['RAUHA_SMOKE_EVAL_WAIT'] ?? '1500');
    await new Promise((r) => setTimeout(r, waitMs));
    console.log('EVAL', JSON.stringify(await window!.webContents.executeJavaScript(evaluate)));
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
  const attempts = new FileAttemptStore(join(app.getPath('userData'), 'update-attempt.json'), join(app.getPath('userData'), 'update-swap.result'));
  const service = new UpdateService({
    fetch: fakeUpdate ? fake : (url, init) => fetch(url, init),
    // 확인용 가짜 응답은 진짜 기록 파일을 건드리지 않는다
    store: fakeUpdate ? { load: async () => null, save: async () => undefined } : new FileUpdateStore(join(app.getPath('userData'), 'update.json')),
    current,
    platform: process.platform,
    arch: process.arch,
    now: () => new Date(),
    enabled: () => settings.autoUpdateCheck,
    openExternal: (url) => openSafe(url),
    onChange: (view) => window?.webContents.send(IPC.updateState, view),
    attempts,
    // 앱 안 설치는 설치본에서만(개발 실행은 앱 파일이 electron이라 덮어쓰면 안 된다). 확인용 가짜 응답일 때도 막는다.
    ...(app.isPackaged && !fakeUpdate && (process.platform === 'win32' || process.platform === 'darwin')
      ? {
          installer: createInstaller({
            platform: process.platform,
            execPath: process.execPath,
            pid: process.pid,
            tempDir: app.getPath('temp'),
            home: homedir(),
            canWrite: canWriteDir,
            logPath: join(app.getPath('userData'), 'logs', 'update-swap.log'),
            resultPath: join(app.getPath('userData'), 'update-swap.result'),
            attempts,
            now: () => new Date(),
            fetch: (url, signal) => fetch(url, { signal }),
            // 앱이 안 닫히면 설치 스크립트가 60초 기다리다 실패하니, 10초 안에 안 닫히면 강제로 끝낸다
            quit: () => {
              app.quit();
              setTimeout(() => app.exit(0), 10_000);
            },
          }),
        }
      : fakeUpdate && process.env['RAUHA_FAKE_INSTALL'] === '1'
        ? { installer: fakeInstaller(process.env['RAUHA_FAKE_INSTALL_FAIL'] === '1', Number(process.env['RAUHA_FAKE_INSTALL_STEP_MS'] ?? '400')) }
        : {}),
  });
  updateView = () => service.view();
  ipcMain.handle(IPC.updateState, () => service.view());
  ipcMain.handle(IPC.updateCheck, () => service.check());
  ipcMain.handle(IPC.updateDownload, () => service.download());
  ipcMain.handle(IPC.updateDismiss, () => service.dismiss());
  ipcMain.handle(IPC.updateInstall, () => service.installNow());
  ipcMain.handle(IPC.updateCancel, () => service.cancel());
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
    openExternal: (url) => openSafe(url),
    onChange: (view) => window?.webContents.send(IPC.authState, view),
  });
  authCheck = () => login.check();
  ipcMain.handle(IPC.authStatus, () => login.check());
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

/** 시작 중 하나라도 던지면 창이 안 뜬 채 조용히 꺼진 것처럼 보인다. 로그에 남기고 오류 창으로 알린 뒤 끝낸다. */
function reportStartupFailure(error: unknown): void {
  appLog.record('main', `시작하다 멈춤: ${errorText(error)}`);
  const failure = startupFailure(error, join(app.getPath('userData'), 'logs', 'app.log'));
  dialog.showErrorBox(failure.title, failure.body);
  app.exit(1);
}

void app.whenReady().then(async () => {
  // 꺼지다 남은 이미지 임시 폴더를 치운다
  void attachments.sweep();
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
  ipcMain.handle(IPC.usageGet, () => {
    const p = usage.current().plan;
    return p === null ? null : { session: p.session, weekly: p.weekly };
  });
  ipcMain.handle(IPC.conversationReset, async (_e, input: unknown): Promise<ConversationResetResult> => {
    try {
      const roots = ConversationResetDto.from(input).targets(folders().map((f) => f.root));
      const profileFor = await profileResolver(home, settings.account);
      for (const root of roots) await RepoConversations.under(profileFor(root).sessionsDir(home)).clear(root);
      await chatHistory.clear(runner.board.jobs.map((j) => j.id));
      return { ok: true, cleared: roots.length };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : '대화를 비우지 못했어요.' };
    }
  });
  ipcMain.handle(IPC.chatHistoryNow, async () => {
    await chatHistoryReady;
    return chatHistory.restored();
  });
  ipcMain.handle(IPC.chatHistoryClear, () => chatHistory.clear(runner.board.jobs.map((j) => j.id)));
  registerUsageIpc(ipcMain, usage);
  ipcMain.handle(IPC.accountsList, async () => {
    // 설정 파일이 깨졌어도 설정 화면은 열려야 한다(계정 목록만 비운다).
    const names = await accountNames(home).catch(() => []);
    return { names, selected: settings.account };
  });
  ipcMain.handle(IPC.folderPick, async () => {
    const result = await dialog.showOpenDialog(window ?? undefined!, { properties: ['openDirectory', 'createDirectory'], title: '작업 폴더 고르기' });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  // 최근 폴더: 설정에 저장된 경로만 확인하고(화면이 준 경로는 보지 않는다), 목록에서 빼는 일만 한다
  ipcMain.handle(IPC.recentFoldersCheck, () => Object.fromEntries(settings.recentFolders.map((p) => { const f = folderFacts(p); return [p, f.exists && f.isDirectory]; })));
  ipcMain.handle(IPC.recentFoldersForget, async (_e, path: unknown) => {
    if (typeof path !== 'string') return settings;
    settings = forgetRecentFolder(settings, path);
    await settingsStore.save(settings);
    return settings;
  });
  ipcMain.handle(IPC.reposList, async (): Promise<RepoRow[]> => {
    const entries = await scanWorkFolder(currentWorkDir());
    const working = (root: string) => runner.board.jobs.filter((j) => !j.isOver && (jobRoots.get(j.id) === root || ledger.repoOf(j.id) === root)).length;
    return entries.map((e) => ({ name: e.name, root: e.root, relative: e.relative, kind: e.kind, status: e.status, working: working(e.root), worktrees: ledger.worktreeJobs(e.root) }));
  });
  // git 탭: 앱이 작업 폴더에서 찾은 레포의 루트에서만 git을 돌린다
  const gitGate = new RepoGate(async () => (await scanWorkFolder(currentWorkDir())).filter((e) => e.kind === 'repo').map((e) => e.root));
  // GitHub Actions 보기(읽기 전용). 토큰은 GitHub CLI 로그인이 있을 때만 main 안에서 쓴다.
  const githubActions = GithubActionsClient.create({ fetch: (u, i) => fetch(u, i), ghToken: ghCliToken, userAgent: `rauha/${app.getVersion()}` });
  ipcMain.handle(IPC.gitCall, (_e, fn: unknown, root: unknown, arg: unknown) =>
    dispatchGit({ gate: gitGate, protectedBranches: () => settings.protectedBranches, openExternal: (url) => openSafe(url), actions: githubActions }, fn, root, arg),
  );
  ipcMain.handle(CHECKPOINT_IPC.call, async (_e, fn: unknown, arg: unknown) => {
    await checkpointsReady;
    return dispatchCheckpoint(checkpoints, fn, arg);
  });
  ipcMain.handle(IPC.commandsGet, () => commandStore.load());
  ipcMain.handle(DATA_IPC.todoGet, () => todoService.get());
  ipcMain.handle(DATA_IPC.todoApply, (_e, op: unknown) => todoService.apply(op));
  ipcMain.handle(DATA_IPC.recordsGet, () => recordService.get());
  ipcMain.handle(DATA_IPC.recordsApply, (_e, op: unknown) => recordService.apply(op));
  registerBlogIpc(ipcMain, {
    folderNames: () => folders().map((f) => f.name),
    companyNames: () => settings.blogNames,
    draft: async (note, tone) => {
      // 확인용 실행(RAUHA_FAKE_TEAM)에서는 모델을 부르지 않는다
      if (process.env['RAUHA_FAKE_TEAM'] !== undefined) return FAKE_BLOG_DRAFT(tone);
      const profile = (await profileResolver(home, settings.account))(currentWorkDir());
      return draftBlog(note, tone, { ...(process.env as Record<string, string>), ...profile.agentEnv(home) }, claudeExecutable(), undefined, undefined, settings.models.haiku);
    },
    pickPath: async (fileName) => {
      const result = await dialog.showSaveDialog(window ?? undefined!, { title: '블로그 글 저장', defaultPath: join(app.getPath('documents'), fileName), filters: [{ name: 'Markdown', extensions: ['md'] }], properties: ['createDirectory', 'showOverwriteConfirmation'] });
      return result.canceled || !result.filePath ? null : result.filePath;
    },
  });
  codeFiles = registerWorkbench(ipcMain, { workFolder: () => process.env['RAUHA_WORK_DIR'] ?? settings.workFolder ?? null, send: (channel, event) => window?.webContents.send(channel, event), onQuit: (cleanup) => app.on('before-quit', cleanup), trash: (abs) => shell.trashItem(abs), reveal: (abs) => shell.showItemInFolder(abs) });
  registerDockerIpc(ipcMain, { workDir: () => process.env['RAUHA_WORK_DIR'] ?? settings.workFolder ?? null, send: (channel, event) => window?.webContents.send(channel, event), onQuit: (cleanup) => app.on('before-quit', cleanup) });
  dbService = registerDbIpc(ipcMain, {
    dataDir,
    safeStorage,
    onQuit: (cleanup) => app.on('before-quit', cleanup),
    pickFile: async () => {
      const startIn = process.env['RAUHA_WORK_DIR'] ?? settings.workFolder ?? app.getPath('documents');
      const result = await dialog.showOpenDialog(window ?? undefined!, { title: 'Open a SQLite file', defaultPath: startIn, properties: ['openFile'], filters: [{ name: 'SQLite database', extensions: ['db', 'sqlite', 'sqlite3', 'db3', 's3db', 'sl3'] }, { name: 'All files', extensions: ['*'] }] });
      return result.canceled || result.filePaths[0] === undefined ? null : result.filePaths[0];
    },
    saveCsv: async (fileName, text) => {
      const startIn = process.env['RAUHA_WORK_DIR'] ?? settings.workFolder ?? app.getPath('documents');
      const result = await dialog.showSaveDialog(window ?? undefined!, { title: 'Save CSV', defaultPath: join(startIn, fileName), filters: [{ name: 'CSV', extensions: ['csv'] }], properties: ['createDirectory', 'showOverwriteConfirmation'] });
      if (result.canceled || !result.filePath) return null;
      writeFileSync(result.filePath, text, 'utf8');
      return result.filePath;
    },
  });
  // 커넥터·플러그인은 지금 계정의 Claude Code 설정 폴더(CLAUDE_CONFIG_DIR)에서 Claude Code 가 직접 다룬다(토큰은 rauha 가 읽지 않는다)
  const accountEnv = async (): Promise<Record<string, string>> => {
    const profile = (await profileResolver(home, settings.account))(currentWorkDir());
    const agentEnv = profile.agentEnv(home);
    if (agentEnv['CLAUDE_CONFIG_DIR'] !== undefined) mkdirSync(agentEnv['CLAUDE_CONFIG_DIR'], { recursive: true });
    return { ...(process.env as Record<string, string>), ...agentEnv };
  };
  // Claude 대화 내역: 기본 ~/.claude 와 지금 rauha 계정의 설정 폴더(다르면 둘 다). 대화 파일(projects/*/*.jsonl)만 읽는다
  const history = new ClaudeHistoryService({
    roots: async () => {
      const base = process.env['CLAUDE_CONFIG_DIR'] ?? join(homedir(), '.claude');
      const account = (await accountEnv())['CLAUDE_CONFIG_DIR'];
      const out = [{ dir: base, label: base === join(homedir(), '.claude') ? '~/.claude' : base }];
      if (account !== undefined && resolvePath(account).toLowerCase() !== resolvePath(base).toLowerCase()) out.push({ dir: account, label: `rauha account (${basename(account)})` });
      return out;
    },
  });
  ipcMain.handle(CLAUDE_HISTORY_IPC.list, () => history.list());
  ipcMain.handle(CLAUDE_HISTORY_IPC.open, (_e, id: unknown) => history.open(id));
  connectorService = registerConnectorIpc(ipcMain, {
    file: join(dataDir, 'connectors.json'),
    env: accountEnv,
    executable: () => claudeExecutable(),
    openExternal: (url) => openSafe(url),
    send: (channel, view) => window?.webContents.send(channel, view),
  });
  pluginService = registerPluginIpc(ipcMain, { env: accountEnv, executable: () => claudeExecutable(), trash: (path) => shell.trashItem(path) });
  registerApiIpc(ipcMain, {
    dataDir,
    // 문서 폴더는 빼고, 작업 폴더에서 찾은 레포·폴더만(API 탭은 이 경로만 읽는다)
    listProjects: async () => (await scanWorkFolder(currentWorkDir())).filter((e) => e.kind !== 'docs').map((e) => ({ root: e.root, name: e.name, relative: e.relative })),
    saveFile: async (fileName, text) => {
      const startIn = process.env['RAUHA_WORK_DIR'] ?? settings.workFolder ?? app.getPath('documents');
      const result = await dialog.showSaveDialog(window ?? undefined!, { title: 'Save requests', defaultPath: join(startIn, fileName), filters: [{ name: 'HTTP requests', extensions: ['http', 'sh'] }], properties: ['createDirectory', 'showOverwriteConfirmation'] });
      if (result.canceled || !result.filePath) return null;
      writeFileSync(result.filePath, text, 'utf8');
      return result.filePath;
    },
    // AI API 시험: 케이스 만들기·수정 제안은 sonnet 단발 호출(도구 없음). 확인용 실행에서는 모델을 부르지 않는다
    testModel: FAKE
      ? FAKE_TEST_MODEL
      : {
          plan: async (prompt) => planTestCases(prompt, { model: settings.models.sonnet, env: await accountEnv(), claudeExecutable: claudeExecutable() }),
          fixes: async (prompt) => suggestFixes(prompt, { model: settings.models.sonnet, env: await accountEnv(), claudeExecutable: claudeExecutable() }),
        },
    saveReport: async (fileName, text) => {
      const startIn = process.env['RAUHA_WORK_DIR'] ?? settings.workFolder ?? app.getPath('documents');
      const result = await dialog.showSaveDialog(window ?? undefined!, { title: 'Save test report', defaultPath: join(startIn, fileName), filters: [{ name: 'Markdown', extensions: ['md'] }], properties: ['createDirectory', 'showOverwriteConfirmation'] });
      if (result.canceled || !result.filePath) return null;
      writeFileSync(result.filePath, text, 'utf8');
      return result.filePath;
    },
    saveBytes: async (fileName, bytes) => {
      const result = await dialog.showSaveDialog(window ?? undefined!, { title: 'Save response', defaultPath: join(app.getPath('downloads'), fileName), properties: ['createDirectory', 'showOverwriteConfirmation'] });
      if (result.canceled || !result.filePath) return null;
      writeFileSync(result.filePath, bytes);
      return result.filePath;
    },
    pickFile: async () => {
      const result = await dialog.showOpenDialog(window ?? undefined!, { title: 'Attach a file', properties: ['openFile'] });
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
    userAgent: `rauha/${app.getVersion()}`,
  });
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
      const draft = await draftRule(sentence.trim().slice(0, 500), { ...(process.env as Record<string, string>), ...profile.agentEnv(home) }, claudeExecutable(), undefined, settings.models.haiku);
      // 폴더 이름만 말했으면 작업 폴더 안의 그 폴더 경로로 바꾼다(규칙은 경로로 범위를 가른다)
      const named = draft.scope === 'folder' && draft.path !== null ? folders().find((f) => f.name.toLowerCase() === draft.path!.toLowerCase()) : undefined;
      const scope = draft.scope === 'workspace' ? { kind: 'workspace' as const, path: currentWorkDir() } : draft.scope === 'folder' ? { kind: 'folder' as const, path: named?.root ?? draft.path ?? '' } : { kind: 'global' as const };
      return { ok: true, draft: { text: draft.text, bucket: draft.bucket, scope, tools: draft.tools, includes: draft.includes } };
    } catch (error) {
      return { ok: false, error: error instanceof DomainError ? error.message : '규칙을 정리하지 못했어요. 로그인이나 한도를 확인해 주세요.' };
    }
  });
  ipcMain.handle(IPC.rulesAdd, async (_e, rule: unknown) => {
    const tooBig = ruleSizeError(rule);
    if (tooBig !== null) return { ok: false, error: tooBig };
    try {
      const next = RuleBookDto.from({ rules: [...rulesView(), rule] }).toEntity();
      await ruleStore.save(next);
      ruleBook = next;
      return { ok: true, rules: rulesView() };
    } catch (error) {
      return { ok: false, error: error instanceof DomainError ? error.message : '규칙을 저장하지 못했어요.' };
    }
  });
  ipcMain.handle(IPC.rulesUpdate, async (_e, rule: unknown) => {
    const tooBig = ruleSizeError(rule);
    if (tooBig !== null) return { ok: false, error: tooBig };
    try {
      const id = (rule as { id?: unknown } | null)?.id;
      const replaced = typeof id === 'string' ? replaceRule(rulesView(), rule as RuleView) : null;
      if (replaced === null) return { ok: false, error: '고치려던 규칙이 없어요. 지웠거나 이미 바뀌었어요.' };
      const next = RuleBookDto.from({ rules: replaced }).toEntity();
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
  ipcMain.handle(IPC.submit, async (_e, text: unknown, images: unknown) => {
    // 이미지는 main이 다시 검사한다(형식·장수·크기). 하나라도 이상하면 일을 받지 않는다.
    const uploads = ImageUploadDto.from(images);
    if (typeof text !== 'string' || uploads === null) return null;
    // 폴더를 고르고 허락하기 전에는 일을 받지 않는다(엉뚱한 폴더에서 일하지 않게). 확인용 환경 변수가 있으면 건너뛴다.
    const staged = uploads.length === 0 || !submitReady() ? null : await attachments.stage(uploads).catch(() => null);
    if (uploads.length > 0 && staged === null) return null;
    const job = submitJob(text);
    if (job === null) {
      if (staged !== null) void attachments.cleanup(staged.dir).catch(() => undefined);
      return null;
    }
    // 일이 시작되어 이미지를 읽기 전에(첫 await 전에) 같은 틱에 등록한다
    if (staged !== null) jobImages.set(job.id, staged);
    return boardView(runner.board).jobs.find((j) => j.id === job.id) ?? null;
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
  ipcMain.handle(IPC.diagnosticsCopy, copyDiagnostics);
  startUpdates();
  open(runner);
}).catch(reportStartupFailure);
app.on('window-all-closed', () => {
  if (quitWhenAllClosed(process.platform)) app.quit();
});
// macOS: Dock 아이콘을 눌렀을 때 창이 없으면 다시 연다.
app.on('activate', () => {
  if (window === null && runnerRef !== null) open(runnerRef);
});
