import { codeFailText, type CodeApi, type RepoInfo, type SearchFileHits } from '../shared/code-api.js';
import { searchFailText, searchSummaryText } from '../shared/search-summary.js';
import { fallbackSearchFor } from '../shared/ts-nav.js';
import { createCodeNav } from './code-nav.js';
import { AUTO_SAVE_DELAY_MS, autoSaveSkip, wantsAutoSave, type AutoSaveMode, type AutoSaveTrigger } from '../shared/auto-save.js';
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
import { CodePreview } from './code-preview.js';
import { previewKindOf } from '../shared/preview-kind.js';
import { clearRecent, noteGone, noteOpened } from './recent-files.js';
import { CodeSelection } from '../shared/code-share.js';
import { openMenu } from './code-menu.js';

export interface CodeDeps {
  readonly api: CodeApi;
  /** 지금 작업 폴더(없으면 null) */
  readonly workFolder: () => Promise<string | null>;
  readonly platform: string;
  readonly terminal: TerminalApi;
  /** 이 레포를 git 탭에서 열어 달라(레포 루트 절대 경로) */
  readonly openGit: (repoRoot: string) => void;
  /** 이 레포의 이 커밋을 git 탭 History 에서 열어 달라(blame 거터를 눌렀을 때) */
  readonly openCommit?: (repoRoot: string, hash: string) => void;
  /** 작업 폴더 안의 레포·문서 폴더와 상태(탐색기 레포 노드) */
  readonly repos: () => Promise<readonly RepoRow[]>;
  /** 설정의 자동 저장 방식(없으면 끔). 코드 탭을 열 때마다 다시 읽는다. */
  readonly autoSaveMode?: () => Promise<AutoSaveMode>;
  /** 선택한 코드를 채팅 입력칸에 붙이고 채팅 탭으로 간다(보내지는 않는다) */
  readonly toChat?: (text: string) => void;
}

interface FileInfo {
  readonly language: CodeLanguage;
  readonly indent: Indent;
  readonly readOnly: boolean;
  readonly mixedEol: boolean;
}

const LANGUAGE_NAMES: Readonly<Record<CodeLanguage, string>> = {
  plain: 'Plain text', javascript: 'JavaScript', typescript: 'TypeScript', jsx: 'JavaScript JSX', tsx: 'TypeScript JSX', json: 'JSON', css: 'CSS', html: 'HTML', markdown: 'Markdown',
  python: 'Python', java: 'Java', yaml: 'YAML', xml: 'XML', sql: 'SQL', rust: 'Rust', cpp: 'C/C++', go: 'Go', shell: 'Shell', toml: 'TOML', properties: 'Properties', dockerfile: 'Dockerfile',
};

