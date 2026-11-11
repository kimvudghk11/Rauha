import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal, type IDisposable, type ITheme } from '@xterm/xterm';
import { MAX_WRITE_CHARS, type TermEvent, type TermRoot, type TerminalApi } from '../shared/terminal-api.js';
import { findPathLinks, resolveTermPath } from '../shared/term-links.js';
import { termKeyAction } from '../shared/term-keys.js';
import { STYLE_NONCE } from './code-editor.js';
import { el, isEnterKey } from './dom.js';

/** 터미널 칸이 앱 쪽에 부탁하는 일 */
export interface TerminalHooks {
  readonly platform: string;
  readonly workFolder: () => Promise<string | null>;
  /** 작업 폴더 기준 상대 경로 파일을 편집기로 열고 줄·칸으로 간다 */
  readonly openFile: (path: string, line: number, column: number) => Promise<void>;
  readonly say: (message: string) => void;
}

interface Tab {
  readonly id: string;
  readonly title: string;
  /** 시작한 폴더(작업 폴더 기준 상대 경로). 상대 경로 링크의 기준 */
  readonly rootPath: string;
  readonly term: Terminal;
  readonly fit: FitAddon;
  readonly search: SearchAddon;
  readonly pane: HTMLElement;
  readonly disposables: IDisposable[];
  exited: boolean;
}

const HEIGHT_KEY = 'rauha.term.height';
const MIN_HEIGHT = 120;
const DEFAULT_HEIGHT = 260;
const SCROLLBACK = 5000;
/** 한 줄에서 링크를 찾는 최대 글자 수(아주 긴 줄에서 멈추지 않게) */
const LINK_LINE_MAX = 2000;

const readHeight = (): number => {
  try {
    const n = Number(localStorage.getItem(HEIGHT_KEY));
    return Number.isFinite(n) && n >= MIN_HEIGHT ? n : DEFAULT_HEIGHT;
  } catch {
    return DEFAULT_HEIGHT;
  }
};

/**
 * xterm(DOM 렌더러)은 자기 <style>을 스스로 만들어 붙이고, 칸 색(트루컬러 등)을 style 속성 문자열로 단다.
 * 화면 CSP(style-src 'self' 'nonce-…')는 nonce 없는 <style>과 문자열 style 속성을 막는다. CSP는 그대로 두고 두 가지만 맞춘다.
 *  - <style> 요소를 만들 때 같은 nonce를 단다.
 *  - 속성 설정 호출로 style 을 달려는 것은 CSSOM(element.style.cssText)으로 돌려 준다(CSSOM 조작은 CSP가 막지 않는다).
 * 앱 코드는 style 속성 문자열을 쓰지 않는다(ui-components.spec 이 확인한다). 이 보정은 xterm 쪽 호출을 위한 것이다.
 */
let xtermCspReady = false;
function allowXtermStyles(): void {
  if (xtermCspReady) return;
  xtermCspReady = true;
  const create = document.createElement.bind(document) as (tag: string, options?: ElementCreationOptions) => HTMLElement;
  (document as { createElement: unknown }).createElement = (tag: string, options?: ElementCreationOptions): HTMLElement => {
    const node = create(tag, options);
    if (String(tag).toLowerCase() === 'style') (node as HTMLStyleElement).nonce = STYLE_NONCE;
    return node;
  };
  const set = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (this: Element, name: string, value: string): void {
    if (name.toLowerCase() === 'style' && this instanceof HTMLElement) this.style.cssText = value;
    else set.call(this, name, value);
  };
}

/** 앱 색 토큰(CSS 변수)에서 터미널 색을 만든다. 16색 팔레트는 VS Code 어두운 테마 값. */
function termTheme(): ITheme {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string): string => css.getPropertyValue(name).trim() || fallback;
  return {
    background: v('--bg', '#1f1f1f'),
    foreground: v('--text', '#cccccc'),
    cursor: v('--accentfg', '#3794ff'),
    selectionBackground: v('--sel', '#264f78'),
    black: '#000000', red: '#cd3131', green: '#0dbc79', yellow: '#e5e510', blue: '#2472c8', magenta: '#bc3fbc', cyan: '#11a8cd', white: '#e5e5e5',
    brightBlack: '#666666', brightRed: '#f14c4c', brightGreen: '#23d18b', brightYellow: '#f5f543', brightBlue: '#3b8eea', brightMagenta: '#d670d6', brightCyan: '#29b8db', brightWhite: '#e5e5e5',
  };
}

