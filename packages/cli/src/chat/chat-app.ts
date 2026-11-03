import { Box, Static, Text, useInput, useStdout } from 'ink';
import React, { useEffect, useReducer, useState } from 'react';
import { formatElapsed } from '../live-line.js';
import type { MascotView } from '../mascot.js';
import { menuKey, menuLines } from '../menu.js';
import { displayWidth, fitLines, truncateWidth } from '../text-width.js';
import type { CursorPark, CursorSpot } from './cursor-park.js';
import type { ChatStore, Prompt, Working } from './chat-store.js';
import { suggestCommands } from './commands.js';
import { completeMention, mentionAt, suggestFiles } from './file-mention.js';
import { editInput, inputLayout, moveVertical, type InputState } from './input-line.js';
import { menuWindow } from './menu-window.js';

const h = React.createElement;

/** 사분면 블록 스피너. 한글 글꼴 cmd에서도 한 칸으로 그려진다(-p의 LiveLine과 같다). */
const SPINNER = ['▖', '▘', '▝', '▗'] as const;

/** 1/8 블록 테두리. 선 문자(╭─╮)는 한글 글꼴 cmd에서 가로선이 사라질 때가 있다. */
const BLOCK_BORDER = { topLeft: ' ', top: '▁', topRight: ' ', left: '▕', right: '▏', bottomLeft: ' ', bottom: '▔', bottomRight: ' ' };
const SKY = '#8FD3F7';

/** 창 크기를 바꾸는 동안 여러 번 오는 resize를 모아, 멈춘 뒤 한 번만 다시 그린다. */
const REDRAW_DELAY_MS = 150;
/** 화면과 스크롤을 지우고 커서를 맨 위로. 접혀서 깨진 지난 출력을 남기지 않는다(Claude Code도 이렇게 한다). */
const CLEAR_ALL = '\x1b[2J\x1b[3J\x1b[H';

export interface ChatAppProps {
  readonly store: ChatStore;
  /** 맨 위 시작 박스. 창 너비가 바뀌면 새 너비로 다시 만든다. */
  readonly banner: (columns: number, rows: number) => string;
  readonly view: MascotView | null;
  readonly onSubmit: (text: string) => void;
  /** Ctrl+C를 눌렀을 때 */
  readonly onInterrupt?: () => void;
  /** 진짜 터미널 커서를 입력 자리로 옮기는 곳. 없으면 반전 글자로 커서를 흉내 낸다. */
  readonly cursor?: CursorPark;
  /** 지금 저장소의 파일 목록(@를 치면 후보로 보여 준다). 없으면 @ 자동완성을 하지 않는다. */
  readonly files?: () => readonly string[];
}

function useStore(store: ChatStore): void {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => store.subscribe(rerender), [store]);
}

/** 입력 글과 커서. 커서 자리 글자를 반전해 보여 준다. */
function withCursor(state: InputState): React.ReactNode {
  const chars = [...state.text];
  const at = Math.min(state.cursor, chars.length);
  return h(Text, null, chars.slice(0, at).join(''), h(Text, { inverse: true }, chars[at] ?? ' '), chars.slice(at + 1).join(''));
}

/** 명령·파일 후보를 한 번에 보여 주는 수. 넘치면 고른 것 둘레만 보여 준다. */
const MENU_MAX = 8;

/** 이 높이보다 낮은 창에서는 작은 Delfi(4줄) 대신 한 줄짜리 작업 중 표시를 쓴다. */
const MIN_ROWS_FOR_MINI_DELFI = 16;
/** 작업 줄에서 글 말고 차지하는 칸: 작은 Delfi(2+10칸×배수) + 사이 1 + 스피너·띄어쓰기 3 + 시간(최대 8) + 여유 1 */
const workingChrome = (scale: number) => 15 + 10 * scale;
/** 작은 Delfi를 2배로 키우는 창 높이(2배는 10줄이라 낮은 창에서는 쓰지 않는다) */
const MIN_ROWS_FOR_BIG_DELFI = 40;