const INDENT_SOURCE = { editorconfig: '.editorconfig', detected: 'detected from file', default: 'default' } as const;

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
  const modeFiles = el('button', 'tab sm on', 'Explorer');
  const modeSearch = el('button', 'tab sm', 'Search');
  const headName = el('b', 'code-folder');
  const refreshBtn = el('button', 'btn ghost icon sm', '↻');
  refreshBtn.title = 'Refresh list';
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
  const newFileBtn = toolBtn('newFile', 'New file', () => void ops.create('file'));
  const newDirBtn = toolBtn('newFolder', 'New folder', () => void ops.create('dir'));
  const renameBtn = toolBtn('rename', 'Rename (F2)', () => void ops.rename());
  const dupBtn = toolBtn('duplicate', 'Duplicate', () => void ops.duplicate());
  const moveBtn = toolBtn('move', 'Move to another folder', () => {
    const t = tree.selection();
    if (t !== null && t.kind !== 'root') void ops.move(t.path);
  });
  const delBtn = toolBtn('trash', 'Move to trash (Delete)', () => void ops.remove());
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
  searchInput.placeholder = 'Search in work folder';
  searchInput.spellcheck = false;
  const caseBtn = el('button', 'btn ghost icon sm cs-opt', 'Aa');
  caseBtn.title = 'Match case';
  const regexBtn = el('button', 'btn ghost icon sm cs-opt', '.*');
  regexBtn.title = 'Regex';
  const wordBtn = el('button', 'btn ghost icon sm cs-opt', 'ab');
  wordBtn.title = 'Match whole word';
  const detailsBtn = el('button', 'btn ghost icon sm cs-opt', '…');
  detailsBtn.title = 'Toggle include / exclude';
  searchRow.append(searchInput, caseBtn, wordBtn, regexBtn, detailsBtn);
  const globRow = el('div', 'cs-globs');
  globRow.hidden = true;
  const includeInput = el('input', 'cs-input sm');
  includeInput.placeholder = 'Include: *.ts, src/**';
  includeInput.spellcheck = false;
  const excludeInput = el('input', 'cs-input sm');
  excludeInput.placeholder = 'Exclude: *.test.ts, docs';
  excludeInput.spellcheck = false;
  globRow.append(includeInput, excludeInput);
  const searchSummary = el('div', 'cs-summary');
  const stopBtn = el('button', 'btn ghost sm cs-stop', 'Stop');
  stopBtn.hidden = true;
  const summaryRow = el('div', 'cs-summary-row');
  summaryRow.append(searchSummary, stopBtn);
  const searchResults = el('div', 'cs-results');
  searchPanel.append(searchRow, globRow, summaryRow, searchResults);
  explorer.append(head, tools, tree.root, searchPanel);

  // ── 오른쪽 ──
  const bar = el('div', 'code-bar');
  const toggle = el('button', 'btn ghost icon sm code-toggle', '☰');
  toggle.title = 'Collapse/expand explorer';
  const strip = el('div', 'code-tabs');
  const termBtn = el('button', 'btn sm code-termbtn', '>_ Terminal');
  termBtn.title = 'Terminal (Ctrl/Cmd+`)';
  const blameBtn = el('button', 'btn sm code-blamebtn', 'Blame');
  blameBtn.title = 'Show who last changed each line (git blame, saved version)';
  blameBtn.setAttribute('aria-pressed', 'false');
  bar.append(toggle, strip, blameBtn, termBtn);
  const notice = el('div', 'code-notice');
  notice.hidden = true;
  const host = el('div', 'code-host');
  const empty = el('div', 'code-empty');
  empty.append(el('b', undefined, 'Pick a file to open'), el('span', undefined, 'Click a file in the explorer on the left to edit it here.'), el('span', 'dim', 'Ctrl/Cmd+S save · Ctrl/Cmd+F find'));
  const status = el('div', 'code-status');
  const sPath = el('span', 'sp');
  const sRight = el('span', 'sr');
  status.append(sPath, sRight);
  const term = buildTerminal(deps.terminal);
  termBtn.addEventListener('click', () => void term.toggle());
  // 터미널이 열려 있으면 단추가 눌린 모양(btn.on)이어서 켜졌는지 한눈에 보인다
  const syncTermBtn = (): void => void termBtn.classList.toggle('on', !term.root.hidden);
  new MutationObserver(syncTermBtn).observe(term.root, { attributes: true, attributeFilter: ['hidden'] });
  syncTermBtn();
  const preview = new CodePreview(host, {
    api: deps.api,
    textOf: (p) => editor.textOf(p),
    narrow: () => tierNarrow(),
    changed: () => paintAll(),
  });
  bar.insertBefore(preview.modeBar, blameBtn);
  // 창 크기 단계(data-tier)가 바뀐 뒤에 다시 계산한다
  window.addEventListener('resize', () => window.setTimeout(() => root.isConnected && preview.relayout(), 60));
  main.append(bar, notice, preview.body, empty, term.root, status);

  let tabs = OpenFiles.empty();
  const info = new Map<string, FileInfo>();
  const saving = new Set<string>();
  let autoMode: AutoSaveMode = 'off';
  const autoTimers = new Map<string, number>();
  /** 자동 저장이 실패한 글(같은 글로는 다시 시도하지 않는다) */
  const autoFailed = new Map<string, string>();
  /** 마지막 저장이 자동 저장이었던 파일(상태줄에 Auto-saved) */
  const autoSaved = new Set<string>();
  let cursor = { line: 1, column: 1 };
  let folder: string | null | undefined;
  let flash: { text: string; timer: number } | null = null;
  let changeMap = ChangeMap.empty();
  let repos: readonly RepoInfo[] = [];
  let blameOn = false;
  /** blame 을 읽은 파일이 든 레포 루트(거터를 눌러 git 탭으로 갈 때 쓴다) */
  const blameRoot = new Map<string, string>();

  const editor = new CodeEditor(host, {
    mac: deps.platform === 'darwin',
    onNavigate: (kind, line, column) => void nav.go(kind, line, column),
    onChange: () => {
      paintDirty();
      scheduleAutoSave();
      preview.textChanged();
    },
    onCursor: (line, column) => {
      cursor = { line, column };
      paintStatus();
    },
    onBlameClick: (hash) => {
      const path = tabs.active;
      const root = path === null ? undefined : (blameRoot.get(path) ?? repoOf(path)?.root);
      if (root !== undefined) deps.openCommit?.(root, hash);
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
    const active = tabs.active === null || preview.activeImage() !== null ? undefined : tabs.get(tabs.active);
    const lines: HTMLElement[] = [];
    if (flash !== null) lines.push(el('div', 'note warn', flash.text));
    if (active !== undefined) {
      const fi = info.get(active.path);
      if (active.stale) {
        const line = el('div', 'note warn');
        line.append(el('span', undefined, 'This file changed or was deleted on disk. '));
        const reload = el('button', 'btn sm', 'Load disk version');
        reload.addEventListener('click', () => void revert(active.path, true));
        line.append(reload);
        lines.push(line);
      }
      if (fi?.readOnly === true) lines.push(el('div', 'note', 'No write permission, so the file is open read-only.'));
      if (fi?.mixedEol === true) lines.push(el('div', 'note', 'Line endings are mixed. Saving makes them all the same.'));
    }
    notice.replaceChildren(...lines);
    notice.hidden = lines.length === 0;
  }

  function paintTabs(): void {
    const labels = tabLabels(tabs.files.map((f) => f.path));
    strip.replaceChildren();
    for (const f of tabs.files) {
      const t = el('div', 'code-tab');
      t.classList.toggle('on', f.path === tabs.active && preview.activeImage() === null);
      t.title = f.path;
      t.dataset['path'] = f.path;
      const dirty = isDirty(f.path);
      const close = el('button', 'btn ghost icon sm code-x');
      close.title = dirty ? 'Modified - close' : 'Close';
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
    for (const img of preview.images()) {
      const t = el('div', 'code-tab');
      t.classList.toggle('on', preview.activeImage()?.path === img.path);
      t.title = img.path;
      t.dataset['path'] = img.path;
      const close = el('button', 'btn ghost icon sm code-x', '×');
      close.title = 'Close';
      close.addEventListener('click', (e) => {
        e.stopPropagation();
        closeImageTab(img.path);
      });
      t.append(iconByName(baseName(img.path), false), el('span', 'code-tab-name', baseName(img.path)), close);
      t.addEventListener('click', () => void openImage(img.path));
      t.addEventListener('auxclick', (e) => {
        if (e.button === 1) closeImageTab(img.path);
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
    const img = preview.activeImage();
    empty.hidden = f !== undefined || img !== null;
    host.hidden = f === undefined;
    preview.body.hidden = f === undefined && img === null;
    status.hidden = f === undefined && img === null;
    if (img !== null) {
      sPath.textContent = img.path;
      sRight.textContent = [img.width === null ? '' : `${img.width}×${img.height} px`, bytesText(img.bytes), img.mime].filter((p) => p !== '').join('   ');
      return;
    }
    if (f === undefined || path === null) return;
    const fi = info.get(path);
    sPath.textContent = path;
    const ind = fi === undefined ? '' : `${fi.indent.unit === 'tab' ? 'Tab' : 'Spaces'} ${fi.indent.size} (${INDENT_SOURCE[fi.indent.source]})`;
    const parts = [`Ln ${cursor.line}, Col ${cursor.column}`, ind, f.eol === 'crlf' ? 'CRLF' : 'LF', f.bom ? 'UTF-8 BOM' : 'UTF-8', LANGUAGE_NAMES[fi?.language ?? 'plain'], isDirty(path) ? 'Modified' : autoSaved.has(path) ? 'Auto-saved' : 'Saved'];
    sRight.textContent = parts.filter((p) => p !== '').join('   ');
    const repo = repoOf(path);
    if (repo !== null) {
      const link = el('button', 'link', changeMap.statusOf(path) === null ? 'View in git' : 'Changed · View in git');
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
    void refreshBlame(path);
  }

  const BLAME_WHY = { 'not-repo': 'this file is not inside a git repo', 'not-tracked': 'this file is not committed yet', 'too-big': 'this file is too big', failed: 'git could not read it' } as const;

  /** blame 거터를 채운다. 저장한 글 기준이라 고치는 중인 파일은 건드리지 않는다(줄 번호가 어긋난다). */
  async function refreshBlame(path: string, announce = false): Promise<void> {
    if (!blameOn || !tabs.has(path)) return;
    if (isDirty(path)) {
      if (announce) say('Blame shows the saved version. Save the file to refresh it.');
      return;
    }
    const r = await deps.api.blame(path);
    if (!blameOn || !tabs.has(path)) return;
    if (!r.ok || r.view === null) {
      editor.setBlame(path, null);
      if (announce || tabs.active === path) say(`Blame is not available: ${r.ok ? BLAME_WHY[r.why] : codeFailText(r.reason)}`);
      return;
    }
    blameRoot.set(path, r.root);
    editor.setBlame(path, { view: r.view, now: Math.floor(Date.now() / 1000) });
    if (r.view.truncated && tabs.active === path) say('Blame shows only the first 5000 lines of this file.');
  }

  blameBtn.addEventListener('click', () => {
    blameOn = !blameOn;
    blameBtn.classList.toggle('on', blameOn);
    blameBtn.setAttribute('aria-pressed', String(blameOn));
    editor.showBlame(blameOn);
    if (blameOn && tabs.active !== null) void refreshBlame(tabs.active, true);
  });

  function paintAll(): void {
    if (preview.activeImage() === null) preview.showText(tabs.active);
    paintTabs();
    paintNotice();
    paintStatus();
    tree.setActive(preview.activeImage()?.path ?? tabs.active);
  }

  const bytesText = (n: number): string => (n < 1024 ? `${n} bytes` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)}KB` : `${(n / 1024 / 1024).toFixed(1)}MB`);
  function tierNarrow(): boolean {
    return ['s', 'xs'].includes(document.querySelector<HTMLElement>('.app')?.dataset['tier'] ?? '');
  }

  /** 그림 파일은 글 탭이 아니라 이미지 뷰어 탭으로 연다 */
  async function openImage(path: string): Promise<void> {
    const r = await preview.openImage(path);
    if (!r.ok) {
      say(`${baseName(path)}: ${codeFailText(r.reason)}`);
      return;
    }
    clearSay();
    paintAll();
    closeExplorerWhenNarrow();
  }

  function closeImageTab(path: string): void {
    preview.closeImage(path);
    paintAll();
  }

  // ── 열기·전환·닫기 ──
  function activate(path: string): void {
    if (tabs.active !== null && tabs.active !== path) autoSaveAllOnLeave();
    clearSay();
    preview.leaveImage();
    tabs = tabs.activated(path);
    noteOpened(path);
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
    if (previewKindOf(baseName(path)) === 'image') return openImage(path);
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
    preview.leaveImage();
    const language = languageOf(baseName(path));
    const indent = chooseIndent(r.editorConfig, detectIndent(r.text), defaultIndentSize(language));
    register(path, r.text, { language, indent, readOnly: r.readOnly, mixedEol: r.mixedEol });
    tabs = tabs.opened(OpenFile.opened(path, r.text, r.version, r.eol, r.bom));
    noteOpened(path);
    editor.show(path);
    paintAll();
    editor.focus();
    closeExplorerWhenNarrow();
    void refreshMarks(path);
  }

  async function closeTab(path: string): Promise<void> {
    if (isDirty(path)) {
      const name = baseName(path);
      const answer = await ask(`Save ${name}?`, 'If you close without saving, your changes are lost.', [
        { id: 'save', label: 'Save and close', kind: 'primary' },
        { id: 'discard', label: 'Do not save', kind: 'danger' },
        { id: 'cancel', label: 'Cancel' },
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
  async function save(path: string, auto = false): Promise<boolean> {
    const f = tabs.get(path);
    if (f === undefined || saving.has(path)) return false;
    const text = editor.textOf(path);
    if (text === null) return false;
    if (!isDirty(path)) return true;
    saving.add(path);
    try {
      let overwrite = false;
      if (!auto) autoFailed.delete(path);
      for (;;) {
        const r = await deps.api.write({ path, text, eol: f.eol, bom: f.bom, baseVersion: tabs.get(path)?.version ?? f.version, overwrite });
        if (r.ok) {
          tabs = tabs.updated(path, (x) => x.saved(text, r.version));
          autoFailed.delete(path);
          if (auto) autoSaved.add(path);
          else autoSaved.delete(path);
          paintAll();
          void refreshMarks(path);
          void refreshChanges();
          return true;
        }
        // 자동 저장은 충돌·삭제를 묻지 않고 멈춘다(덮어쓰기는 사람이 손으로 저장할 때만 고른다)
        if (auto && (r.reason === 'conflict' || r.reason === 'deleted')) {
          tabs = tabs.updated(path, (x) => x.markedStale());
          autoFailed.set(path, text);
          paintAll();
          say(`Auto save stopped for ${baseName(path)}: ${codeFailText(r.reason)} Press Ctrl/Cmd+S to choose what to do.`);
          return false;
        }
        if ((r.reason === 'conflict' || r.reason === 'deleted') && !overwrite) {
          const gone = r.reason === 'deleted';
          const answer = await ask(gone ? 'File deleted on disk' : 'File changed on disk', gone ? 'Saving recreates this file.' : 'Overwriting loses the changes made elsewhere. Loading the disk version loses your edits.', [
            { id: 'overwrite', label: gone ? 'Recreate and save' : 'Overwrite with mine', kind: 'danger' },
            ...(gone ? [] : [{ id: 'reload', label: 'Load disk version' }]),
            { id: 'cancel', label: 'Cancel' },
          ]);
          if (answer === 'overwrite') {
            overwrite = true;
            continue;
          }
          if (answer === 'reload') await revert(path, true);
          return false;
        }
        const detail = r.detail === undefined ? '' : ` (${r.detail})`;
        if (auto) autoFailed.set(path, text);
        say(`${auto ? 'Auto save failed' : 'Could not save'} ${baseName(path)}. ${codeFailText(r.reason)}${detail} Your changes are still in the editor.`);
        return false;
      }
    } finally {
      saving.delete(path);
    }
  }

  // ── 자동 저장 ──
  /** 한 파일을 자동 저장한다(막는 사정은 shared/auto-save.ts 규칙). 질문 창 위에서는 저장하지 않는다. */
  function autoSave(path: string, trigger: AutoSaveTrigger): void {
    if (!wantsAutoSave(autoMode, trigger) || document.querySelector('.veil') !== null) return;
    const f = tabs.get(path);
    const text = editor.textOf(path);
    if (f === undefined || text === null) return;
    const skip = autoSaveSkip({ dirty: isDirty(path), readOnly: info.get(path)?.readOnly === true, stale: f.stale, saving: saving.has(path), failedText: autoFailed.get(path) === text });
    if (skip === null) void save(path, true);
  }

  function scheduleAutoSave(): void {
    const path = tabs.active;
    if (path === null) return;
    autoSaved.delete(path);
    window.clearTimeout(autoTimers.get(path));
    if (!wantsAutoSave(autoMode, 'edit')) return;
    autoTimers.set(path, window.setTimeout(() => (autoTimers.delete(path), autoSave(path, 'edit')), AUTO_SAVE_DELAY_MS));
  }

  /** 편집기·창·탭을 떠났다: 열어 둔 수정 파일을 모두 살핀다 */
  function autoSaveAllOnLeave(): void {
    for (const f of tabs.files) autoSave(f.path, 'leave');
  }

  /** 마지막 저장 상태(디스크 내용)로 되돌린다. 수정 중이면 먼저 확인한다. */
  async function revert(path: string, skipAsk = false): Promise<void> {
    if (!skipAsk && isDirty(path)) {
      const answer = await ask('Discard your changes?', 'The file goes back to what is saved on disk. Your changes are lost.', [
        { id: 'revert', label: 'Revert', kind: 'danger' },
        { id: 'cancel', label: 'Cancel' },
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
  let wordOn = false;
  wordBtn.addEventListener('click', () => {
    wordOn = !wordOn;
    wordBtn.classList.toggle('on', wordOn);
    void runSearch();
  });
  detailsBtn.addEventListener('click', () => {
    globRow.hidden = !globRow.hidden;
    detailsBtn.classList.toggle('on', !globRow.hidden);
    if (!globRow.hidden) includeInput.focus();
  });
  for (const input of [includeInput, excludeInput]) {
    input.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => void runSearch(), 350);
    });
    input.addEventListener('keydown', (e) => {
      if (!isEnterKey(e)) return;
      clearTimeout(searchTimer);
      void runSearch();
    });
  }
  let searchId = '';
  stopBtn.addEventListener('click', () => {
    if (searchId !== '') void deps.api.cancelSearch(searchId);
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
    if (searchId !== '') void deps.api.cancelSearch(searchId);
    if (query === '') {
      searchId = '';
      stopBtn.hidden = true;
      searchSummary.textContent = '';
      searchResults.replaceChildren();
      return;
    }
    const id = `s${seq}-${Date.now().toString(36)}`;
    searchId = id;
    stopBtn.hidden = false;
    searchSummary.textContent = 'Searching…';
    const r = await deps.api.search({ query, caseSensitive: caseOn, regex: regexOn, wholeWord: wordOn, include: includeInput.value, exclude: excludeInput.value, id });
    if (seq !== searchSeq) return;
    searchId = '';
    stopBtn.hidden = true;
    if (!r.ok) {
      searchResults.replaceChildren();
      searchSummary.textContent = searchFailText(r.reason);
      return;
    }
    searchSummary.textContent = searchSummaryText(r);
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

  /** 정의로 이동·참조 찾기가 찾은 위치 목록을 Search 칸에 보인다(전체 찾기 결과와 같은 모양) */
  function showNavResults(title: string, files: readonly SearchFileHits[]): void {
    setMode('search');
    searchSeq++;
    clearTimeout(searchTimer);
    if (searchId !== '') void deps.api.cancelSearch(searchId);
    searchId = '';
    stopBtn.hidden = true;
    searchSummary.textContent = title;
    searchResults.replaceChildren(...files.map(resultGroup));
  }

  /** 언어 도구가 없을 때: 그 이름을 낱말 단위·대소문자 구분으로 전체 찾기 */
  function searchByName(word: string): void {
    const o = fallbackSearchFor(word);
    setMode('search');
    searchInput.value = word;
    caseOn = o.caseSensitive;
    regexOn = o.regex;
    wordOn = o.wholeWord === true;
    caseBtn.classList.toggle('on', caseOn);
    regexBtn.classList.toggle('on', regexOn);
    wordBtn.classList.toggle('on', wordOn);
    clearTimeout(searchTimer);
    void runSearch();
  }

  const nav = createCodeNav({ api: deps.api, active: () => tabs.active, textOf: (p) => editor.textOf(p), openAt, showResults: showNavResults, searchByName, say, clear: clearSay });

  // ── 빠른 열기(Ctrl/Cmd+P) ──
  let quick: { close: () => void } | null = null;
  let fileCache: { at: number; paths: readonly string[] } | null = null;
  const FILE_CACHE_MS = 15_000;

  async function openQuick(): Promise<void> {
    if (quick !== null) return;
    const veil = el('div', 'qo-veil');
    const box = el('div', 'qo');
    const input = el('input', 'qo-input');
    input.placeholder = 'Open by file name';
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
      if (shown.length === 0) list.append(el('div', 'qo-empty', all.length === 0 ? 'Looking for files…' : 'No matching files.'));
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

  // ── 선택한 코드를 채팅으로 ──
  const SEND_KEYS = deps.platform === 'darwin' ? '⌘⇧E' : 'Ctrl+Shift+E';
  function sendSelection(): void {
    const path = tabs.active;
    const sel = path === null ? null : editor.selection();
    const share = path === null || sel === null ? null : CodeSelection.of(path, sel.fromLine, sel.toLine, sel.text);
    if (share === null) {
      say('Select some code first (secret files are never sent).');
      return;
    }
    deps.toChat?.(share.toChatText());
  }
  host.addEventListener('contextmenu', (e) => {
    const items = [
      { label: 'Go to definition', hint: 'F12', run: () => editorNav('definition') },
      { label: 'Find all references', hint: deps.platform === 'darwin' ? '⇧F12' : 'Shift+F12', run: () => editorNav('references') },
    ];
    if (deps.toChat !== undefined && editor.selection() !== null) items.push({ label: 'Send selection to chat', hint: SEND_KEYS, run: sendSelection });
    if (tabs.active === null) return;
    e.preventDefault();
    openMenu(items, e.clientX, e.clientY);
  });
  /** 편집기의 지금 커서 자리에서 정의/참조를 찾는다 */
  function editorNav(kind: 'definition' | 'references'): void {
    void nav.go(kind, cursor.line, cursor.column);
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
    } else if (e.shiftKey && key === 'e') {
      e.preventDefault();
      if (!e.repeat) sendSelection();
    }
  });
  host.addEventListener('focusout', (e) => {
    if (!(e.relatedTarget instanceof Node) || !host.contains(e.relatedTarget)) autoSaveAllOnLeave();
  });
  window.addEventListener('blur', autoSaveAllOnLeave);
  window.addEventListener('focus', () => {
    if (root.isConnected && root.offsetParent !== null) void checkDisk();
  });

  async function loadTree(): Promise<void> {
    const next = await deps.workFolder();
    if (next === null) {
      headName.textContent = 'Explorer';
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
    clearRecent();
    preview.closeAllImages();
    void term.reset();
    editor.hide();
    paintAll();
    if (lost.length > 0) say(`The work folder changed, so open files were closed. Unsaved changes in ${lost.join(', ')} were lost.`);
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
    preview.closeImagesUnder(from);
    const moves = remapOpen(tabs.files.map((f) => f.path), from, to);
    if (moves.length === 0) {
      paintAll();
      return;
    }
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
    preview.closeImagesUnder(path);
    for (const f of tabs.files.filter((x) => isSameOrUnder(x.path, path))) {
      if (keepUnsaved && isDirty(f.path)) {
        tabs = tabs.updated(f.path, (x) => x.markedStale());
        continue;
      }
      editor.remove(f.path);
      info.delete(f.path);
      noteGone(f.path);
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
      autoMode = (await deps.autoSaveMode?.().catch(() => 'off' as const)) ?? 'off';
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
