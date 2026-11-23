import type { ApprovalView, BoardView, RauhaApi, UsageView } from '../shared/ipc.js';
import { NEW_TASK_TAB } from '../shared/ui-commands.js';
import { buildChat } from './chat-view.js';
import { offerTerminalCleanup, runWizard } from './first-run.js';
import { el, icon } from './dom.js';
import { buildGit, REMEMBER as GIT_REPO_KEY, requestGitHistory } from './git-view.js';
import { buildRules } from './rules-view.js';
import { addTodo, buildTodo, localToday } from './todo-view.js';
import { buildRecords, copyText } from './records-view.js';
import { buildRecordsSwitch } from './records-switch.js';
import { buildClaudeHistory } from './claude-history-view.js';
import { buildInterview } from './interview-view.js';
import { buildCode } from './code-view.js';
import { TodoDto } from '../shared/todo-dto.js';
import { buildApi } from './api-view.js';
import { buildDb } from './db-view.js';
import { buildDocker } from './docker-view.js';
import { buildAws } from './aws-view.js';
import { vpnChatIntent, vpnChatReply, type VpnChatIntent } from '../shared/vpn-chat.js';
import { buildCommands, commandsApi } from './commands-view.js';
import { useCharacterSet, useLooks } from './characters.js';
import { repaintAll } from './stage.js';
import { buildTeam } from './team-view.js';
import { buildExtensions } from './extensions-view.js';
import { TeamSettings } from '../shared/team-settings.js';
import { createRunner } from './command-runner.js';
import { CommandBook } from '../shared/command-book.js';
import { CommandBookDto } from '../shared/command-dto.js';
import { buildSettings, limitBar } from './settings-view.js';
import { createUsageFeed, usageTooltip } from './usage-feed.js';
import { createChrome } from './chrome.js';
import { isSettingsKey, isShortcutSheetKey, tabShortcutIndex } from '../shared/tab-shortcut.js';
import { toggleShortcutSheet } from './shortcut-view.js';
import { installClickGuard } from './click-guard.js';
import { createUpdateFeed } from './update-view.js';
import { modeOf, tierOf, type Layout } from './layout.js';
import { statusText } from './status-line.js';
import { resolveTab, resolveTarget, TABS, type TabId } from './tabs.js';
import { mergeTabOrder, moveTab } from '../shared/tab-order.js';

installClickGuard();

declare global {
  interface Window {
    readonly rauha: RauhaApi;
  }
}

const app = document.querySelector<HTMLElement>('.app')!;
// 확인용: 스크린샷 실행에서만 main이 ?platform=darwin을 붙여 맥 모양을 흉내 낸다(실제 동작에는 영향 없음)
const platform = new URLSearchParams(location.search).get('platform') ?? window.rauha.platform;
document.documentElement.dataset['platform'] = platform;
const chrome = createChrome(document.documentElement, document.getElementById('titlebar-text')!, platform);
window.rauha.onFullScreen((on) => chrome.setFullScreen(on));
const tabsNav = document.getElementById('tabs')!;
const screen = document.getElementById('screen')!;
let current: TabId = 'chat';
/** 한 번 만들어 두고 다시 쓰는 탭 화면(다시 만들면 깜빡인다) */
let settingsView: ReturnType<typeof buildSettings> | null = null;
let gitView: ReturnType<typeof buildGit> | null = null;
let dockerView: ReturnType<typeof buildDocker> | null = null;
let awsView: ReturnType<typeof buildAws> | null = null;
let recordsView: ReturnType<typeof buildRecordsSwitch> | null = null;
let todoView: ReturnType<typeof buildTodo> | null = null;
const code = buildCode({ api: window.rauha.code, autoSaveMode: async () => (await window.rauha.getSettings()).autoSave, workFolder: async () => (await window.rauha.getSettings()).workFolder, platform, terminal: window.rauha.terminal, openGit: (repoRoot) => openGit(repoRoot), openCommit: (repoRoot, hash) => (requestGitHistory(hash), openGit(repoRoot)), repos: () => window.rauha.listRepos(), toChat: (text) => (show('chat'), chat.fill(text)) });
const updates = createUpdateFeed(window.rauha.update, document.getElementById('update-banner')!, window.rauha.platform, () => window.rauha.copyDiagnostics());
const usageFeed = createUsageFeed();