function WorkingLine({ working, view, rows, columns }: { working: Working; view: MascotView | null; rows: number; columns: number }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setFrame((f) => f + 1), 120);
    return () => clearInterval(timer);
  }, []);
  const spinner = SPINNER[frame % SPINNER.length]!;
  const elapsed = formatElapsed(Date.now() - working.startedAt);
  const small = rows > 0 && rows < MIN_ROWS_FOR_MINI_DELFI;
  // 작업 줄이 창 너비를 넘어 접히면 Ink가 다시 그릴 때 지울 줄 수가 틀어져 지난 줄이 쌓인다. 그림·스피너·시간 자리를 빼고 한 줄에 맞춘다.
  const scale = rows >= MIN_ROWS_FOR_BIG_DELFI ? 2 : 1;
  const text = truncateWidth(working.text, Math.max(8, columns - workingChrome(scale)));
  const drawn = small ? view?.working(spinner, text, working.role, elapsed) : view?.workingDelfi(spinner, text, working.role, elapsed, frame, scale);
  return h(Text, null, drawn ?? `  ${spinner} ${text} ${elapsed}`);
}

function MenuPrompt({ store, prompt, view, rows }: { store: ChatStore; prompt: Extract<Prompt, { kind: 'menu' }>; view: MascotView | null; rows: number }) {
  const [index, setIndex] = useState(0);
  useInput((input, key) => {
    const next = menuKey(index, { name: key.upArrow ? 'up' : key.downArrow ? 'down' : key.return ? 'return' : key.escape ? 'escape' : input, sequence: input, ctrl: key.ctrl }, prompt.options.length);
    if (next.index >= 0 && next.index !== index) setIndex(next.index);
    if (next.done) store.answer(next.index);
  });
  // 질문 화면이 창 높이 이상이면 Ink가 다시 그릴 때마다 화면을 지우고 지난 출력 전부를 다시 찍는다.
  // 위 여백 1 + 화면 + 빈 줄 1 + 선택지 + 상태 줄 1이 창 높이 미만이어야 하므로, 넘치면 짧은 화면으로 바꾼다.
  const height = (text: string) => text.split('\n').length + prompt.options.length + 3;
  const screenText = rows > 0 && prompt.compactScreen !== undefined && height(prompt.screen) >= rows ? prompt.compactScreen : prompt.screen;
  return h(
    Box,
    { flexDirection: 'column', marginTop: 1 },
    h(Text, null, screenText),
    h(Text, null, ' '),
    ...menuLines(prompt.options, index, view?.highlight).map((line, i) => h(Text, { key: i }, line)),
  );
}

/** 진짜 커서를 spot에 둔다. 화면에서 사라지면 치운다. */
function useParkedCursor(cursor: CursorPark | null, spot: CursorSpot | null): void {
  useEffect(() => {
    cursor?.set(spot);
  }, [cursor, spot?.up, spot?.column]);
  useEffect(() => () => cursor?.set(null), [cursor]);
}

function TextPrompt({ store, prompt, cursor, below }: { store: ChatStore; prompt: Extract<Prompt, { kind: 'text' }>; cursor: CursorPark | null; below: number }) {
  const [state, setState] = useState<InputState>({ text: '', cursor: 0 });
  useInput((input, key) => {
    if (key.return) {
      store.answer(state.text.trim());
      return;
    }
    // 한 줄짜리 답이라 붙여넣은 줄바꿈은 띄어쓰기로 바꾼다(글자 수가 같아 커서 자리는 그대로).
    const next = editInput(state, input, key).state;
    setState({ text: next.text.replaceAll('\n', ' '), cursor: next.cursor });
  });
  const label = `  ${prompt.label}: `;
  const before = [...state.text].slice(0, state.cursor).join('');
  useParkedCursor(cursor, { up: 1 + below, column: displayWidth(label) + displayWidth(before) });
  return h(Box, null, h(Text, { color: SKY }, label), cursor !== null ? h(Text, null, state.text) : withCursor(state));
}

/**
 * 위·아래 화살표로 보낸 입력을 훑는다. at은 지금 보고 있는 기록 자리(null = 쓰던 글).
 * 돌려주는 값: 새 자리, null(쓰던 글로 돌아감), undefined(움직일 곳 없음).
 */
function browseHistory(count: number, at: number | null, direction: 'up' | 'down'): number | null | undefined {
  if (direction === 'up') {
    if (count === 0) return undefined;
    return at === null ? count - 1 : Math.max(0, at - 1);
  }
  if (at === null) return undefined;
  return at < count - 1 ? at + 1 : null;
}

