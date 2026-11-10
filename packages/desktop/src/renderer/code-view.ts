import { codeFailText, type CodeApi, type RepoInfo, type SearchFileHits } from '../shared/code-api.js';
import { ChangeMap } from '../shared/code-changes.js';
import { rankFiles } from '../shared/quick-open.js';
import { defaultIndentSize, languageOf, type CodeLanguage } from '../shared/code-language.js';
import { chooseIndent, detectIndent, type Indent } from '../shared/indent.js';
import { baseName, OpenFile, OpenFiles, tabLabels } from '../shared/open-files.js';
import { remapOpen, isSameOrUnder } from '../shared/code-ops.js';
import type { RepoRow } from '../shared/ipc.js';
import { ask } from './code-dialog.js';
import { createFileOps } from './code-file-ops.js';
import { codeIcon, type CodeIcon } from './code-icons.js';
import { CodeEditor } from './code-editor.js';
import { CodeTreeView } from './code-tree-view.js';
import { buildTerminal } from './terminal-view.js';
import type { TerminalApi } from '../shared/terminal-api.js';
import { el, isEnterKey } from './dom.js';
import { iconByName } from './file-icons.js';

export interface CodeDeps {
  readonly api: CodeApi;
  /** 지금 작업 폴더(없으면 null) */
  readonly workFolder: () => Promise<string | null>;
  readonly platform: string;
  readonly terminal: TerminalApi;
  /** 이 레포를 git 탭에서 열어 달라(레포 루트 절대 경로) */
  readonly openGit: (repoRoot: string) => void;
  /** 작업 폴더 안의 레포·문서 폴더와 상태(탐색기 레포 노드) */
  readonly repos: () => Promise<readonly RepoRow[]>;
}

interface FileInfo {
  readonly language: CodeLanguage;
  readonly indent: Indent;
  readonly readOnly: boolean;
  readonly mixedEol: boolean;
}

const LANGUAGE_NAMES: Readonly<Record<CodeLanguage, string>> = {
  plain: '일반 글', javascript: 'JavaScript', typescript: 'TypeScript', jsx: 'JavaScript JSX', tsx: 'TypeScript JSX', json: 'JSON', css: 'CSS', html: 'HTML', markdown: 'Markdown',
  python: 'Python', java: 'Java', yaml: 'YAML', xml: 'XML', sql: 'SQL', rust: 'Rust', cpp: 'C/C++', go: 'Go', shell: '셸', toml: 'TOML', properties: '설정', dockerfile: 'Dockerfile',
};

const INDENT_SOURCE = { editorconfig: '.editorconfig', detected: '파일에서 알아냄', default: '기본값' } as const;

/**
 * 코드 탭: 왼쪽 탐색기, 오른쪽에 파일 탭들과 편집기. 파일 읽기·쓰기는 전부 main(api)이 한다.
 * 이 화면은 한 번만 만들어 탭을 오가도 열어 둔 파일과 수정 중인 글이 그대로 남는다.
 */
