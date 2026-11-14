import { el } from './dom.js';

const KEY = 'rauha.records.view';
type View = 'records' | 'claude';

/** Records 탭 위의 전환: rauha 작업 기록 ↔ Claude 대화 내역(이 컴퓨터의 모든 Claude Code 대화). 마지막 고른 쪽을 기억한다 */
export function buildRecordsSwitch(make: Readonly<Record<View, () => HTMLElement>>): { readonly root: HTMLElement } {
  const root = el('section', 'records-switch');
  const tabs = el('div', 'tabs records-tabs');
  const host = el('div', 'records-host');
  // 기본은 모든 대화(Claude Code · Kiro · Codex). rauha 작업 기록은 두 번째 탭
  let view: View = 'claude';
  try {
    if (localStorage.getItem(KEY) === 'records') view = 'records';
  } catch {
    /* 기억은 없어도 된다 */
  }
  const built = new Map<View, HTMLElement>();
  const buttons = new Map<View, HTMLButtonElement>();
  const show = (v: View): void => {
    view = v;
    try {
      localStorage.setItem(KEY, v);
    } catch {
      /* 무시 */
    }
    for (const [id, b] of buttons) b.classList.toggle('on', id === v);
    let node = built.get(v);
    if (node === undefined) {
      node = make[v]();
      built.set(v, node);
    }
    host.replaceChildren(node);
  };
  for (const [id, label] of [['claude', 'All conversations'], ['records', 'rauha task records']] as const) {
    const b = el('button', 'tab', label);
    b.type = 'button';
    b.addEventListener('click', () => show(id));
    buttons.set(id, b);
    tabs.append(b);
  }
  root.append(tabs, host);
  show(view);
  return { root };
}