/** below: 입력창 아래에 더 그리는 줄 수(상태 줄). 커서 자리를 그만큼 위로 잡는다. */
function InputBox({ width, history, files, onSubmit, onInterrupt, onEscape, cursor, below }: { width: number; history: readonly string[]; files: (() => readonly string[]) | null; onSubmit: (text: string) => void; onInterrupt: () => void; onEscape: () => void; cursor: CursorPark | null; below: number }) {
  const [state, setState] = useState<InputState>({ text: '', cursor: 0 });
  const [browsing, setBrowsing] = useState<{ at: number; draft: string } | null>(null);
  const [pick, setPick] = useState(0);
  /** Esc로 후보를 닫았을 때의 입력 글. 글이 바뀌면 다시 띄운다. */
  const [dismissed, setDismissed] = useState<string | null>(null);
  // '/'로 시작하는 글을 치는 동안 명령 후보를 띄운다. 명령을 다 쳤으면 띄우지 않는다.
  const candidates = suggestCommands(state.text);
  const commandsShown = candidates.length === 1 && candidates[0]!.name === state.text ? [] : candidates;
  // 명령 후보가 없을 때 커서 앞이 "@검색어"이면 파일 후보를 띄운다(Tab으로 채운다).
  const mention = commandsShown.length === 0 && files !== null ? mentionAt(state) : null;
  const fileMatches = mention !== null && files !== null ? suggestFiles(mention.query, files()) : [];
  const listed = commandsShown.length > 0 ? commandsShown : fileMatches.map((path) => ({ name: `@${path}`, help: '' }));
  const shown = dismissed === state.text ? [] : listed;
  const selected = Math.min(pick, Math.max(0, shown.length - 1));
  const fill = (text: string) => setState({ text, cursor: [...text].length });
  useInput(
    (input, key) => {
      // Claude Code·Kiro처럼 Ctrl+C는 쓰던 글이 있으면 글만 지운다. 빈 입력창의 Ctrl+C·Ctrl+D는 끝내기로 넘긴다.
      if (key.ctrl && (input === 'c' || input === 'd')) {
        if (state.text !== '') {
          if (input === 'c') {
            fill('');
            setBrowsing(null);
            setPick(0);
          }
          return;
        }
        onInterrupt();
        return;
      }
      if (key.escape) {
        // 후보가 떠 있으면 Esc는 후보만 닫는다(쓰던 글은 그대로). 일하는 중 멈추기는 그다음 Esc.
        if (shown.length > 0) return setDismissed(state.text);
        onEscape();
        return;
      }
      if (shown.length > 0 && (key.upArrow || key.downArrow)) {
        // 키를 누르고 있으면 한 번에 여러 개가 온다. 지난 값이 아니라 지금 값에서 옮긴다.
        const step = key.upArrow ? shown.length - 1 : 1;
        setPick((p) => (Math.min(p, shown.length - 1) + step) % shown.length);
        return;
      }
      if (mention !== null && shown.length > 0 && key.tab) {
        setState(completeMention(state, mention, fileMatches[selected]!));
        setPick(0);
        return;
      }
      if (commandsShown.length > 0 && shown.length > 0 && (key.tab || key.return)) {
        const name = shown[selected]!.name;
        setPick(0);
        if (key.tab) return fill(name);
        fill('');
        onSubmit(name);
        return;
      }
      if ((key.upArrow || key.downArrow) && layout.lines.length > 1) {
        // 여러 줄이면 위·아래 화살표는 먼저 줄 사이를 오간다. 맨 위·맨 아래 줄에서만 지난 입력으로 넘어간다.
        const moved = moveVertical(state, layout, key.upArrow ? -1 : 1);
        if (moved !== null) {
          setState(moved);
          return;
        }
      }
      if (key.upArrow || key.downArrow) {
        const next = browseHistory(history.length, browsing?.at ?? null, key.upArrow ? 'up' : 'down');
        if (next === undefined) return;
        if (next === null) {
          fill(browsing?.draft ?? '');
          setBrowsing(null);
          return;
        }
        setBrowsing({ at: next, draft: browsing?.draft ?? state.text });
        fill(history[next]!);
        return;
      }
      const result = editInput(state, input, key);
      setState(result.state);
      if (result.state.text !== state.text) {
        setBrowsing(null);
        setPick(0);
      }
      if (result.submit !== null) onSubmit(result.submit);
    },
  );
  // 테두리 두 칸, 여백 두 칸, '> ' 두 칸을 빼고 접는다. Ink가 따로 접지 않게 미리 접어야 커서 자리를 안다.
  const layout = inputLayout(state, width - 6);
  // 입력 줄 아래에 아래 테두리·명령 후보·상태 줄이 있고, Ink는 그린 뒤 커서를 그다음 줄에 둔다.
  // 후보는 고른 것 둘레만, 넘친 수와 키 안내를 붙여 보여 준다.
  const win = menuWindow(shown.length, selected, MENU_MAX);
  const nameWidth = Math.max(0, ...shown.map((c) => displayWidth(c.name)));
  const menuRows: { key: string; text: string; style: Record<string, unknown> }[] = [
    ...(win.above > 0 ? [{ key: 'above', text: `   ↑ ${win.above}개 더`, style: { dimColor: true } }] : []),
    ...shown.slice(win.start, win.end).map((c, i) => {
      const on = win.start + i === selected;
      const name = c.help === '' ? c.name : c.name + ' '.repeat(nameWidth - displayWidth(c.name));
      return { key: c.name, text: `${on ? ' ❯ ' : '   '}${name}${c.help === '' ? '' : `  ${c.help}`}`, style: on ? { color: SKY, bold: true } : { dimColor: true } };
    }),
    ...(win.below > 0 ? [{ key: 'below', text: `   ↓ ${win.below}개 더`, style: { dimColor: true } }] : []),
    ...(shown.length > 0 ? [{ key: 'hint', text: commandsShown.length > 0 ? '   ↑↓ 고르기 · Enter 실행 · Tab 채우기 · Esc 닫기' : '   ↑↓ 고르기 · Tab 채우기 · Esc 닫기', style: { dimColor: true } }] : []),
  ];
  useParkedCursor(cursor, { up: layout.lines.length - layout.row + 1 + menuRows.length + below, column: 4 + layout.column });
  const offset = layout.offset;
  const line = (text: string, row: number) =>
    h(
      Box,
      { key: row },
      h(Text, { color: SKY }, row === 0 ? '> ' : '  '),
      cursor === null && row === layout.row ? withCursor({ text, cursor: offset }) : h(Text, null, text),
    );
  return h(
    Box,
    { flexDirection: 'column', marginTop: 1 },
    h(
      Box,
      { borderStyle: BLOCK_BORDER, borderColor: SKY, paddingX: 1, width, flexDirection: 'column' },
      layout.lines.map(line),
    ),
    // 후보 줄은 접히면 커서 자리가 틀어져서 넘치는 설명은 자른다.
    ...menuRows.map((row) => h(Text, { key: row.key, wrap: 'truncate', ...row.style }, row.text)),
  );
}

