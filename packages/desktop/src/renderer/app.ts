import type { ApprovalView, BoardView, RauhaApi } from '../shared/ipc.js';
import { buildChat } from './chat-view.js';
import { offerTerminalCleanup, runWizard } from './first-run.js';
import { el, icon } from './dom.js';
import { buildGit } from './git-view.js';
import { buildRepos } from './repos-view.js';
import { buildRules } from './rules-view.js';
import { addTodo, buildTodo, localToday } from './todo-view.js';
import { buildRecords, copyText } from './records-view.js';
import { TodoDto } from '../shared/todo-dto.js';
import { buildCommands, commandsApi } from './commands-view.js';
import { useLooks } from './characters.js';
import { buildTeam } from './team-view.js';
import { TeamSettings } from '../shared/team-settings.js';
import { createRunner } from './command-runner.js';
import { CommandBook } from '../shared/command-book.js';
import { CommandBookDto } from '../shared/command-dto.js';
import { buildSettings, limitBar } from './settings-view.js';
import { createChrome } from './chrome.js';
import { createUpdateFeed } from './update-view.js';
import { modeOf, tierOf, type Layout } from './layout.js';
import { statusText } from './status-line.js';
import { TABS, type TabId } from './tabs.js';

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
const updates = createUpdateFeed(window.rauha.update, document.getElementById('update-banner')!, window.rauha.platform);