// ── 배치 선택(A/B)은 이 PC에 기억한다. 저장소가 막혀 있어도 화면은 그대로 돈다. ──
const readLayout = (): Layout => {
  try {
    const saved = localStorage.getItem('rauha.layout');
    return saved === 'B' ? 'B' : saved === 'A' ? 'A' : 'C';
  } catch {
    return 'C';
  }
};
let layout: Layout = readLayout();

/** 창 너비 → 단계와 배치. 끌어서 크기를 바꾸는 동안에도 프레임당 한 번만 계산한다. */
function applyMode(): void {
  const tier = tierOf(window.innerWidth);
  app.dataset['tier'] = tier;
  app.dataset['mode'] = modeOf(tier, layout);
}
let pending = false;
window.addEventListener('resize', () => {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    applyMode();
  });
});

// ── 탭 ──
/** 왼쪽 막대에 보이는 순서(위쪽 탭, 맨 아래 탭). Ctrl/Cmd+숫자가 이 순서를 따른다. */
const TAB_ORDER_KEY = 'rauha.tabOrder';
/** 끌어서 바꾼 위쪽 탭 순서(맨 아래 탭은 고정). 기억 못 하면 기본 순서. */
function topTabs(): (typeof TABS)[number][] {
  let saved: unknown = null;
  try {
    saved = JSON.parse(localStorage.getItem(TAB_ORDER_KEY) ?? 'null');
  } catch {
    /* 기본 순서 */
  }
  const top = TABS.filter((t) => !t.bottom);
  return mergeTabOrder(top.map((t) => t.id), saved).map((id) => top.find((t) => t.id === id)!);
}
const tabOrder = (): readonly (typeof TABS)[number][] => [...topTabs(), ...TABS.filter((t) => t.bottom)];

let scrollerEdges: () => void = () => {};
new ResizeObserver(() => scrollerEdges()).observe(tabsNav);
function renderTabs(): void {
  // 위쪽 탭만 세로로 스크롤되고(스크롤바 없음), Settings·Report 는 늘 아래에 고정된다
  const scroller = el('div', 'act-scroll');
  const topBox = el('div', 'act-top');
  scroller.appendChild(topBox);
  const bottomBox = el('div', 'act-bottom');
  // 다시 그려도 막대를 스크롤해 둔 자리는 지킨다(탭을 누를 때마다 맨 위로 튀었다가 돌아오지 않게)
  const keptTop = tabsNav.querySelector<HTMLElement>('.act-top')?.scrollTop ?? 0;
  tabsNav.replaceChildren(scroller, bottomBox);
  const add = (t: (typeof TABS)[number], into: HTMLElement) => {
    const b = el('button');
    const at = tabOrder().indexOf(t);
    // 숫자 키는 열 개(Ctrl+1~9, 0)까지. 설정만 Ctrl+, 이고, 그 밖에 열째를 넘는 탭은 단축키가 없다
    const key = t.id === 'settings' ? ',' : at < 10 ? String((at + 1) % 10) : null;
    b.title = key === null ? t.label : `${t.label} (${platform === 'darwin' ? '⌘' : 'Ctrl+'}${key})`;
    b.classList.toggle('on', t.id === current);
    b.append(icon(t.icon), el('span', undefined, t.label));
    b.addEventListener('click', () => show(t.id));
    if (!t.bottom) {
      b.draggable = true;
      b.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData('text/rauha-tab', t.id);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      });
      const side = (e: DragEvent): boolean => e.offsetY > b.clientHeight / 2;
      const clear = (): void => b.classList.remove('drop-before', 'drop-after');
      b.addEventListener('dragover', (e) => {
        if (e.dataTransfer?.types.includes('text/rauha-tab') !== true) return;
        e.preventDefault();
        clear();
        b.classList.add(side(e) ? 'drop-after' : 'drop-before');
      });
      b.addEventListener('dragleave', clear);
      b.addEventListener('drop', (e) => {
        e.preventDefault();
        clear();
        const from = e.dataTransfer?.getData('text/rauha-tab') ?? '';
        const next = moveTab(topTabs().map((x) => x.id), from, t.id, side(e));
        try {
          localStorage.setItem(TAB_ORDER_KEY, JSON.stringify(next));
        } catch {
          /* 이번 실행에서만 바뀐다 */
        }
        renderTabs();
      });
    }
    into.appendChild(b);
  };
  topTabs().forEach((t) => add(t, topBox));
  TABS.filter((t) => t.bottom).forEach((t) => add(t, bottomBox));
  // 위/아래에 더 있으면 옅은 그라데이션으로 알리고, 지금 탭은 보이게 스크롤한다
  const edges = (): void => {
    scroller.classList.toggle('more-up', topBox.scrollTop > 1);
    scroller.classList.toggle('more-down', topBox.scrollTop + topBox.clientHeight < topBox.scrollHeight - 1);
  };
  topBox.addEventListener('scroll', edges, { passive: true });
  scrollerEdges = edges;
  topBox.scrollTop = keptTop;
  topBox.querySelector('button.on')?.scrollIntoView({ block: 'nearest' });
  edges();
}