interface Screen {
  /** 다시 그린 횟수. 바뀌면 Static을 새로 올려 지난 출력을 처음부터 다시 찍는다. */
  readonly redraws: number;
  readonly columns: number;
  readonly rows: number;
}

/**
 * 창 크기가 바뀌고 잠잠해지면 화면을 지우고 다시 그리게 한다. 접힌 지난 줄은 지우는 것 말고 고칠 길이 없다.
 * clears가 바뀌어도(/clear, Ctrl+L) 같은 방법으로 화면과 스크롤을 지우고 새로 그린다.
 */
function useScreen(clears: number): Screen {
  const { stdout, write } = useStdout();
  const size = () => ({ columns: stdout.columns || 80, rows: stdout.rows || 0 });
  const [screen, setScreen] = useState<Screen>({ redraws: 0, ...size() });
  useEffect(() => {
    if (clears === 0) return;
    write(CLEAR_ALL);
    setScreen((s) => ({ ...s, redraws: s.redraws + 1 }));
  }, [clears]);
  useEffect(() => {
    let timer: NodeJS.Timeout | undefined;
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        write(CLEAR_ALL);
        setScreen((s) => ({ redraws: s.redraws + 1, ...size() }));
      }, REDRAW_DELAY_MS);
    };
    stdout.on('resize', onResize);
    return () => {
      clearTimeout(timer);
      stdout.off('resize', onResize);
    };
  }, [stdout]);
  return screen;
}