// ── 배치 선택(A/B)은 이 PC에 기억한다. 저장소가 막혀 있어도 화면은 그대로 돈다. ──
const readLayout = (): Layout => {
  try {
    return localStorage.getItem('rauha.layout') === 'B' ? 'B' : 'A';
  } catch {
    return 'A';
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
function renderTabs(): void {
  tabsNav.replaceChildren();
  const add = (t: (typeof TABS)[number]) => {
    const b = el('button');
    b.title = t.label;
    b.classList.toggle('on', t.id === current);
    b.append(icon(t.icon), el('span', undefined, t.label));
    b.addEventListener('click', () => show(t.id));
    tabsNav.appendChild(b);
  };
  TABS.filter((t) => !t.bottom).forEach(add);
  tabsNav.appendChild(el('span', 'spacer'));
  TABS.filter((t) => t.bottom).forEach(add);
}

function show(id: TabId): void {
  current = id;
  renderTabs();
  const tab = TABS.find((t) => t.id === id)!;
  if (id === 'chat') screen.replaceChildren(chat.root);
  else if (id === 'repos') screen.replaceChildren(buildRepos({ list: () => window.rauha.listRepos() }, async () => (await window.rauha.getSettings()).workFolder).root);
  else if (id === 'git') screen.replaceChildren(buildGit(() => window.rauha.listRepos(), async () => (await window.rauha.getSettings()).protectedBranches).root);
  else if (id === 'settings') screen.replaceChildren(buildSettings({ get: () => window.rauha.getSettings(), update: (p) => window.rauha.updateSettings(p).then((s) => (chrome.setFolder(s.workFolder), s)), usage: () => window.rauha.getUsage(), accounts: () => window.rauha.listAccounts(), pickFolder: () => window.rauha.pickFolder(), auth: window.rauha.auth, updates: { feed: updates, check: () => window.rauha.update.check() }, team: { build: () => buildTeam({ get: () => window.rauha.getTeam(), apply: (op) => window.rauha.applyTeam(op), onChange: (v) => useLooks(TeamSettings.from(v.settings).looks()) }).root } }, pickLayout).root);
  else if (id === 'todo') screen.replaceChildren(buildTodo({ api: window.rauha.todo, repos: async () => (await window.rauha.listRepos()).filter((r) => r.kind === 'repo').map((r) => r.name), today: localToday, openJob: (jobId) => (show('chat'), chat.open(jobId)) }).root);
  else if (id === 'records') screen.replaceChildren(buildRecords({ api: window.rauha.records, now: () => Date.now(), copy: copyText }).root);
  else if (id === 'commands') screen.replaceChildren(buildCommands(commandsApi(window.rauha, (b) => (commandBook = b))).root);
  else if (id === 'rules') screen.replaceChildren(buildRules({ draft: (s) => window.rauha.draftRule(s), list: () => window.rauha.listRules(), add: (r) => window.rauha.addRule(r), remove: (rid) => window.rauha.removeRule(rid), defaults: { list: () => window.rauha.listDefaultRules(), apply: (op) => window.rauha.applyDefaultRule(op) } }).root);
  else {
    const soon = el('div', 'soon');
    soon.append(el('b', undefined, tab.label), el('span', undefined, '곧 열려요'));
    screen.replaceChildren(soon);
  }
}

// ── 명령(입력창의 /명령) ──
let commandBook = CommandBook.initial();
let lastBoard: BoardView | null = null;
const runner = createRunner({
  book: () => commandBook,
  say: (content) => chat.notice(content),
  clear: () => chat.clearScreen(),
  openTab: (tab) => {
    const t = TABS.find((x) => x.id === tab);
    if (t !== undefined) show(t.id);
  },
  openJob: (id) => {
    show('chat');
    chat.open(id);
  },
  jobs: () => chat.jobList(),
  board: () => lastBoard,
  api: window.rauha,
});
void window.rauha.getTeam().then((v) => useLooks(TeamSettings.from(v.settings).looks()));
void window.rauha.getCommands().then((json) => (commandBook = CommandBookDto.from(json).toEntity()));

// ── 채팅 ──
const chat = buildChat({
  intercept: (text) => runner.intercept(text),
  suggest: (text) => commandBook.suggest(text),
  submit: (text) => window.rauha.submit(text),
  saveTodo: (text) => addTodo(window.rauha.todo, TodoDto.draftFromChat(text)),
  stop: (id) => window.rauha.stop(id),
  deeper: (id) => window.rauha.goDeeper(id),
  answer: (id, choice) => window.rauha.answerApproval(id, choice),
  review: (id) => window.rauha.reviewApproval(id),
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
  t.append(el('b', undefined, '허락이 필요해요'), el('span', undefined, `${a.roleName} · ${a.summary.headline}`));
  const go = el('button', 'btn primary', '정리 보기');
  go.addEventListener('click', () => {
    show('chat');
    chat.open(a.jobId);
    t.remove();
  });
  t.appendChild(go);
  if (window.rauha.platform === 'darwin' && !notifyHintSeen()) t.appendChild(el('small', 'hint', '알림이 안 보이면 시스템 설정 > 알림에서 rauha를 허용해 주세요.'));
  toasts.appendChild(t);
  setTimeout(() => t.remove(), 12000);
}

/** 아래 상태 줄의 세션·주간 한도 미니 막대(%만, 돈은 없다) */
async function refreshLimits(): Promise<void> {
  const usage = await window.rauha.getUsage();
  const box = document.getElementById('status-usage')!;
  box.replaceChildren();
  if (usage === null) return;
  box.append(limitBar('세션', usage.session), limitBar('주간', usage.weekly));
}

function renderStatus(view: BoardView): void {
  lastBoard = view;
  document.getElementById('status-jobs')!.textContent = statusText(view);
  document.getElementById('status-limit')!.textContent = `동시에 ${view.limit}개까지`;
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
  const t = TABS.find((x) => x.id === tab);
  if (t !== undefined) show(t.id);
});
window.rauha.onOpenJob((id) => {
  show('chat');
  chat.open(id);
});
void window.rauha.boardNow().then((view) => {
  chat.board(view);
  renderStatus(view);
});
void window.rauha.approvalsNow().then(onApprovals);

void (async () => {
  const settings = await window.rauha.getSettings();
  chrome.setFolder(settings.workFolder);
  if (settings.layout !== layout) pickLayout(settings.layout);
  if (!settings.firstRunDone) {
    await runWizard({ pickFolder: () => window.rauha.pickFolder(), accounts: () => window.rauha.listAccounts(), auth: window.rauha.auth, update: (p) => window.rauha.updateSettings(p).then((s) => (chrome.setFolder(s.workFolder), s)) });
  }
  await offerTerminalCleanup();
})();
void refreshLimits();
setInterval(() => void refreshLimits(), 30_000);
applyMode();
show('chat');
chat.focus();