window.addEventListener('keydown', (e) => {
  if (isShortcutSheetKey(e, platform)) {
    e.preventDefault();
    toggleShortcutSheet(platform);
    return;
  }
  // 확인 창·답답한 점 창이 떠 있는 동안에는 뒤 화면을 옮기지 않는다
  if (isSettingsKey(e, platform) && document.querySelector('.veil') === null) {
    e.preventDefault();
    show('settings');
    return;
  }
  const index = tabShortcutIndex(e, platform);
  const target = index === null || document.querySelector('.veil') !== null ? undefined : tabOrder()[index];
  if (target !== undefined) {
    e.preventDefault();
    show(target.id);
  }
});

/** 코드 탭에서 git 탭으로: git 탭이 기억하는 레포를 이 레포로 바꾸고 연다 */
function openGit(repoRoot: string): void {
  try {
    localStorage.setItem(GIT_REPO_KEY, repoRoot);
  } catch {
    /* 기억 못 하면 git 탭이 알아서 고른 레포로 열린다 */
  }
  show('git');
}

function show(id: TabId): void {
  current = id;
  renderTabs();
  const tab = TABS.find((t) => t.id === id)!;
  if (id === 'chat') (screen.replaceChildren(chat.root), chat.onShow());
  else if (id === 'code') (screen.replaceChildren(code.root), void code.onShow());
  else if (id === 'git') {
    // git 탭은 한 번 만들어 두고 다시 열 때는 보던 화면 그대로 상태만 다시 읽는다(새로 만들면 0.5초쯤 빈 화면이 깜빡였다)
    const fresh = gitView === null;
    gitView ??= buildGit(() => window.rauha.listRepos(), async () => (await window.rauha.getSettings()).protectedBranches);
    screen.replaceChildren(gitView.root);
    if (!fresh) void gitView.reopen();
  }
  else if (id === 'settings') {
    // 설정도 한 번 만들어 두고 다시 열면 보던 자리 그대로 값만 새로 읽는다(새로 만들면 잠깐 비고 맨 위로 돌아갔다)
    const fresh = settingsView === null;
    settingsView ??= buildSettings({ get: () => window.rauha.getSettings(), update: (p) => window.rauha.updateSettings(p).then((s) => (chrome.setFolder(s.workFolder), s)), usage: () => usageFeed.refresh('settings-open').then((v) => v ?? window.rauha.getUsage()), usageFeed, accounts: () => window.rauha.listAccounts(), pickFolder: () => window.rauha.pickFolder(), recent: { status: () => window.rauha.recentFolderStatus(), forget: (p) => window.rauha.forgetRecentFolder(p) }, auth: window.rauha.auth, style: { list: () => window.rauha.listStyle(), forget: (id) => window.rauha.forgetStyle(id) }, updates: { feed: updates, check: () => window.rauha.update.check(), install: () => window.rauha.update.install() }, diagnostics: () => window.rauha.copyDiagnostics(), onCharacterSet: applyCharacterSet, team: { build: () => buildTeam({ get: () => window.rauha.getTeam(), apply: (op) => window.rauha.applyTeam(op), onChange: (v) => useLooks(TeamSettings.from(v.settings).looks()) }) }, openExtensions: () => show('extensions') }, pickLayout);
    screen.replaceChildren(settingsView.root);
    if (!fresh) settingsView.reopen();
  }
  else if (id === 'todo') {
    // 할 일도 한 번 만들어 두고 다시 열면 그 자리에서 다시 그린다
    const fresh = todoView === null;
    todoView ??= buildTodo({ api: window.rauha.todo, repos: async () => (await window.rauha.listRepos()).filter((r) => r.kind === 'repo').map((r) => r.name), today: localToday, openJob: (jobId) => (show('chat'), chat.open(jobId)) });
    screen.replaceChildren(todoView.root);
    if (!fresh) todoView.refresh();
  }
  else if (id === 'api') screen.replaceChildren(buildApi({ api: window.rauha.api, copy: copyText, toChat: (text) => (show('chat'), chat.fill(text)) }).root);
  else if (id === 'docker') {
    // docker 탭도 한 번 만들어 두고 다시 열면 보던 목록 그대로 새로 읽는다(새로 만들면 목록이 0.1초쯤 늦게 채워졌다)
    const fresh = dockerView === null;
    dockerView ??= buildDocker({ api: window.rauha.docker, copy: copyText });
    screen.replaceChildren(dockerView.root);
    if (!fresh) void dockerView.refresh();
  }
  else if (id === 'db') screen.replaceChildren(buildDb({ api: window.rauha.db, copy: copyText }).root);
  else if (id === 'aws') {
    // 연결 상태를 이어 보여 주려고 한 번 만들어 두고 다시 열면 새로 읽는다
    const fresh = awsView === null;
    awsView ??= buildAws({ vpn: window.rauha.vpn, aws: window.rauha.aws });
    screen.replaceChildren(awsView.root);
    if (!fresh) void awsView.refresh();
  }
  else if (id === 'interview') screen.replaceChildren(buildInterview({ api: window.rauha.interview, openMyWork: () => show('git'), toMain: (text) => (show('chat'), chat.fill(text)) }).root);
  else if (id === 'extensions') screen.replaceChildren(buildExtensions({ connectors: window.rauha.connectors, plugins: window.rauha.plugins, toChat: (text) => (show('chat'), chat.fill(text)) }).root);
  else if (id === 'records') {
    // Records 탭도 한 번 만들어 두고 다시 열면 보던 쪽만 새로 읽는다(새로 만들면 "읽는 중"이 매번 먼저 보였다)
    const fresh = recordsView === null;
    const blog = { api: window.rauha.blog, names: { get: async () => (await window.rauha.getSettings()).blogNames, set: async (names: readonly string[]) => (await window.rauha.updateSettings({ blogNames: names })).blogNames } };
    recordsView ??= buildRecordsSwitch({
      records: () => buildRecords({ api: window.rauha.records, now: () => Date.now(), copy: copyText, blog }),
      claude: () => buildClaudeHistory({ api: window.rauha.claudeHistory, now: () => Date.now(), copy: copyText, blog }),
    });
    screen.replaceChildren(recordsView.root);
    if (!fresh) recordsView.reopen();
  }
  else if (id === 'commands') screen.replaceChildren(buildCommands(commandsApi(window.rauha, (b) => (commandBook = b))).root);
  else if (id === 'rules') screen.replaceChildren(buildRules({ draft: (s) => window.rauha.draftRule(s), list: () => window.rauha.listRules(), add: (r) => window.rauha.addRule(r), remove: (rid) => window.rauha.removeRule(rid), update: (r) => window.rauha.updateRule(r), defaults: { list: () => window.rauha.listDefaultRules(), apply: (op) => window.rauha.applyDefaultRule(op) } }).root);
  else {
    const soon = el('div', 'soon');
    soon.append(el('b', undefined, tab.label), el('span', undefined, 'Coming soon'));
    screen.replaceChildren(soon);
  }
}