/**
 * 대화 모드 화면. 지나간 출력은 Static으로 한 번만 그리고(스크롤로 남음), 아래쪽(일하는 중, 질문, 입력창)만
 * 다시 그린다. Claude Code처럼 입력창은 화면 맨 아래에 붙인다: 지난 출력이 화면을 다 채우기 전에는
 * 그 사이를 빈 줄로 채운다. 그러려면 지난 출력이 몇 줄인지 알아야 해서, 고정 줄은 미리 창 너비로 접어 둔다.
 */
export function ChatApp({ store, banner, view, onSubmit, onInterrupt, cursor, files }: ChatAppProps) {
  useStore(store);
  const screen = useScreen(store.clears);
  const prompt = store.prompt;
  const typing = prompt === null;
  // Ctrl+C는 바로 끝내지 않는다: 일하는 중이면 그 작업만 멈추고, 쉬는 중이면 한 번 더 눌러야 끝난다(run-chat이 정한다).
  // 입력창이 받는 중에는 입력창이 Ctrl+C를 맡는다(쓰던 글부터 지운다).
  // Ctrl+L은 터미널처럼 화면만 비운다(대화는 그대로).
  useInput((input, key) => {
    if (key.ctrl && input === 'c' && !typing) onInterrupt?.();
    if (key.ctrl && input === 'l') store.clearScreen();
  });
  const submit = (text: string) => {
    store.remember(text);
    onSubmit(text);
  };
  const below = (store.status !== '' ? 1 : 0) + (store.notice !== '' ? 1 : 0);
  // 마지막 칸까지 채운 줄은 터미널이 한 번 더 접어서 한 칸을 비운다. 빈 줄은 ' '로(빈 글은 높이가 0).
  const lines = [banner, ...store.lines]
    .map((item) => (typeof item === 'function' ? item(screen.columns, screen.rows) : item))
    .flatMap((item) => fitLines(item, screen.columns - 1))
    .map((line) => line || ' ');
  // 그린 뒤 커서가 한 줄 더 내려가므로 화면 높이보다 한 줄 적게 채운다.
  const fill = Math.max(0, screen.rows - 1 - lines.length);
  return h(
    Box,
    { flexDirection: 'column' },
    h(Static<string>, { key: screen.redraws, items: lines, children: (line: string, i: number) => h(Text, { key: i }, line) }),
    h(
      Box,
      { flexDirection: 'column', justifyContent: 'flex-end', minHeight: fill },
      // 질문이 떠 있는 동안은 일이 멈춰 기다리는 중이라 작업 중 줄을 감춘다(돌아가는 스피너가 화면을 계속 다시 그리게 하지 않는다).
      store.working !== null && prompt === null ? h(WorkingLine, { working: store.working, view, rows: screen.rows, columns: screen.columns }) : null,
      prompt?.kind === 'menu' ? h(MenuPrompt, { key: prompt.screen, store, prompt, view, rows: screen.rows }) : null,
      prompt?.kind === 'text' ? h(TextPrompt, { key: prompt.label, store, prompt, cursor: cursor ?? null, below }) : null,
      // 일하는 중에 받아 둔 입력. 지금 일이 끝나면 차례로 처리한다.
      ...(prompt === null ? store.queue.map((text, i) => h(Text, { key: `q${i}`, dimColor: true, wrap: 'truncate-end' }, `  대기 ${i + 1}  ${text}`)) : []),
      prompt === null ? h(InputBox, { width: Math.max(20, screen.columns - 1), history: store.history, files: files ?? null, onSubmit: submit, onInterrupt: () => onInterrupt?.(), onEscape: () => store.busy && onInterrupt?.(), cursor: cursor ?? null, below }) : null,
      // 한 줄로 자른다: 접히면 줄 수가 늘어 입력창 위치와 커서 자리가 틀어진다.
      store.status !== '' ? h(Text, { dimColor: true, wrap: 'truncate-end' }, ` ${store.status}`) : null,
      store.notice !== '' ? h(Text, { color: SKY, wrap: 'truncate-end' }, ` ${store.notice}`) : null,
    ),
  );
}
