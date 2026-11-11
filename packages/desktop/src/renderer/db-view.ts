import { DB_LIMIT_NOTE, type DbApi, type DbFailure, type DbResult, type DbResultSet, type DbRowsPage, type DbTableDetail, type DbTableInfo } from '../shared/db-api.js';
import type { DbConnectionView } from '../shared/db-connections.js';
import { toCsv } from '../shared/db-csv.js';
import { DbInputError } from '../shared/db-names.js';
import { SqlStatement } from '../shared/db-sql.js';
import { nextSort, pageCount, pageLabel, resultLine, sqlPreview, truncationNote } from '../shared/db-view-text.js';
import { CodeEditor } from './code-editor.js';
import { resultTable } from './db-table.js';
import { el, isEnterKey } from './dom.js';
import { askDialog } from './git-common.js';
import { button, chipOf, select } from './todo-parts.js';

export interface DbViewDeps {
  readonly api: DbApi;
}

type Sub = 'schema' | 'rows' | 'sql';
const SUBS: readonly (readonly [Sub, string])[] = [
  ['schema', 'Schema'],
  ['rows', 'Rows'],
  ['sql', 'SQL'],
];
const TIMEOUTS: readonly (readonly [string, string])[] = [
  ['10', '10 s limit'],
  ['30', '30 s limit'],
  ['60', '60 s limit'],
];
const LAST_KEY = 'rauha.db.last';
const SAMPLE = 'SELECT name, type FROM sqlite_schema ORDER BY name;';
const INDENT = { unit: 'space', size: 2, tabWidth: 2, source: 'default' } as const;

const readLast = (): string | null => {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
};
const writeLast = (id: string): void => {
  try {
    localStorage.setItem(LAST_KEY, id);
  } catch {
    /* 기억하지 못해도 된다 */
  }
};

function problemCard(f: DbFailure): HTMLElement {
  const card = el('div', 'item db-problem');
  card.append(el('b', 'err', f.title), el('div', 'dim db-msg', f.message));
  if (f.help !== null) card.append(el('div', 'hint', f.help));
  return card;
}
function empty(title: string, body: string): HTMLElement {
  const box = el('div', 'empty db-empty');
  box.append(el('b', undefined, title), el('span', 'hint', body));
  return box;
}

/**
 * DB 탭: SQLite 파일을 열어 테이블·스키마·행·SQL 결과를 본다. 화면은 그리기만 하고,
 * 어떤 SQL 이 쓰기인지·경로가 맞는지·상한은 shared 와 main 이 정한다(여기서 한 검사는 빠른 안내용일 뿐이다).
 * 기본은 읽기 전용이고, 쓰기 문장은 Write mode 를 켜고 확인 창에서 허락해야 main 으로 간다.
 */