// ── 명령(입력창의 /명령) ──
let commandBook = CommandBook.initial();
let lastBoard: BoardView | null = null;
const runner = createRunner({
  book: () => commandBook,
  say: (content) => chat.notice(content),
  clear: () => {
    chat.clearScreen();
    void window.rauha.clearChatHistory();
  },
  openTab: (target) => {
    const to = resolveTarget(target);
    if (to === null) return;
    show(to.tab);
    if (to.tab === 'settings' && to.section !== null) settingsView?.reveal(to.section);
  },
  openJob: (id) => {
    show('chat');
    chat.open(id);
  },
  jobs: () => chat.jobList(),
  board: () => lastBoard,
  api: window.rauha,
});
/** 채팅의 VPN 말: 할 일을 하고 결과를 채팅에 남긴다. 연결은 끝날 때(연결됨·실패)까지 최대 30초 지켜본다 */
async function handleVpnChat(intent: VpnChatIntent): Promise<void> {
  const { act, say } = vpnChatReply(intent, await window.rauha.vpn.list());
  chat.notice(say);
  if (act === null) return;
  if (act.kind === 'open-tab') return show('aws');
  if (act.kind === 'disconnect') {
    const r = await window.rauha.vpn.disconnect(act.id);
    chat.notice(r.ok ? 'VPN 을 끊었어요.' : r.error);
    return;
  }
  const r = await window.rauha.vpn.connect(act.id);
  if (!r.ok) return chat.notice(r.error);
  for (let i = 0; i < 60; i++) {
    const p = (await window.rauha.vpn.list()).profiles.find((x) => x.id === act.id);
    if (p === undefined) return;
    if (p.status.phase === 'connected') return chat.notice(`연결됐어요${p.status.ip !== null ? ` (VPN 주소 ${p.status.ip})` : ''}.`);
    if (p.status.phase === 'failed' || p.status.phase === 'off') return chat.notice(`연결하지 못했어요: ${p.status.detail || '이유를 모름'}`);
    await new Promise((res) => setTimeout(res, 500));
  }
  chat.notice('아직 연결 중이에요. AWS 탭에서 상태를 볼 수 있어요.');
}

