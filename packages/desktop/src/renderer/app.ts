import type { ApprovalView, BoardView, RauhaApi } from '../shared/ipc.js';
import { buildChat } from './chat-view.js';
import { offerTerminalCleanup } from './first-run.js';
import { el, icon } from './dom.js';
import { modeOf, tierOf, type Layout } from './layout.js';
import { statusText } from './status-line.js';
import { TABS, type TabId } from './tabs.js';

declare global {
  interface Window {
    readonly rauha: RauhaApi;
  }
}

const app = document.querySelector<HTMLElement>('.app')!;
document.documentElement.dataset['platform'] = window.rauha.platform;
const tabsNav = document.getElementById('tabs')!;
const screen = document.getElementById('screen')!;
let current: TabId = 'chat';

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
  if (tab.ready) screen.replaceChildren(chat.root);
  else {
    const soon = el('div', 'soon');
    soon.append(el('b', undefined, tab.label), el('span', undefined, '곧 열려요'));
    screen.replaceChildren(soon);
  }
}

// ── 채팅 ──
const chat = buildChat({
  submit: (text) => window.rauha.submit(text),
  stop: (id) => window.rauha.stop(id),
  answer: (id, choice) => window.rauha.answerApproval(id, choice),
});
function pickLayout(next: Layout): void {
  layout = next;
  try {
    localStorage.setItem('rauha.layout', next);
  } catch {
    /* 기억 못 해도 괜찮다 */
  }
  chat.layoutButtons(layout, pickLayout);
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

function renderStatus(view: BoardView): void {
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

void offerTerminalCleanup();
applyMode();
show('chat');
chat.focus();