export function buildDb(deps: DbViewDeps) {
  const api = deps.api;
  const root = el('section', 'db');
  let connections: readonly DbConnectionView[] = [];
  let current: DbConnectionView | null = null;
  let tables: readonly DbTableInfo[] = [];
  let table: string | null = null;
  let detail: DbTableDetail | null = null;
  let rowsPage: DbRowsPage | null = null;
  let page = 0;
  let sort: { column: string; dir: 'asc' | 'desc' } | null = null;
  let sub: Sub = 'rows';
  let writeMode = false;
  let running: string | null = null;
  let runCount = 0;
  let timeoutSec = 10;
  let lastResult: DbResultSet | null = null;
  let seq = 0;

  // ── 머리줄 ──
  const modeChip = el('span');
  const fileHint = el('span', 'hint grow db-file-hint');
  const writeBox = el('input');
  writeBox.type = 'checkbox';
  writeBox.setAttribute('aria-label', 'Write mode');
  const writeLabel = el('label', 'db-write');
  writeLabel.append(writeBox, el('span', undefined, 'Write mode'));
  writeLabel.title = 'Allow INSERT, UPDATE, DELETE and schema changes. Each one still asks for confirmation.';
  const head = el('div', 'rhead db-head');
  head.append(el('b', undefined, 'DB'), modeChip, fileHint, writeLabel);
  const limit = el('div', 'hint', DB_LIMIT_NOTE);
  const notice = el('div', 'notice');
  notice.hidden = true;
  const say = (text: string): void => {
    notice.textContent = text;
    notice.hidden = text === '';
  };
  const paintMode = (): void => {
    modeChip.replaceChildren(writeMode ? chipOf('Write mode', 'red') : chipOf('Read-only', 'green'));
    writeBox.checked = writeMode;
    writeBox.disabled = current === null;
    fileHint.textContent = current === null ? 'No file open' : current.path;
    fileHint.title = current === null ? '' : current.path;
    say(writeMode ? 'Write mode is on. A statement that changes data asks you to confirm before it runs, and it cannot be undone.' : '');
  };
  writeBox.addEventListener('change', () => {
    writeMode = writeBox.checked && current !== null;
    paintMode();
  });

  // ── 왼쪽: 파일 · 테이블 ──
  const pathInput = el('input', 'sm db-path');
  pathInput.placeholder = 'Full path, e.g. C:\\data\\app.db';
  pathInput.spellcheck = false;
  pathInput.setAttribute('aria-label', 'Full path of a SQLite file');
  const addBtn = button('Add', 'btn sm', () => void addPath());
  const browseBtn = button('Browse…', 'btn sm', () => void browse());
  const addBar = el('div', 'bar db-addbar');
  addBar.append(pathInput, addBtn, browseBtn);
  pathInput.addEventListener('keydown', (e) => {
    if (isEnterKey(e)) {
      e.preventDefault();
      void addPath();
    }
  });
  const addNote = el('div', 'hint db-addnote');
  addNote.hidden = true;
  const fileList = el('div', 'db-files');
  const tableList = el('div', 'db-tables');
  const side = el('div', 'pane db-side');
  const filesHead = el('div', 'ph');
  filesHead.append(el('b', undefined, 'Files'));
  const tablesHead = el('div', 'ph');
  const tablesTitle = el('b', undefined, 'Tables');
  tablesHead.append(tablesTitle);
  const addWrap = el('div', 'db-add');
  addWrap.append(addBar, addNote);
  side.append(filesHead, addWrap, fileList, tablesHead, tableList);

  // ── 가운데: 탭 + 칸 ──
  const tabsRow = el('div', 'tabs');
  const tabButtons = new Map<Sub, HTMLButtonElement>();
  for (const [id, label] of SUBS) {
    const b = el('button', 'tab', label);
    b.type = 'button';
    b.addEventListener('click', () => switchSub(id));
    tabButtons.set(id, b);
    tabsRow.append(b);
  }
  const tableTitle = el('span', 'hint grow db-table-title');
  tabsRow.append(tableTitle);

  const schemaPanel = el('div', 'db-panel');
  const rowsPanel = el('div', 'db-panel');
  const sqlPanel = el('div', 'db-panel');
  const main = el('div', 'pane db-main');
  main.append(tabsRow, schemaPanel, rowsPanel, sqlPanel);
  const body = el('div', 'db-body');
  body.append(side, main);
  root.append(head, limit, notice, body);

  // ── 행 칸 ──
  const rowsBar = el('div', 'bar db-rowsbar');
  const prevBtn = button('‹ Prev', 'btn sm', () => void goPage(page - 1));
  const nextBtn = button('Next ›', 'btn sm', () => void goPage(page + 1));
  const pageText = el('span', 'hint db-pagetext');
  const rowsCsv = button('Export CSV', 'btn sm', () => void exportCsv(rowsPage?.result ?? null, table ?? 'rows'));
  const rowsRefresh = button('Refresh', 'btn sm', () => void loadRows());
  rowsBar.append(prevBtn, nextBtn, pageText, rowsCsv, rowsRefresh);
  const rowsBody = el('div', 'db-result');
  const rowsNote = el('div', 'hint db-trunc');
  rowsNote.hidden = true;
  rowsPanel.append(rowsBar, rowsNote, rowsBody);

  // ── SQL 칸 ──
  const editorHost = el('div', 'db-editor');
  const editor = new CodeEditor(editorHost, { onChange: () => undefined, onCursor: () => undefined });
  editor.add('sql', SAMPLE, 'sql', INDENT, false);
  editor.show('sql');
  editorHost.addEventListener(
    'keydown',
    (e) => {
      if ((e.ctrlKey || e.metaKey) && isEnterKey(e)) {
        e.preventDefault();
        e.stopPropagation();
        void run();
      }
    },
    true,
  );
  const runBtn = button('Run', 'btn primary', () => void run());
  const cancelBtn = button('Cancel', 'btn', () => {
    if (running !== null) void api.cancel(running);
  });
  cancelBtn.hidden = true;
  const timeoutSel = select(TIMEOUTS, '10', (v) => (timeoutSec = Number(v)));
  timeoutSel.classList.add('sm');
  timeoutSel.setAttribute('aria-label', 'Query time limit');
  const sqlHint = el('span', 'hint', 'Ctrl+Enter runs · one statement at a time');
  const sqlCsv = button('Export CSV', 'btn sm', () => void exportCsv(lastResult, 'result'));
  sqlCsv.hidden = true;
  const sqlBar = el('div', 'bar db-sqlbar');
  sqlBar.append(runBtn, cancelBtn, timeoutSel, sqlHint, sqlCsv);
  const sqlStatus = el('div', 'bar db-status');
  const sqlBody = el('div', 'db-result');
  sqlPanel.append(editorHost, sqlBar, sqlStatus, sqlBody);

  // ── 그리기 ──
  function paintFiles(): void {
    fileList.replaceChildren();
    if (connections.length === 0) {
      fileList.append(el('div', 'hint db-pad', 'No files yet. Type a full path above or press Browse.'));
      return;
    }
    for (const c of connections) {
      const row = el('div', c.id === current?.id ? 'row-item db-row on' : 'row-item db-row');
      row.tabIndex = 0;
      row.title = c.path;
      row.append(el('span', 'db-name', c.name));
      const rm = button('×', 'btn icon sm ghost', () => void removeFile(c));
      rm.title = `Remove ${c.name} from this list (the file is not deleted)`;
      rm.setAttribute('aria-label', `Remove ${c.name} from this list`);
      rm.addEventListener('click', (e) => e.stopPropagation());
      row.append(rm);
      row.addEventListener('click', () => void openFile(c));
      row.addEventListener('keydown', (e) => {
        if (isEnterKey(e)) void openFile(c);
      });
      fileList.append(row);
    }
  }
  function paintTables(): void {
    tableList.replaceChildren();
    tablesTitle.textContent = tables.length === 0 ? 'Tables' : `Tables (${tables.length})`;
    if (current === null) return;
    if (tables.length === 0) {
      tableList.append(el('div', 'hint db-pad', 'This file has no tables.'));
      return;
    }
    for (const t of tables) {
      const row = el('div', t.name === table ? 'row-item db-row on' : 'row-item db-row');
      row.tabIndex = 0;
      row.title = t.name;
      row.append(el('span', 'db-name', t.name));
      if (t.kind === 'view') row.append(chipOf('view', 'blue'));
      row.addEventListener('click', () => void pickTable(t.name));
      row.addEventListener('keydown', (e) => {
        if (isEnterKey(e)) void pickTable(t.name);
      });
      tableList.append(row);
    }
  }
  function paintSub(): void {
    for (const [id, b] of tabButtons) b.classList.toggle('on', id === sub);
    schemaPanel.hidden = sub !== 'schema';
    rowsPanel.hidden = sub !== 'rows';
    sqlPanel.hidden = sub !== 'sql';
    tableTitle.textContent = table === null ? '' : table;
  }
  function paintSchema(failure?: DbFailure): void {
    schemaPanel.replaceChildren();
    if (failure !== undefined) return void schemaPanel.append(problemCard(failure));
    if (detail === null) return void schemaPanel.append(empty('Pick a table', 'Choose a table on the left to see its columns.'));
    const bar = el('div', 'bar');
    bar.append(chipOf(detail.kind === 'view' ? 'View' : 'Table', detail.kind === 'view' ? 'blue' : ''), el('span', 'hint grow', `${detail.columns.length} columns`));
    bar.append(
      button('Browse rows', 'btn sm', () => switchSub('rows')),
      button('Query it', 'btn sm', () => {
        editor.replace('sql', `SELECT * FROM "${detail?.name.replace(/"/g, '""')}" LIMIT 100;`, 'sql', INDENT, false);
        switchSub('sql');
      }),
    );
    const grid = el('div', 'db-scroll');
    const t = el('table', 'tbl db-table');
    const thead = el('thead');
    const hr = el('tr');
    for (const h of ['Column', 'Type', 'Null', 'Default', 'Key']) hr.append(el('th', 'db-th', h));
    thead.append(hr);
    const tb = el('tbody');
    for (const c of detail.columns) {
      const tr = el('tr');
      tr.append(el('td', 'db-cell text', c.hidden ? `${c.name} (hidden)` : c.name), el('td', 'db-cell text', c.type === '' ? '—' : c.type), el('td', 'db-cell text', c.notNull ? 'NOT NULL' : 'null ok'), el('td', 'db-cell text', c.defaultValue ?? '—'), el('td', 'db-cell text', c.primaryKey > 0 ? `PK ${c.primaryKey}` : ''));
      tb.append(tr);
    }
    t.append(thead, tb);
    grid.append(t);
    schemaPanel.append(bar, grid);
    if (detail.createSql !== null) {
      const pre = el('pre', 'db-create mono');
      pre.textContent = detail.createSql;
      schemaPanel.append(pre);
    }
  }
  function paintRows(failure?: DbFailure): void {
    rowsBody.replaceChildren();
    rowsNote.hidden = true;
    const has = rowsPage !== null && failure === undefined;
    prevBtn.disabled = !has || page <= 0;
    nextBtn.disabled = !has || page + 1 >= pageCount(rowsPage!.total, rowsPage!.pageSize);
    rowsCsv.disabled = !has;
    rowsRefresh.disabled = table === null;
    if (failure !== undefined) {
      pageText.textContent = '';
      return void rowsBody.append(problemCard(failure));
    }
    if (rowsPage === null) {
      pageText.textContent = '';
      return void rowsBody.append(empty(table === null ? 'Pick a table' : 'Loading…', table === null ? 'Choose a table on the left to see its rows.' : ''));
    }
    pageText.textContent = pageLabel(rowsPage.page, rowsPage.total, rowsPage.pageSize);
    const note = truncationNote(rowsPage.result);
    rowsNote.hidden = note === null;
    rowsNote.textContent = note ?? '';
    rowsBody.append(resultTable(rowsPage.result, { sort, onSort: (col) => void sortBy(col) }));
  }
  function paintMain(failure?: DbFailure): void {
    paintSub();
    if (current === null) {
      schemaPanel.replaceChildren(empty('No file open', 'Add a SQLite file on the left to browse its tables.'));
      rowsBody.replaceChildren(empty('No file open', 'Add a SQLite file on the left to browse its tables.'));
      prevBtn.disabled = nextBtn.disabled = rowsCsv.disabled = rowsRefresh.disabled = true;
      pageText.textContent = '';
      return;
    }
    if (failure !== undefined) {
      schemaPanel.replaceChildren(problemCard(failure));
      rowsBody.replaceChildren(problemCard(failure));
      prevBtn.disabled = nextBtn.disabled = rowsCsv.disabled = rowsRefresh.disabled = true;
      return;
    }
    paintSchema();
    paintRows();
  }

  // ── 동작 ──
  function switchSub(next: Sub): void {
    sub = next;
    paintSub();
    if (current === null || table === null) return;
    if (next === 'rows' && rowsPage === null) void loadRows();
    if (next === 'schema' && detail === null) void loadDetail();
    if (next === 'sql') editor.focus();
  }

  async function refreshList(selectId?: string): Promise<void> {
    const r = await api.list();
    if (!r.ok) {
      say(`${r.failure.title}. ${r.failure.message}`);
      return;
    }
    connections = r.data.connections;
    paintFiles();
    const want = selectId ?? readLast() ?? undefined;
    const found = connections.find((c) => c.id === want) ?? (selectId === undefined ? connections[0] : undefined);
    if (found !== undefined && current?.id !== found.id) await openFile(found);
    else if (current !== null && !connections.some((c) => c.id === current?.id)) clearCurrent();
  }

  function clearCurrent(): void {
    current = null;
    tables = [];
    table = null;
    detail = null;
    rowsPage = null;
    lastResult = null;
    writeMode = false;
    paintFiles();
    paintTables();
    paintMode();
    paintMain();
  }

  async function openFile(c: DbConnectionView): Promise<void> {
    const mine = (seq += 1);
    current = c;
    writeMode = false;
    table = null;
    detail = null;
    rowsPage = null;
    sort = null;
    page = 0;
    tables = [];
    writeLast(c.id);
    paintFiles();
    paintTables();
    paintMode();
    paintMain();
    const r = await api.tables(c.id);
    if (mine !== seq) return;
    if (!r.ok) {
      paintMain(r.failure);
      return;
    }
    tables = r.data;
    paintTables();
    const first = tables[0];
    if (first !== undefined) await pickTable(first.name);
    else paintMain();
  }

  async function pickTable(name: string): Promise<void> {
    table = name;
    detail = null;
    rowsPage = null;
    sort = null;
    page = 0;
    paintTables();
    paintMain();
    await Promise.all([loadDetail(), sub === 'rows' ? loadRows() : Promise.resolve()]);
  }

  async function loadDetail(): Promise<void> {
    if (current === null || table === null) return;
    const mine = seq;
    const name = table;
    const r = await api.detail({ id: current.id, table: name });
    if (mine !== seq || name !== table) return;
    if (r.ok) {
      detail = r.data;
      paintSchema();
    } else paintSchema(r.failure);
  }

  async function loadRows(): Promise<void> {
    if (current === null || table === null) return;
    const mine = seq;
    const name = table;
    const want = page;
    const r = await api.rows({ id: current.id, table: name, page: want, sort });
    if (mine !== seq || name !== table) return;
    if (r.ok) {
      rowsPage = r.data;
      paintRows();
    } else {
      rowsPage = null;
      paintRows(r.failure);
    }
  }

  async function goPage(next: number): Promise<void> {
    if (next < 0) return;
    page = next;
    await loadRows();
  }
  async function sortBy(column: string): Promise<void> {
    sort = nextSort(sort, column);
    page = 0;
    await loadRows();
  }

  const remember = (text: string): void => {
    addNote.textContent = text;
    addNote.hidden = text === '';
  };
  async function register(task: Promise<DbResult<DbConnectionView | null>>): Promise<void> {
    const r = await task;
    if (!r.ok) return remember(`${r.failure.title}. ${r.failure.message}${r.failure.help === null ? '' : ` ${r.failure.help}`}`);
    remember('');
    if (r.data === null) return;
    pathInput.value = '';
    await refreshList(r.data.id);
    await openFile(r.data);
  }
  async function addPath(): Promise<void> {
    if (pathInput.value.trim() === '') return remember('Type the full path of a SQLite file first.');
    await register(api.addPath({ path: pathInput.value }));
  }
  async function browse(): Promise<void> {
    await register(api.pick());
  }
  async function removeFile(c: DbConnectionView): Promise<void> {
    const r = await api.remove(c.id);
    if (!r.ok) return remember(r.failure.message);
    connections = r.data.connections;
    if (current?.id === c.id) clearCurrent();
    paintFiles();
  }

  async function exportCsv(result: DbResultSet | null, name: string): Promise<void> {
    if (result === null || result.columns.length === 0) return;
    const r = await api.exportCsv({ csv: toCsv(result.columns, result.rows), name });
    if (!r.ok) return say(`${r.failure.title}. ${r.failure.message}`);
    say(r.data.saved ? `Saved ${r.data.fileName ?? 'the CSV'}.` : '');
  }

  function paintRun(status: string, failure?: DbFailure, result?: DbResultSet): void {
    sqlStatus.replaceChildren();
    sqlBody.replaceChildren();
    sqlCsv.hidden = result === undefined || result.columns.length === 0;
    if (failure !== undefined) {
      sqlBody.append(problemCard(failure));
      return;
    }
    if (result === undefined) {
      if (status !== '') sqlStatus.append(el('span', 'hint', status));
      return;
    }
    sqlStatus.append(chipOf(result.kind === 'read' ? 'Read' : result.kind === 'write' ? 'Changed data' : 'Changed schema', result.kind === 'read' ? 'green' : 'red'), el('span', 'hint', resultLine(result)));
    const note = truncationNote(result);
    if (note !== null) sqlBody.append(el('div', 'notice db-trunc', note));
    sqlBody.append(resultTable(result));
  }

  async function run(): Promise<void> {
    if (running !== null) return;
    if (current === null) return paintRun('', { kind: 'bad-input', title: 'No file open', message: 'Add or pick a SQLite file first.', help: null });
    const text = editor.textOf('sql') ?? '';
    let statement: SqlStatement;
    try {
      statement = SqlStatement.parse(text);
      statement.assertAllowed({ writeMode, confirm: true });
    } catch (error) {
      const m = error instanceof DbInputError ? error.message : 'That SQL cannot be run.';
      const kind = error instanceof DbInputError && error.kind === 'write-mode' ? 'write-mode' : 'bad-input';
      return paintRun('', { kind, title: kind === 'write-mode' ? 'Write mode is off' : 'That statement cannot be run', message: m, help: kind === 'write-mode' ? 'Turn on Write mode (top right) if you really want to change this file.' : null });
    }
    let confirmed = false;
    if (statement.needsWriteMode()) {
      const answer = await askDialog({ title: `Run ${statement.verb} on ${current.path.split(/[\\/]/).pop() ?? 'this file'}?`, body: `${sqlPreview(statement.text)}\n\nThis changes the file and cannot be undone.`, okLabel: 'Run', danger: true });
      if (!answer.ok) return;
      confirmed = true;
    }
    runCount += 1;
    const key = `q${Date.now().toString(36)}${runCount}`;
    running = key;
    runBtn.disabled = true;
    cancelBtn.hidden = false;
    paintRun('Running…');
    const id = current.id;
    const r = await api.query({ id, sql: statement.text, writeMode, confirm: confirmed, timeoutSec, key });
    running = null;
    runBtn.disabled = false;
    cancelBtn.hidden = true;
    if (!r.ok) {
      lastResult = null;
      return paintRun('', r.failure);
    }
    lastResult = r.data;
    paintRun('', undefined, r.data);
    // 구조나 데이터를 바꿨으면 목록·행 보기를 새로 읽는다
    if (r.data.kind !== 'read' && current?.id === id) {
      const open = table;
      const list = await api.tables(id);
      if (list.ok && current?.id === id) {
        tables = list.data;
        if (open !== null && !tables.some((t) => t.name === open)) {
          table = null;
          detail = null;
        }
        rowsPage = null;
        detail = table === null ? null : detail;
        paintTables();
        paintMain();
      }
    }
  }

  // 한 번 그려 놓고 목록을 읽는다
  paintMode();
  paintFiles();
  paintTables();
  paintMain();
  void refreshList();

  return { root };
}