export function buildCode(deps: CodeDeps) {
  const root = el('div', 'code');
  const explorer = el('aside', 'code-explorer');
  const main = el('section', 'code-main');
  root.append(explorer, main);

  // ── 탐색기 ──
  const head = el('div', 'code-ehead');
  const modeFiles = el('button', 'tab sm on', '탐색기');
  const modeSearch = el('button', 'tab sm', '검색');
  const headName = el('b', 'code-folder');
  const refreshBtn = el('button', 'btn ghost icon sm', '↻');
  refreshBtn.title = '목록 새로 고침';
  head.append(modeFiles, modeSearch, headName, refreshBtn);
  const tools = el('div', 'code-tools');
  const toolBtn = (kind: CodeIcon, title: string, run: () => void): HTMLButtonElement => {
    const b = el('button', 'btn ghost icon sm');
    b.type = 'button';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.append(codeIcon(kind));
    b.addEventListener('click', run);
    tools.append(b);
    return b;
  };
  const tree = new CodeTreeView({
    api: deps.api,
    open: (p) => void openPath(p),
    contextMenu: (t, x, y) => ops.menuFor(t, x, y),
    key: (e, t) => ops.key(e, t),
    drop: (path, dest) => void ops.move(path, dest),
    openGit: (r) => deps.openGit(r),
    reloadRepos: () => void loadRepos(),
    caseInsensitive: deps.platform === 'win32' || deps.platform === 'darwin',
    onPick: (t) => paintTools(t),
    refused: (name, reason) => say(`${name}: ${codeFailText(reason)}`),
  });
  const newFileBtn = toolBtn('newFile', '새 파일', () => void ops.create('file'));
  const newDirBtn = toolBtn('newFolder', '새 폴더', () => void ops.create('dir'));
  const renameBtn = toolBtn('rename', '이름 바꾸기 (F2)', () => void ops.rename());
  const dupBtn = toolBtn('duplicate', '복제', () => void ops.duplicate());
  const moveBtn = toolBtn('move', '다른 폴더로 옮기기', () => {
    const t = tree.selection();
    if (t !== null && t.kind !== 'root') void ops.move(t.path);
  });
  const delBtn = toolBtn('trash', '휴지통으로 보내기 (Delete)', () => void ops.remove());
  void newFileBtn;
  void newDirBtn;
  function paintTools(t: { kind: string } | null): void {
    const none = t === null || t.kind === 'root';
    for (const b of [renameBtn, dupBtn, moveBtn, delBtn]) b.disabled = none;
  }
  paintTools(null);
  const searchPanel = el('div', 'code-search');
  searchPanel.hidden = true;
  const searchRow = el('div', 'cs-row');
  const searchInput = el('input', 'cs-input');
  searchInput.placeholder = '작업 폴더에서 찾기';
  searchInput.spellcheck = false;
  const caseBtn = el('button', 'btn ghost icon sm cs-opt', 'Aa');
  caseBtn.title = '대소문자 구분';
  const regexBtn = el('button', 'btn ghost icon sm cs-opt', '.*');
  regexBtn.title = '정규식';
  searchRow.append(searchInput, caseBtn, regexBtn);
  const searchSummary = el('div', 'cs-summary');
  const searchResults = el('div', 'cs-results');
  searchPanel.append(searchRow, searchSummary, searchResults);
  explorer.append(head, tools, tree.root, searchPanel);

  // ── 오른쪽 ──
  const bar = el('div', 'code-bar');
  const toggle = el('button', 'btn ghost icon sm code-toggle', '☰');
  toggle.title = '탐색기 접기/펴기';
  const strip = el('div', 'code-tabs');
  const termBtn = el('button', 'btn ghost icon sm code-termbtn', '>_');
  termBtn.title = '터미널 (Ctrl/Cmd+`)';
  bar.append(toggle, strip, termBtn);
  const notice = el('div', 'code-notice');
  notice.hidden = true;
  const host = el('div', 'code-host');
  const empty = el('div', 'code-empty');
  empty.append(el('b', undefined, '파일을 골라 열어 보세요'), el('span', undefined, '왼쪽 탐색기에서 파일을 누르면 여기서 고칠 수 있어요.'), el('span', 'dim', 'Ctrl/Cmd+S 저장 · Ctrl/Cmd+F 찾기'));
  const status = el('div', 'code-status');
  const sPath = el('span', 'sp');
  const sRight = el('span', 'sr');
  status.append(sPath, sRight);
  const term = buildTerminal(deps.terminal);
  termBtn.addEventListener('click', () => void term.toggle());
  main.append(bar, notice, host, empty, term.root, status);

  let tabs = OpenFiles.empty();
  const info = new Map<string, FileInfo>();
  const saving = new Set<string>();
  let cursor = { line: 1, column: 1 };
  let folder: string | null | undefined;
  let flash: { text: string; timer: number } | null = null;
  let changeMap = ChangeMap.empty();
  let repos: readonly RepoInfo[] = [];

  const editor = new CodeEditor(host, {
    onChange: () => paintDirty(),
    onCursor: (line, column) => {
      cursor = { line, column };
      paintStatus();
    },
  });

  const isDirty = (path: string): boolean => {
    const f = tabs.get(path);
    const len = editor.lengthOf(path);
    if (f === undefined || len === null) return false;
    if (len !== f.savedText.length) return true;
    return f.isDirty(editor.textOf(path) ?? f.savedText);
  };

  // ── 그리기 ──
  function say(text: string): void {
    if (flash !== null) clearTimeout(flash.timer);
    flash = { text, timer: window.setTimeout(() => ((flash = null), paintNotice()), 7000) };
    paintNotice();
  }

  /** 앞서 띄운 안내(거부 이유 등)를 바로 거둔다. 다른 파일로 넘어가면 옛 안내를 남기지 않는다. */
  function clearSay(): void {
    if (flash === null) return;
    clearTimeout(flash.timer);
    flash = null;
  }

  function paintNotice(): void {
    notice.replaceChildren();
    const active = tabs.active === null ? undefined : tabs.get(tabs.active);
    const lines: HTMLElement[] = [];
    if (flash !== null) lines.push(el('div', 'note warn', flash.text));
    if (active !== undefined) {
      const fi = info.get(active.path);
      if (active.stale) {
        const line = el('div', 'note warn');
        line.append(el('span', undefined, '디스크에서 이 파일이 바뀌었거나 지워졌어요. '));
        const reload = el('button', 'btn sm', '디스크 내용 불러오기');
        reload.addEventListener('click', () => void revert(active.path, true));
        line.append(reload);
        lines.push(line);
      }
      if (fi?.readOnly === true) lines.push(el('div', 'note', '쓰기 권한이 없는 파일이라 읽기 전용으로 열었어요.'));
      if (fi?.mixedEol === true) lines.push(el('div', 'note', '줄 끝이 섞여 있어요. 저장하면 한 가지로 통일돼요.'));
    }
    notice.replaceChildren(...lines);
    notice.hidden = lines.length === 0;
  }

  function paintTabs(): void {
    const labels = tabLabels(tabs.files.map((f) => f.path));
    strip.replaceChildren();
    for (const f of tabs.files) {
      const t = el('div', 'code-tab');
      t.classList.toggle('on', f.path === tabs.active);
      t.title = f.path;
      t.dataset['path'] = f.path;
      const dirty = isDirty(f.path);
      const close = el('button', 'btn ghost icon sm code-x');
      close.title = dirty ? '수정됨 — 닫기' : '닫기';
      close.textContent = dirty ? '●' : '×';
      close.classList.toggle('dirty', dirty);
      close.addEventListener('click', (e) => {
        e.stopPropagation();
        void closeTab(f.path);
      });
      t.append(iconByName(baseName(f.path), false), el('span', 'code-tab-name', (labels.get(f.path) ?? f.path) + (f.stale ? ' !' : '')), close);
      t.addEventListener('click', () => activate(f.path));
      t.addEventListener('auxclick', (e) => {
        if (e.button === 1) void closeTab(f.path);
      });
      strip.append(t);
    }
    strip.querySelector('.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  /** 글을 칠 때마다 탭 전체를 다시 그리지 않고 수정 표시(●)만 갱신한다 */
  function paintDirty(): void {
    const path = tabs.active;
    if (path === null) return;
    const dirty = isDirty(path);
    const x = strip.querySelector<HTMLElement>(`.code-tab[data-path="${CSS.escape(path)}"] .code-x`);
    if (x !== null && x.classList.contains('dirty') !== dirty) {
      x.classList.toggle('dirty', dirty);
      x.textContent = dirty ? '●' : '×';
    }
    paintStatus();
  }

  function paintStatus(): void {
    const path = tabs.active;
    const f = path === null ? undefined : tabs.get(path);
    empty.hidden = f !== undefined;
    host.hidden = f === undefined;
    status.hidden = f === undefined;
    if (f === undefined || path === null) return;
    const fi = info.get(path);
    sPath.textContent = path;
    const ind = fi === undefined ? '' : `${fi.indent.unit === 'tab' ? '탭' : '스페이스'} ${fi.indent.size} (${INDENT_SOURCE[fi.indent.source]})`;
    const parts = [`줄 ${cursor.line}, 칸 ${cursor.column}`, ind, f.eol === 'crlf' ? 'CRLF' : 'LF', f.bom ? 'UTF-8 BOM' : 'UTF-8', LANGUAGE_NAMES[fi?.language ?? 'plain'], isDirty(path) ? '수정됨' : '저장됨'];
    sRight.textContent = parts.filter((p) => p !== '').join('   ');
    const repo = repoOf(path);
    if (repo !== null) {
      const link = el('button', 'link', changeMap.statusOf(path) === null ? 'git에서 보기' : '변경됨 · git에서 보기');
      link.addEventListener('click', () => deps.openGit(repo.root));
      sRight.append(link);
    }
  }

  /** 이 파일이 든 가장 깊은 레포(작업 폴더 기준 경로로 비교) */
  function repoOf(path: string): RepoInfo | null {
    let best: RepoInfo | null = null;
    for (const r of repos) {
      const inside = r.path === '' || path === r.path || path.startsWith(`${r.path}/`);
      if (inside && (best === null || r.path.length > best.path.length)) best = r;
    }
    return best;
  }

  /** git 변경 표시(탐색기 M/A/U)를 새로 받아 입힌다 */
  async function refreshChanges(): Promise<void> {
    const r = await deps.api.changes();
    if (!r.ok) return;
    changeMap = ChangeMap.of(r.files);
    repos = r.repos;
    tree.setChanges(changeMap);
    paintStatus();
  }

  /** 열어 둔 파일의 바뀐 줄(왼쪽 표시). 저장된 내용 기준이다. */
  async function refreshMarks(path: string): Promise<void> {
    if (!tabs.has(path)) return;
    const r = await deps.api.diff(path);
    if (r.ok && tabs.has(path)) editor.setMarks(path, r.marks);
  }

  function paintAll(): void {
    paintTabs();
    paintNotice();
    paintStatus();
    tree.setActive(tabs.active);
  }

  // ── 열기·전환·닫기 ──
  function activate(path: string): void {
    clearSay();
    tabs = tabs.activated(path);
    editor.show(path);
    paintAll();
    editor.focus();
    void refreshMarks(path);
  }

  function register(path: string, text: string, i: FileInfo): void {
    info.set(path, i);
    editor.replace(path, text, i.language, i.indent, i.readOnly);
  }

  async function openPath(path: string): Promise<void> {
    if (tabs.has(path)) {
      activate(path);
      closeExplorerWhenNarrow();
      return;
    }
    const r = await deps.api.read(path);
    if (!r.ok) {
      say(`${baseName(path)}: ${codeFailText(r.reason)}`);
      return;
    }
    if (tabs.has(path)) return activate(path); // 읽는 사이에 이미 열렸다
    clearSay();
    const language = languageOf(baseName(path));
    const indent = chooseIndent(r.editorConfig, detectIndent(r.text), defaultIndentSize(language));
    register(path, r.text, { language, indent, readOnly: r.readOnly, mixedEol: r.mixedEol });
    tabs = tabs.opened(OpenFile.opened(path, r.text, r.version, r.eol, r.bom));
    editor.show(path);
    paintAll();
    editor.focus();
    closeExplorerWhenNarrow();
    void refreshMarks(path);
  }

  async function closeTab(path: string): Promise<void> {
    if (isDirty(path)) {
      const name = baseName(path);
      const answer = await ask(`${name} 저장할까요?`, '저장하지 않고 닫으면 고친 내용이 사라져요.', [
        { id: 'save', label: '저장하고 닫기', kind: 'primary' },
        { id: 'discard', label: '저장 안 함', kind: 'danger' },
        { id: 'cancel', label: '취소' },
      ]);
      if (answer === 'cancel') return;
      if (answer === 'save' && !(await save(path))) return;
    }
    const wasActive = tabs.active === path;
    tabs = tabs.closed(path);
    editor.remove(path);
    info.delete(path);
    if (wasActive && tabs.active !== null) editor.show(tabs.active);
    else if (tabs.active === null) editor.hide();
    paintAll();
  }

  // ── 저장·되돌리기 ──
  /** 저장한다. 저장됐으면 true. 충돌·지워짐은 사용자에게 물어 덮어쓰기를 고르면 다시 쓴다. */
  async function save(path: string): Promise<boolean> {
    const f = tabs.get(path);
    if (f === undefined || saving.has(path)) return false;
    const text = editor.textOf(path);
    if (text === null) return false;
    if (!isDirty(path)) return true;
    saving.add(path);
    try {
      let overwrite = false;
      for (;;) {
        const r = await deps.api.write({ path, text, eol: f.eol, bom: f.bom, baseVersion: tabs.get(path)?.version ?? f.version, overwrite });
        if (r.ok) {
          tabs = tabs.updated(path, (x) => x.saved(text, r.version));
          paintAll();
          void refreshMarks(path);
          void refreshChanges();
          return true;
        }
        if ((r.reason === 'conflict' || r.reason === 'deleted') && !overwrite) {
          const gone = r.reason === 'deleted';
          const answer = await ask(gone ? '디스크에서 지워진 파일이에요' : '디스크에서 이 파일이 바뀌었어요', gone ? '저장하면 이 파일을 다시 만들어요.' : '내 내용으로 덮어쓰면 다른 곳에서 고친 내용이 사라져요. 디스크 내용을 불러오면 내가 고친 내용이 사라져요.', [
            { id: 'overwrite', label: gone ? '다시 만들어 저장' : '내 내용으로 덮어쓰기', kind: 'danger' },
            ...(gone ? [] : [{ id: 'reload', label: '디스크 내용 불러오기' }]),
            { id: 'cancel', label: '취소' },
          ]);
          if (answer === 'overwrite') {
            overwrite = true;
            continue;
          }
          if (answer === 'reload') await revert(path, true);
          return false;
        }
        const detail = r.detail === undefined ? '' : ` (${r.detail})`;
        say(`${baseName(path)}를 저장하지 못했어요. ${codeFailText(r.reason)}${detail} 고친 내용은 그대로 남아 있어요.`);
        return false;
      }
    } finally {
      saving.delete(path);
    }
  }

  /** 마지막 저장 상태(디스크 내용)로 되돌린다. 수정 중이면 먼저 확인한다. */
  async function revert(path: string, skipAsk = false): Promise<void> {
    if (!skipAsk && isDirty(path)) {
      const answer = await ask('고친 내용을 버릴까요?', '디스크에 저장된 내용으로 되돌려요. 고친 내용은 사라져요.', [
        { id: 'revert', label: '되돌리기', kind: 'danger' },
        { id: 'cancel', label: '취소' },
      ]);
      if (answer !== 'revert') return;
    }
    const r = await deps.api.read(path);
    if (!r.ok) {
      say(`${baseName(path)}: ${codeFailText(r.reason)}`);
      return;
    }
    const language = languageOf(baseName(path));
    register(path, r.text, { language, indent: chooseIndent(r.editorConfig, detectIndent(r.text), defaultIndentSize(language)), readOnly: r.readOnly, mixedEol: r.mixedEol });
    tabs = tabs.updated(path, (f) => f.reloaded(r.text, r.version, r.eol, r.bom));
    if (tabs.active === path) editor.show(path);
    paintAll();
    void refreshMarks(path);
    void refreshChanges();
  }

  /** 디스크에서 바뀐 파일을 찾는다. 안 고친 탭은 조용히 새로 읽고, 고치던 탭은 알림만 띄운다. */
  async function checkDisk(): Promise<void> {
    void refreshChanges();
    const paths = tabs.files.map((f) => f.path);
    if (paths.length === 0) return;
    const versions = await deps.api.stat(paths);
    for (const path of paths) {
      const f = tabs.get(path);
      if (f === undefined || saving.has(path)) continue;
      const now = versions[path] ?? null;
      if (now === f.version) continue;
      if (now !== null && !isDirty(path)) await revert(path, true);
      else tabs = tabs.updated(path, (x) => x.markedStale());
    }
    paintAll();
  }

  // ── 탐색기 접기(좁은 창에서는 편집기 우선) ──
  const narrow = (): boolean => ['s', 'xs'].includes(document.querySelector<HTMLElement>('.app')?.dataset['tier'] ?? '');
  function closeExplorerWhenNarrow(): void {
    if (narrow()) root.classList.remove('explorer-open');
  }
  toggle.addEventListener('click', () => {
    if (narrow()) root.classList.toggle('explorer-open');
    else root.classList.toggle('explorer-hidden');
  });
  refreshBtn.addEventListener('click', () => {
    void tree.refresh();
    void loadRepos();
  });

  // ── 탐색기 / 검색 전환 ──
  function setMode(mode: 'files' | 'search'): void {
    modeFiles.classList.toggle('on', mode === 'files');
    modeSearch.classList.toggle('on', mode === 'search');
    tree.root.hidden = mode !== 'files';
    tools.hidden = mode !== 'files';
    searchPanel.hidden = mode !== 'search';
    refreshBtn.hidden = mode !== 'files';
    if (mode === 'search') {
      if (narrow()) root.classList.add('explorer-open');
      else root.classList.remove('explorer-hidden');
      searchInput.focus();
      searchInput.select();
    }
  }
  modeFiles.addEventListener('click', () => setMode('files'));
  modeSearch.addEventListener('click', () => setMode('search'));

  // ── 전체 찾기 ──
  let caseOn = false;
  let regexOn = false;
  let searchSeq = 0;
  let searchTimer = 0;
  caseBtn.addEventListener('click', () => {
    caseOn = !caseOn;
    caseBtn.classList.toggle('on', caseOn);
    void runSearch();
  });
  regexBtn.addEventListener('click', () => {
    regexOn = !regexOn;
    regexBtn.classList.toggle('on', regexOn);
    void runSearch();
  });
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => void runSearch(), 350);
  });
  searchInput.addEventListener('keydown', (e) => {
    if (!isEnterKey(e)) return;
    clearTimeout(searchTimer);
    void runSearch();
  });

  async function runSearch(): Promise<void> {
    const query = searchInput.value;
    const seq = ++searchSeq;
    if (query === '') {
      searchSummary.textContent = '';
      searchResults.replaceChildren();
      return;
    }
    searchSummary.textContent = '찾는 중…';
    const r = await deps.api.search({ query, caseSensitive: caseOn, regex: regexOn });
    if (seq !== searchSeq) return;
    if (!r.ok) {
      searchResults.replaceChildren();
      searchSummary.textContent = r.reason === 'bad-regex' ? '정규식이 올바르지 않아요.' : r.reason === 'empty' ? '' : codeFailText(r.reason);
      return;
    }
    const hitCount = r.files.reduce((n, f) => n + f.hits.length, 0);
    searchSummary.textContent = hitCount === 0 ? '찾은 곳이 없어요.' : `${r.files.length}개 파일에서 ${hitCount}곳${r.truncated ? ' (너무 많아 일부만 보여요)' : ''}`;
    searchResults.replaceChildren(...r.files.map(resultGroup));
  }

  function resultGroup(f: SearchFileHits): HTMLElement {
    const group = el('div', 'cs-file');
    const title = el('div', 'cs-path');
    title.append(iconByName(baseName(f.path), false), el('b', undefined, baseName(f.path)), el('span', 'dim', f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : ''), el('span', 'chip cs-count', String(f.hits.length)));
    title.title = f.path;
    group.append(title);
    for (const h of f.hits) {
      const row = el('button', 'cs-hit');
      row.type = 'button';
      const text = el('span', 'cs-text');
      text.append(h.preview.slice(0, h.start), el('mark', undefined, h.preview.slice(h.start, h.end)), h.preview.slice(h.end));
      row.append(el('span', 'cs-line', String(h.line)), text);
      row.addEventListener('click', () => void openAt(f.path, h.line, h.column));
      group.append(row);
    }
    return group;
  }

  /** 파일을 열고 그 줄·칸으로 간다 */
  async function openAt(path: string, line: number, column: number): Promise<void> {
    await openPath(path);
    if (tabs.active === path) editor.goto(line, column);
  }

  // ── 빠른 열기(Ctrl/Cmd+P) ──
  let quick: { close: () => void } | null = null;
  let fileCache: { at: number; paths: readonly string[] } | null = null;
  const FILE_CACHE_MS = 15_000;

  async function openQuick(): Promise<void> {
    if (quick !== null) return;
    const veil = el('div', 'qo-veil');
    const box = el('div', 'qo');
    const input = el('input', 'qo-input');
    input.placeholder = '파일 이름으로 열기';
    input.spellcheck = false;
    const list = el('div', 'qo-list');
    box.append(input, list);
    veil.append(box);
    root.append(veil);
    let shown: string[] = [];
    let index = 0;
    let all: readonly string[] = fileCache?.paths ?? [];
    const close = (): void => {
      veil.remove();
      quick = null;
      if (tabs.active !== null) editor.focus();
    };
    quick = { close };
    const paint = (): void => {
      shown = rankFiles(input.value, all, 50);
      index = Math.min(index, Math.max(0, shown.length - 1));
      list.replaceChildren();
      if (shown.length === 0) list.append(el('div', 'qo-empty', all.length === 0 ? '파일을 찾는 중…' : '맞는 파일이 없어요.'));
      shown.forEach((p, i) => {
        const row = el('button', `qo-row${i === index ? ' on' : ''}`);
        row.type = 'button';
        const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
        row.append(iconByName(baseName(p), false), el('b', undefined, baseName(p)), el('span', 'dim', dir));
        const st = changeMap.statusOf(p);
        if (st !== null) row.append(el('span', `tree-badge chg-${st}`, st));
        row.addEventListener('click', () => {
          close();
          void openPath(p);
        });
        list.append(row);
      });
      list.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
    };
    input.addEventListener('input', () => {
      index = 0;
      paint();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (shown.length > 0) index = (index + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length;
        paint();
      } else if (isEnterKey(e)) {
        e.preventDefault();
        const p = shown[index];
        close();
        if (p !== undefined) void openPath(p);
      }
    });
    veil.addEventListener('mousedown', (e) => {
      if (e.target === veil) close();
    });
    paint();
    input.focus();
    if (fileCache === null || Date.now() - fileCache.at > FILE_CACHE_MS) {
      const r = await deps.api.files();
      if (r.ok) {
        fileCache = { at: Date.now(), paths: r.paths };
        all = r.paths;
        if (quick !== null) paint();
      }
    }
  }

  // ── 키 ──
  window.addEventListener('keydown', (e) => {
    if (!root.isConnected || root.offsetParent === null) return;
    const mod = deps.platform === 'darwin' ? e.metaKey : e.ctrlKey;
    if (!mod || e.altKey) return;
    const key = e.key.toLowerCase();
    if (e.key === '`' || e.code === 'Backquote') {
      e.preventDefault();
      void term.toggle();
      return;
    }
    if (!e.shiftKey && key === 's') {
      e.preventDefault();
      if (tabs.active !== null) void save(tabs.active);
    } else if (!e.shiftKey && key === 'p') {
      e.preventDefault();
      void openQuick();
    } else if (e.shiftKey && key === 'f') {
      e.preventDefault();
      setMode('search');
    }
  });
  window.addEventListener('focus', () => {
    if (root.isConnected && root.offsetParent !== null) void checkDisk();
  });

  async function loadTree(): Promise<void> {
    const next = await deps.workFolder();
    if (next === null) {
      headName.textContent = '탐색기';
      tree.root.replaceChildren(el('div', 'tree-note', codeFailText('no-folder')));
      folder = next;
      return;
    }
    headName.textContent = baseName(next.replace(/[\\/]+$/, '').replace(/\\/g, '/')).toUpperCase();
    folder = next;
    void loadRepos();
    await tree.refresh();
    tree.setActive(tabs.active);
  }

  /** 작업 폴더가 바뀌면 열어 둔 파일은 다른 폴더의 파일이 되므로 모두 닫는다(저장 안 한 것은 버려지니 알린다). */
  function dropAll(): void {
    const lost = tabs.files.filter((f) => isDirty(f.path)).map((f) => baseName(f.path));
    for (const f of tabs.files) {
      editor.remove(f.path);
      info.delete(f.path);
    }
    tabs = OpenFiles.empty();
    void term.reset();
    editor.hide();
    paintAll();
    if (lost.length > 0) say(`작업 폴더가 바뀌어 열어 둔 파일을 닫았어요. 저장 안 한 ${lost.join(', ')}의 수정은 사라졌어요.`);
  }

  // ── 레포 노드 ──
  let repoRows: readonly RepoRow[] = [];
  let repoSeq = 0;
  /** 작업 폴더의 레포·문서 폴더 정보를 읽어 탐색기 줄에 입힌다(git을 불러 느릴 수 있어 화면은 먼저 그린다) */
  async function loadRepos(): Promise<void> {
    const seq = ++repoSeq;
    try {
      const rows = await deps.repos();
      if (seq !== repoSeq) return;
      repoRows = rows;
      tree.setRepos(rows);
    } catch {
      /* 못 읽으면 레포 정보 없이 파일 트리만 보인다 */
    }
  }

  // ── 파일 조작(탐색기) ──
  /** 이름이 바뀌거나 옮겨진 파일의 탭이 새 경로로 이어진다. 확장자가 달라 언어가 바뀌면 색칠도 새로 한다. */
  function moveTabs(from: string, to: string): void {
    const moves = remapOpen(tabs.files.map((f) => f.path), from, to);
    if (moves.length === 0) return;
    for (const m of moves) {
      editor.rename(m.from, m.to);
      const old = info.get(m.from);
      info.delete(m.from);
      if (old === undefined) continue;
      const language = languageOf(baseName(m.to));
      info.set(m.to, { ...old, language });
      if (language !== old.language) editor.replace(m.to, editor.textOf(m.to) ?? '', language, old.indent, old.readOnly);
    }
    tabs = tabs.moved(from, to);
    paintAll();
    void refreshChanges();
  }

  /** 지워진 경로 안의 탭을 닫는다. keepUnsaved면 수정 중인 탭만 남겨 "지워졌어요"로 표시한다. */
  function dropTabs(path: string, keepUnsaved: boolean): void {
    for (const f of tabs.files.filter((x) => isSameOrUnder(x.path, path))) {
      if (keepUnsaved && isDirty(f.path)) {
        tabs = tabs.updated(f.path, (x) => x.markedStale());
        continue;
      }
      editor.remove(f.path);
      info.delete(f.path);
      tabs = tabs.closed(f.path);
    }
    if (tabs.active === null) editor.hide();
    else editor.show(tabs.active);
    paintAll();
  }

  const ops = createFileOps({
    api: deps.api,
    tree,
    platform: deps.platform,
    workFolder: () => folder ?? null,
    repos: () => repoRows,
    openPaths: () => tabs.files.map((f) => f.path),
    dirtyPaths: () => tabs.files.filter((f) => isDirty(f.path)).map((f) => f.path),
    tabsMoved: moveTabs,
    tabsDeleted: dropTabs,
    say,
    refresh: async () => {
      fileCache = null;
      await tree.refresh();
      tree.setActive(tabs.active);
      void refreshChanges();
    },
    open: (p) => void openPath(p),
    openGit: (r) => deps.openGit(r),
    reloadRepos: () => void loadRepos(),
  });

  paintAll();
  return {
    root,
    /** 코드 탭을 열 때마다: 작업 폴더가 바뀌었으면 다시 읽고, 디스크에서 바뀐 파일을 살핀다 */
    async onShow(): Promise<void> {
      const next = await deps.workFolder();
      if (folder !== undefined && next !== folder) dropAll();
      if (next !== folder) await loadTree();
      else {
        void tree.refresh();
        void loadRepos();
      }
      void checkDisk();
      if (tabs.active !== null) editor.focus();
    },
    /** 다른 탭(채팅·git)에서 파일을 바로 열 때 */
    open: (path: string) => openPath(path),
    hasUnsaved: (): boolean => tabs.files.some((f) => isDirty(f.path)),
  };
}