/** 캐릭터 세트를 적용하고, 이미 그려진 채팅 메인 칸(얼굴·안내)을 다시 그린다. 시작할 때와 설정에서 바꿀 때 같은 것을 쓴다 */
function applyCharacterSet(id: string): void {
  useCharacterSet(id);
  chat.repaintCharacters();
  // 설정의 팀원 목록·채팅 카드처럼 한 번 그려 둔 캐릭터도 새 컨셉으로
  repaintAll();
  // 팀원 이름도 컨셉마다 달라서 팀원 목록만 그 자리에서 다시 칠한다(설정 화면은 한 번 만들어 두고 다시 쓰므로 숨어 있어도 칠한다)
  settingsView?.repaintTeam();
}
void window.rauha.getSettings().then((s) => applyCharacterSet(s.characterSet));
void window.rauha.getTeam().then((v) => useLooks(TeamSettings.from(v.settings).looks()));
void window.rauha.getCommands().then((json) => (commandBook = CommandBookDto.from(json).toEntity()));

// ── 채팅 ──
const chat = buildChat({
  intercept: async (text) => {
    // "VPN 켜줘·꺼줘·상태" 는 모델을 부르지 않고 바로 한다(토큰 0)
    const vpnIntent = vpnChatIntent(text);
    if (vpnIntent !== null) {
      void handleVpnChat(vpnIntent);
      return null;
    }
    return runner.intercept(text);
  },
  suggest: (text) => commandBook.suggest(text),
  submit: (text, images) => window.rauha.submit(text, images),
  askOther: (id, text) => window.rauha.externalAi.ask(id, text),
  followUp: (parentId, text, inTask) => window.rauha.followUp(parentId, text, inTask),
  ai: { auth: window.rauha.auth, externalAi: window.rauha.externalAi, accounts: { list: () => window.rauha.listAccounts(), choose: (name) => window.rauha.updateSettings({ account: name }) } },
  saveTodo: (text) => addTodo(window.rauha.todo, TodoDto.draftFromChat(text)),
  stop: (id) => window.rauha.stop(id),
  deeper: (id) => window.rauha.goDeeper(id),
  limitRetry: { schedule: (id) => window.rauha.retryAtReset(id), cancel: (id) => window.rauha.cancelRetry(id), now: () => window.rauha.retriesNow(), on: (l) => window.rauha.onRetries(l) },
  answer: (id, choice) => window.rauha.answerApproval(id, choice),
  review: (id) => window.rauha.reviewApproval(id),
  resetConversation: () => window.rauha.resetConversation(null),
});
function pickLayout(next: Layout): void {
  layout = next;
  try {
    localStorage.setItem('rauha.layout', next);
  } catch {
    /* 기억 못 해도 괜찮다 */
  }
  chat.layoutButtons(layout, pickLayout);
  void window.rauha.updateSettings({ layout });
  applyMode();
}
chat.layoutButtons(layout, pickLayout);