/**
 * 코드 탭 아래 터미널 칸. 탭 하나가 진짜 PTY 하나이고 xterm.js가 그린다(vim·less·ssh·색·커서 이동·Ctrl+C가 된다).
 * 새 터미널은 작업 폴더나 그 아래 레포에서 열고, 셸은 main이 정한다.
 */
export function buildTerminal(api: TerminalApi, hooks: TerminalHooks) {
  const root = el('section', 'term');
  root.hidden = true;
  const grip = el('div', 'term-grip');
  const bar = el('div', 'term-bar');
  const tabsBox = el('div', 'term-tabs');
  const addBtn = el('button', 'btn ghost icon sm', '+');
  addBtn.title = 'New terminal (Ctrl/Cmd+Shift+`)';
  const findBtn = el('button', 'btn ghost icon sm', '⌕');
  findBtn.title = 'Find in the terminal (Ctrl/Cmd+F)';
  const hideBtn = el('button', 'btn ghost icon sm', '×');
  hideBtn.title = 'Collapse terminal (Ctrl/Cmd+`)';
  bar.append(tabsBox, findBtn, addBtn, hideBtn);
  const find = el('div', 'term-find');
  find.hidden = true;
  const findInput = el('input', 'term-find-input');
  findInput.placeholder = 'Find in the terminal';
  findInput.spellcheck = false;
  const findPrev = el('button', 'btn ghost icon sm', '↑');
  findPrev.title = 'Previous match (Shift+Enter)';
  const findNext = el('button', 'btn ghost icon sm', '↓');
  findNext.title = 'Next match (Enter)';
  const findClose = el('button', 'btn ghost icon sm', '×');
  findClose.title = 'Close find (Esc)';
  find.append(findInput, findPrev, findNext, findClose);
  const body = el('div', 'term-body');
  const empty = el('div', 'term-empty');
  root.append(grip, bar, find, body);
  root.style.height = `${readHeight()}px`;

  const tabs: Tab[] = [];
  let active: Tab | null = null;
  let roots: readonly TermRoot[] = [];
  let menu: HTMLElement | null = null;
  let fitFrame = 0;
  /** 같은 id의 출력이 탭 만들기보다 먼저 올 수 있어 잠깐 담아 둔다 */
  const early = new Map<string, string[]>();

  const byId = (id: string): Tab | undefined => tabs.find((t) => t.id === id);

  function setEmpty(message: string | null): void {
    empty.remove();
    if (message === null) return;
    empty.textContent = message;
    body.append(empty);
  }

  function paintBar(): void {
    tabsBox.replaceChildren();
    for (const t of tabs) {
      const b = el('div', `term-tab${t === active ? ' on' : ''}${t.exited ? ' exited' : ''}`);
      b.append(el('span', 'term-tab-name', t.title));
      const x = el('button', 'btn ghost icon sm code-x', '×');
      x.title = 'Close terminal';
      x.addEventListener('click', (e) => {
        e.stopPropagation();
        void closeTab(t);
      });
      b.append(x);
      b.addEventListener('click', () => activate(t));
      tabsBox.append(b);
    }
  }

  /** 보이는 칸 크기에 맞춰 열·행을 다시 계산하고 main의 PTY에 알린다 */
  function refit(): void {
    cancelAnimationFrame(fitFrame);
    fitFrame = requestAnimationFrame(() => {
      const tab = active;
      if (tab === null || root.hidden || body.clientWidth < 20 || body.clientHeight < 20) return;
      try {
        tab.fit.fit();
      } catch {
        /* 칸이 아직 그려지지 않았다 */
      }
    });
  }

  function activate(tab: Tab): void {
    active = tab;
    for (const t of tabs) t.pane.hidden = t !== tab;
    paintBar();
    closeFind();
    refit();
    tab.term.focus();
  }

  const copy = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      hooks.say('Could not copy to the clipboard.');
    }
  };

  async function openLink(raw: string, line: number, column: number, base: string): Promise<void> {
    const work = await hooks.workFolder();
    const rel = work === null ? null : resolveTermPath(raw, work, base, hooks.platform);
    if (rel === null) return hooks.say('That file is outside the work folder, so it is not opened here.');
    await hooks.openFile(rel, line, column);
  }

  function keyHandler(tab: Tab) {
    return (e: KeyboardEvent): boolean => {
      if (e.type !== 'keydown') return true;
      const action = termKeyAction(e, hooks.platform, tab.term.hasSelection());
      switch (action) {
        case null:
          return true;
        case 'copy':
          if (tab.term.hasSelection()) void copy(tab.term.getSelection());
          e.preventDefault();
          e.stopPropagation();
          return false;
        case 'find':
          e.preventDefault();
          e.stopPropagation();
          openFind();
          return false;
        // 붙여넣기·앱 단축키는 xterm이 건드리지 않고 브라우저·앱이 받는다
        default:
          return false;
      }
    };
  }

  /** 지금 칸 크기로 xterm을 만든다. 처음 크기는 main에 알려야 하므로 먼저 만들어 계산해 둔다. */
  function makeTerminal(): { term: Terminal; fit: FitAddon; search: SearchAddon; pane: HTMLElement } {
    allowXtermStyles();
    const css = getComputedStyle(document.documentElement);
    const term = new Terminal({
      fontFamily: css.getPropertyValue('--mono').trim() || 'monospace',
      fontSize: 13,
      lineHeight: 1.25,
      cursorBlink: true,
      scrollback: SCROLLBACK,
      theme: termTheme(),
      allowProposedApi: true,
      macOptionIsMeta: false,
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    const pane = el('div', 'term-pane');
    pane.hidden = true;
    body.append(pane);
    term.open(pane);
    return { term, fit, search, pane };
  }

  async function openTab(rootPath: string): Promise<void> {
    setEmpty(null);
    const made = makeTerminal();
    // 칸이 보이는 상태여야 크기를 잴 수 있다
    made.pane.hidden = false;
    try {
      made.fit.fit();
    } catch {
      /* 기본 크기로 연다 */
    }
    const r = await api.open({ rootPath, cols: made.term.cols, rows: made.term.rows });
    if (!r.ok) {
      made.term.dispose();
      made.pane.remove();
      if (tabs.length === 0) setEmpty(r.message);
      else hooks.say(r.message);
      return;
    }
    const label = roots.find((x) => x.path === rootPath)?.label ?? 'Terminal';
    const tab: Tab = { id: r.id, title: `${label} · ${r.shell}`, rootPath, term: made.term, fit: made.fit, search: made.search, pane: made.pane, disposables: [], exited: false };
    tabs.push(tab);
    wire(tab);
    activate(tab);
    for (const chunk of early.get(r.id) ?? []) write(tab, chunk);
    early.delete(r.id);
  }

  function wire(tab: Tab): void {
    const { term } = tab;
    term.attachCustomKeyEventHandler(keyHandler(tab));
    tab.disposables.push(
      term.onData((data) => {
        // 긴 붙여넣기는 나눠서 보낸다(main은 한 번에 MAX_WRITE_CHARS까지만 받는다)
        for (let i = 0; i < data.length; i += MAX_WRITE_CHARS) void api.write(tab.id, data.slice(i, i + MAX_WRITE_CHARS));
      }),
      term.onResize(({ cols, rows }) => void api.resize(tab.id, cols, rows)),
      // 링크: Ctrl/Cmd+클릭. URL은 main의 외부 링크 검사(https만)를 거치고, 파일 경로는 편집기로 연다.
      term.registerLinkProvider({
        provideLinks: (y, done) => {
          const text = term.buffer.active.getLine(y - 1)?.translateToString(true).slice(0, LINK_LINE_MAX) ?? '';
          const links = findPathLinks(text);
          done(
            links.length === 0
              ? undefined
              : links.map((l) => ({
                  text: text.slice(l.start, l.end),
                  range: { start: { x: l.start + 1, y }, end: { x: l.end, y } },
                  activate: (e: MouseEvent) => {
                    if (hooks.platform === 'darwin' ? e.metaKey : e.ctrlKey) void openLink(l.path, l.line, l.column, tab.rootPath);
                  },
                })),
          );
        },
      }),
    );
    term.loadAddon(
      new WebLinksAddon((e, uri) => {
        if (hooks.platform === 'darwin' ? e.metaKey : e.ctrlKey) window.open(uri);
      }),
    );
  }

  /** 출력을 그리고, 다 그렸다고 main에 알린다(main은 안 알리면 PTY 읽기를 멈춘다) */
  function write(tab: Tab, data: string): void {
    tab.term.write(data, () => void api.ack(tab.id, data.length));
  }

  async function closeTab(tab: Tab): Promise<void> {
    await api.close(tab.id);
    removeTab(tab);
  }

  function removeTab(tab: Tab): void {
    const i = tabs.indexOf(tab);
    if (i < 0) return;
    tabs.splice(i, 1);
    for (const d of tab.disposables) d.dispose();
    tab.term.dispose();
    tab.pane.remove();
    if (active === tab) {
      active = tabs[i] ?? tabs[i - 1] ?? null;
      if (active !== null) activate(active);
    }
    paintBar();
    if (tabs.length === 0) {
      active = null;
      root.hidden = true;
    }
  }

  async function newTab(): Promise<void> {
    roots = await api.roots();
    const first = roots[0];
    if (first === undefined) {
      setEmpty('Pick a work folder first (Settings).');
      return;
    }
    if (roots.length === 1) return openTab(first.path);
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

  function onEvent(e: TermEvent): void {
    const tab = byId(e.id);
    if (e.type === 'data') {
      if (tab !== undefined) return write(tab, e.data);
      // 탭이 만들어지기 전에 도착한 출력: 잠깐 담아 둔다(상한 안에서)
      const list = early.get(e.id) ?? [];
      if (list.reduce((n, s) => n + s.length, 0) < 256 * 1024) list.push(e.data);
      early.set(e.id, list);
      return;
    }
    if (tab === undefined) return;
    if (e.code === 0 || e.code === null) return removeTab(tab);
    tab.exited = true;
    tab.term.write(`\r\n\x1b[2m[Process exited with code ${e.code}. Close this tab with ×.]\x1b[0m\r\n`);
    paintBar();
  }
  api.onEvent(onEvent);
  // 화면이 (다시) 열렸을 때 이전 화면이 남긴 PTY가 있으면 정리한다
  void api.closeAll();

  // ── 찾기 ──
  function openFind(): void {
    if (active === null) return;
    find.hidden = false;
    findInput.focus();
    findInput.select();
    refit();
  }
  function closeFind(): void {
    if (find.hidden) return;
    find.hidden = true;
    active?.search.clearDecorations();
    active?.term.focus();
    refit();
  }
  const runFind = (backwards: boolean): void => {
    const q = findInput.value;
    if (active === null || q === '') return;
    const options = { decorations: { matchOverviewRuler: '#888888', activeMatchColorOverviewRuler: '#888888' } };
    if (backwards) active.search.findPrevious(q, options);
    else active.search.findNext(q, options);
  };
  findInput.addEventListener('input', () => runFind(false));
  findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeFind();
    } else if (isEnterKey(e)) {
      e.preventDefault();
      runFind(e.shiftKey);
    }
  });
  findPrev.addEventListener('click', () => runFind(true));
  findNext.addEventListener('click', () => runFind(false));
  findClose.addEventListener('click', closeFind);
  findBtn.addEventListener('click', () => (find.hidden ? openFind() : closeFind()));

  addBtn.addEventListener('click', () => void newTab());
  hideBtn.addEventListener('click', () => hide());

  // 칸 크기가 바뀌면(창·손잡이·찾기 줄) 열·행을 다시 맞춘다
  new ResizeObserver(() => refit()).observe(body);

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

  function show(): void {
    root.hidden = false;
    refit();
    active?.term.focus();
  }

  return {
    root,
    isOpen: (): boolean => !root.hidden,
    /** 칸을 보이거나 접는다. 처음 보일 때 터미널이 없으면 하나 연다. 접어도 터미널(프로세스)은 계속 돈다. */
    async toggle(): Promise<void> {
      if (!root.hidden) return hide();
      show();
      if (tabs.length === 0) await newTab();
    },
    /** 칸을 보이고 새 터미널을 연다 */
    async create(): Promise<void> {
      show();
      await newTab();
    },
    hide,
    /** 작업 폴더가 바뀌면 열어 둔 터미널을 모두 닫는다 */
    async reset(): Promise<void> {
      await api.closeAll();
      for (const t of [...tabs]) removeTab(t);
      setEmpty(null);
      hide();
    },
  };
}
