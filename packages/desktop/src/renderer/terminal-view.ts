import { TERMINAL_LIMIT_NOTE, type TermEvent, type TermRoot, type TerminalApi } from '../shared/terminal-api.js';
import { TerminalScreen } from '../shared/terminal-line.js';
import { el } from './dom.js';

interface Tab {
  readonly id: string;
  readonly title: string;
  readonly screen: TerminalScreen;
  cwd: string;
  running: boolean;
  readonly history: string[];
  cursor: number;
}

const HEIGHT_KEY = 'rauha.term.height';
const MIN_HEIGHT = 120;
const DEFAULT_HEIGHT = 240;
const HISTORY_MAX = 200;

const readHeight = (): number => {
  try {
    const n = Number(localStorage.getItem(HEIGHT_KEY));
    return Number.isFinite(n) && n >= MIN_HEIGHT ? n : DEFAULT_HEIGHT;
  } catch {
    return DEFAULT_HEIGHT;
  }
};

/**
 * 코드 탭 아래 터미널 칸. 입력줄 하나와 출력 창으로 이루어진다(진짜 PTY가 아니라서 한계를 한 줄로 알린다).
 * 터미널을 여러 개 열 수 있고, 새로 열 때 작업 폴더나 그 아래 레포를 고른다.
 */