// ── 허락 알림(오른쪽 아래 토스트) ──
const toasts = el('div', 'toasts');
document.body.appendChild(toasts);
const toasted = new Set<string>();
/** macOS는 알림을 처음 한 번 허용해야 보인다. 안내는 한 번만 붙인다. */
function notifyHintSeen(): boolean {
  try {
    if (localStorage.getItem('rauha.notifyHint') === '1') return true;
    localStorage.setItem('rauha.notifyHint', '1');
  } catch {
    /* 기억 못 하면 매번 보일 뿐이다 */
  }
  return false;
}
function toast(a: ApprovalView): void {
  if (toasted.has(a.id)) return;
  toasted.add(a.id);
  const t = el('div', 'toast');
  t.append(el('b', undefined, 'Permission needed'), el('span', undefined, `${a.roleName} · ${a.summary.headline}`));
  const go = el('button', 'btn sm primary', 'Review');
  go.addEventListener('click', () => {
    show('chat');
    chat.open(a.jobId);
    t.remove();
  });
  t.appendChild(go);
  if (window.rauha.platform === 'darwin' && !notifyHintSeen()) t.appendChild(el('small', 'hint', 'If you do not see notifications, allow rauha in System Settings > Notifications.'));
  toasts.appendChild(t);
  setTimeout(() => t.remove(), 12000);
}

/** 아래 상태 줄의 세션·주간 한도 미니 막대(%만, 돈은 없다) */
function paintLimits(usage: UsageView | null): void {
  const box = document.getElementById('status-usage')!;
  box.replaceChildren();
  if (usage === null) return;
  box.append(limitBar('Session', usage.session), limitBar('Weekly', usage.weekly));
}
const statusUsage = document.getElementById('status-usage')!;
/** 툴팁은 보기 직전에 "n초 전"을 새로 계산한다 */
statusUsage.addEventListener('mouseenter', () => (statusUsage.title = usageTooltip(usageFeed.current())));
usageFeed.subscribe((view) => {
  paintLimits(view);
  statusUsage.title = usageTooltip(view);
});
window.addEventListener('focus', () => void usageFeed.refresh('focus'));

function renderStatus(view: BoardView): void {
  lastBoard = view;
  document.getElementById('status-jobs')!.textContent = statusText(view);
  document.getElementById('status-limit')!.textContent = `Up to ${view.limit} at once`;
}

function onApprovals(list: readonly ApprovalView[]): void {
  chat.approvals(list);
  for (const a of list) toast(a);
  for (const t of [...toasts.children]) if (list.length === 0) t.remove();
}

window.rauha.onBoard((view) => {
  chat.board(view);
  renderStatus(view);
});
window.rauha.onApprovals(onApprovals);
window.rauha.onOpenTab((tab) => {
  if (tab === NEW_TASK_TAB) {
    show('chat');
    chat.focus();
    return;
  }
  const id = resolveTab(tab);
  if (id !== null) show(id);
});
window.rauha.onOpenJob((id) => {
  show('chat');
  chat.open(id);
});
// 지난 말풍선을 먼저 올리고(앱을 다시 켠 뒤), 그다음 지금 작업 판을 올린다
void window.rauha
  .chatHistoryNow()
  .catch(() => [])
  .then((past) => {
    chat.restore(past);
    return window.rauha.boardNow();
  })
  .then((view) => {
    chat.board(view);
    renderStatus(view);
  });
void window.rauha.approvalsNow().then(onApprovals);

void (async () => {
  const settings = await window.rauha.getSettings();
  chrome.setFolder(settings.workFolder);
  if (settings.layout !== layout) pickLayout(settings.layout);
  if (!settings.firstRunDone) {
    await runWizard({ pickFolder: () => window.rauha.pickFolder(), recent: { folders: settings.recentFolders, current: settings.workFolder, status: () => window.rauha.recentFolderStatus(), forget: (p) => window.rauha.forgetRecentFolder(p) }, accounts: () => window.rauha.listAccounts(), listRepos: () => window.rauha.listRepos(), auth: window.rauha.auth, update: (p) => window.rauha.updateSettings(p).then((s) => (chrome.setFolder(s.workFolder), s)) });
  }
  await offerTerminalCleanup();
})();
applyMode();
show('chat');
chat.focus();