export function buildTerminal(api: TerminalApi) {
  const root = el('section', 'term');
  root.hidden = true;
  const grip = el('div', 'term-grip');
  const bar = el('div', 'term-bar');
  const tabsBox = el('div', 'term-tabs');
  const addBtn = el('button', 'code-ibtn', '+');
  addBtn.title = '새 터미널';
  const stopBtn = el('button', 'term-stop', '멈추기');
  stopBtn.hidden = true;
  const hideBtn = el('button', 'code-ibtn', '×');
  hideBtn.title = '터미널 칸 접기';
  bar.append(tabsBox, addBtn, stopBtn, hideBtn);
  const note = el('div', 'term-note', TERMINAL_LIMIT_NOTE);
  const out = el('pre', 'term-out');
  const inputRow = el('div', 'term-row');
  const prompt = el('span', 'term-prompt');
  const input = el('input', 'term-input');
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.placeholder = '명령을 입력하고 Enter';
  inputRow.append(prompt, input);
  root.append(grip, bar, note, out, inputRow);
  root.style.height = `${readHeight()}px`;

  const tabs: Tab[] = [];
  let active: Tab | null = null;
  let roots: readonly TermRoot[] = [];
  let menu: HTMLElement | null = null;
  let frame = 0;

  const byId = (id: string): Tab | undefined => tabs.find((t) => t.id === id);

  function paintOut(): void {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (active === null) return out.replaceChildren();
      const stick = out.scrollHeight - out.scrollTop - out.clientHeight < 40;
      out.textContent = active.screen.text();
      if (stick) out.scrollTop = out.scrollHeight;
    });
  }

  function paintBar(): void {
    tabsBox.replaceChildren();
    for (const t of tabs) {
      const b = el('div', `term-tab${t === active ? ' on' : ''}`);
      const name = el('span', 'term-tab-name', t.title);
      const x = el('button', 'code-x', '×');
      x.title = '터미널 닫기';
      x.addEventListener('click', (e) => {
        e.stopPropagation();
        void closeTab(t);
      });
      b.append(name, x);
      b.addEventListener('click', () => activate(t));
      tabsBox.append(b);
    }
    prompt.textContent = active === null ? '' : active.running ? '▶' : `${active.cwd} >`;
    stopBtn.hidden = active === null || !active.running;
    input.disabled = active === null;
  }

  function activate(tab: Tab): void {
    active = tab;
    paintBar();
    paintOut();
    input.focus();
  }

  async function openTab(rootPath: string): Promise<void> {
    const r = await api.open(rootPath);
    if (!r.ok) {
      if (active !== null) {
        active.screen.endLine();
        active.screen.write(`${r.message}\n`);
        paintOut();
      } else {
        out.textContent = r.message;
      }
      return;
    }
    const label = roots.find((x) => x.path === rootPath)?.label ?? '터미널';
    const tab: Tab = { id: r.id, title: `${label} · ${r.shell}`, screen: new TerminalScreen(), cwd: r.cwd, running: false, history: [], cursor: 0 };
    tabs.push(tab);
    activate(tab);
  }

  async function closeTab(tab: Tab): Promise<void> {
    await api.close(tab.id);
    const i = tabs.indexOf(tab);
    tabs.splice(i, 1);
    if (active === tab) active = tabs[i] ?? tabs[i - 1] ?? null;
    paintBar();
    paintOut();
    if (active === null) root.hidden = true;
  }

  async function newTab(): Promise<void> {
    roots = await api.roots();
    if (roots.length === 0) {
      out.textContent = '작업 폴더를 먼저 골라 주세요(설정).';
      return;
    }
    const first = roots[0];
    if (roots.length === 1 && first !== undefined) return openTab(first.path);
    showMenu();
  }

  /** 시작할 폴더(작업 폴더·레포)를 고르는 작은 목록 */
  function showMenu(): void {
    menu?.remove();
    const box = el('div', 'term-menu');
    for (const r of roots) {
      const b = el('button', undefined, r.label);
      b.addEventListener('click', () => {
        box.remove();
        menu = null;
        void openTab(r.path);
      });
      box.append(b);
    }
    menu = box;
    bar.append(box);
    const close = (e: MouseEvent): void => {
      if (e.target instanceof Node && box.contains(e.target)) return;
      box.remove();
      menu = null;
      window.removeEventListener('mousedown', close, true);
    };
    window.addEventListener('mousedown', close, true);
  }

  async function submit(): Promise<void> {
    const tab = active;
    if (tab === null) return;
    const line = input.value;
    input.value = '';
    if (line.trim() !== '' && !tab.running) {
      tab.history.push(line);
      if (tab.history.length > HISTORY_MAX) tab.history.shift();
    }
    tab.cursor = tab.history.length;
    if (!tab.running && /^\s*(clear|cls)\s*$/i.test(line)) {
      tab.screen.clear();
      paintOut();
      return;
    }
    if (!tab.running && line.trim() === '') return;
    tab.screen.endLine();
    tab.screen.write(tab.running ? `${line}\n` : `${tab.cwd} > ${line}\n`);
    paintOut();
    const r = await api.run(tab.id, line);
    if (!r.ok) {
      tab.screen.endLine();
      tab.screen.write(`${r.message}\n`);
      paintOut();
    }
  }

  function onEvent(e: TermEvent): void {
    const tab = byId(e.id);
    if (tab === undefined) return;
    if (e.type === 'start') {
      tab.running = true;
    } else if (e.type === 'out') {
      tab.screen.write(e.data);
    } else {
      tab.running = false;
      tab.cwd = e.cwd;
      tab.screen.endLine();
      if (e.code !== 0 || e.note !== null) tab.screen.write(`[${e.note ?? '끝났어요'}${e.code !== null && e.code !== 0 ? ` · 종료 코드 ${e.code}` : ''}]\n`);
    }
    if (tab === active) {
      paintBar();
      paintOut();
    }
  }
  api.onEvent(onEvent);

  input.addEventListener('keydown', (e) => {
    const tab = active;
    if (tab === null) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      void submit();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      tab.cursor = Math.min(tab.history.length, Math.max(0, tab.cursor + (e.key === 'ArrowUp' ? -1 : 1)));
      input.value = tab.history[tab.cursor] ?? '';
    } else if (e.ctrlKey && e.key.toLowerCase() === 'c' && input.selectionStart === input.selectionEnd) {
      e.preventDefault();
      if (tab.running) void api.stop(tab.id);
      else input.value = '';
    } else if (e.ctrlKey && e.key.toLowerCase() === 'l') {
      e.preventDefault();
      tab.screen.clear();
      paintOut();
    }
  });
  addBtn.addEventListener('click', () => void newTab());
  stopBtn.addEventListener('click', () => active !== null && void api.stop(active.id));
  hideBtn.addEventListener('click', () => hide());
  out.addEventListener('mouseup', () => {
    if (window.getSelection()?.toString() === '') input.focus();
  });

  // 위쪽 손잡이를 끌어 높이를 바꾼다
  grip.addEventListener('mousedown', (down) => {
    down.preventDefault();
    const startY = down.clientY;
    const startH = root.getBoundingClientRect().height;
    const move = (e: MouseEvent): void => {
      const max = Math.max(MIN_HEIGHT, (root.parentElement?.getBoundingClientRect().height ?? 600) - 160);
      root.style.height = `${Math.min(max, Math.max(MIN_HEIGHT, startH + startY - e.clientY))}px`;
    };
    const up = (): void => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      try {
        localStorage.setItem(HEIGHT_KEY, String(Math.round(root.getBoundingClientRect().height)));
      } catch {
        /* 기억 못 해도 괜찮다 */
      }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });

  function hide(): void {
    root.hidden = true;
  }

  return {
    root,
    isOpen: (): boolean => !root.hidden,
    /** 칸을 보이거나 접는다. 처음 보일 때 터미널이 없으면 하나 연다. */
    async toggle(): Promise<void> {
      if (!root.hidden) return hide();
      root.hidden = false;
      if (tabs.length === 0) await newTab();
      else input.focus();
    },
    hide,
    /** 작업 폴더가 바뀌면 열어 둔 터미널을 모두 닫는다 */
    async reset(): Promise<void> {
      for (const t of [...tabs]) await api.close(t.id);
      tabs.length = 0;
      active = null;
      paintBar();
      paintOut();
      hide();
    },
  };
}
