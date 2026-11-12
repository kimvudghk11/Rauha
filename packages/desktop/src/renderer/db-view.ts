import { DB_LIMIT_NOTE, type DbApi, type DbFailure, type DbResult, type DbResultSet, type DbRowsPage, type DbTableDetail, type DbTableInfo } from '../shared/db-api.js';
import type { DbConnectionView } from '../shared/db-connections.js';
import { toCsv } from '../shared/db-csv.js';
import { QueryHistory } from '../shared/db-history.js';
import { DbInputError } from '../shared/db-names.js';
import type { DbKind } from '../shared/db-server.js';
import { SqlStatement } from '../shared/db-sql.js';
import { statementAt } from '../shared/db-sql-pick.js';
import { cellClass, cellCopyText, cellDetail, filterTables, nextSort, pageCount, pageLabel, resultLine, rowsAsTsv, sqlPreview, truncationNote } from '../shared/db-view-text.js';
import { CodeEditor } from './code-editor.js';
import { buildServerForm } from './db-server-form.js';
import { resultTable, type PickedCell } from './db-table.js';
import { el, isEnterKey } from './dom.js';
import { askDialog } from './git-common.js';
import { button, chipOf, select, showMenu } from './todo-parts.js';

export interface DbViewDeps {
  readonly api: DbApi;
  /** 클립보드에 글을 쓴다(되면 true). 없으면 navigator.clipboard */
  readonly copy?: (text: string) => Promise<boolean>;
}

type Sub = 'schema' | 'rows' | 'sql';
const SUBS: readonly (readonly [Sub, string])[] = [
  ['rows', 'Rows'],
  ['schema', 'Structure'],
  ['sql', 'SQL'],
];
const TIMEOUTS: readonly (readonly [string, string])[] = [
  ['10', '10 s limit'],
  ['30', '30 s limit'],
  ['60', '60 s limit'],
];
const LAST_KEY = 'rauha.db.last';
const HISTORY_KEY = 'rauha.db.history';
/** 편집기에 처음 넣어 두는 예시(연결 종류마다) */
const SAMPLES: Readonly<Record<DbKind, string>> = {
  sqlite: 'SELECT name, type FROM sqlite_schema ORDER BY name;',
  mysql: 'SHOW TABLES;',
  postgres: 'SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = current_schema() ORDER BY table_name;',
};
const KIND_LABEL: Readonly<Record<DbKind, string>> = { sqlite: 'SQLite', mysql: 'MySQL', postgres: 'PostgreSQL' };
/** 연결 목록의 종류 표시(작은 글자 배지) */
const KIND_BADGE: Readonly<Record<DbKind, string>> = { sqlite: 'SQ', mysql: 'My', postgres: 'Pg' };
/** 이름을 SQL 에 끼울 때: MySQL 은 백틱, 나머지는 큰따옴표 */
const quoteFor = (kind: DbKind, name: string): string => (kind === 'mysql' ? `\`${name.replace(/`/g, '``')}\`` : `"${name.replace(/"/g, '""')}"`);
const INDENT = { unit: 'space', size: 2, tabWidth: 2, source: 'default' } as const;
const IS_MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
const RUN_KEY = IS_MAC ? '⌘↵' : 'Ctrl+Enter';

const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* 기억하지 못해도 된다 */
    }
  },
};
const readHistory = (): QueryHistory => {
  try {
    return QueryHistory.restore(JSON.parse(store.get(HISTORY_KEY) ?? '[]'));
  } catch {
    return QueryHistory.empty();
  }
};

function problemCard(f: DbFailure, retry?: () => void): HTMLElement {
  const card = el('div', 'item db-problem');
  card.append(el('b', 'err', f.title), el('div', 'dim db-msg', f.message));
  if (f.help !== null) card.append(el('div', 'hint', f.help));
  if (retry !== undefined) card.append(button('Try again', 'btn sm', retry));
  return card;
}
function empty(title: string, body: string, ...actions: HTMLElement[]): HTMLElement {
  const box = el('div', 'empty db-empty');
  box.append(el('b', undefined, title), el('span', 'hint', body));
  if (actions.length > 0) {
    const bar = el('div', 'bar');
    bar.append(...actions);
    box.append(bar);
  }
  return box;
}
function loading(text: string): HTMLElement {
  const box = el('div', 'db-loading hint');
  box.append(el('span', 'db-spin'), el('span', undefined, text));
  return box;
}

/**
 * DB 탭: SQLite 파일이나 MySQL·PostgreSQL 서버를 열어 테이블·구조·행·SQL 결과를 본다. 화면은 그리기만 하고,
 * 어떤 SQL 이 쓰기인지·경로가 맞는지·상한은 shared 와 main 이 정한다(여기서 한 검사는 빠른 안내용일 뿐이다).
 * 기본은 읽기 전용이고, 쓰기 문장은 Write mode 를 켜고 확인 창에서 허락해야 main 으로 간다.
 */
export function buildDb(deps: DbViewDeps) {
  const api = deps.api;
  const copy = deps.copy ?? (async (text: string): Promise<boolean> => navigator.clipboard.writeText(text).then(() => true, () => false));
  const root = el('section', 'db');
  let connections: readonly DbConnectionView[] = [];
  let current: DbConnectionView | null = null;
  /** 연결마다 마지막 상태(목록의 점): 열림 · 실패 · 여는 중 */
  const status = new Map<string, 'ok' | 'error' | 'busy'>();
  let tables: readonly DbTableInfo[] = [];
  let tablesLoading = false;
  let filter = '';
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
  let canSavePasswords = false;
  let history = readHistory();

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
    fileHint.textContent = current === null ? 'No database open' : `${KIND_LABEL[current.kind]} · ${current.path}`;
    fileHint.title = current === null ? '' : current.path;
    say(writeMode ? 'Write mode is on. A statement that changes data asks you to confirm before it runs, and it cannot be undone.' : '');
  };
  writeBox.addEventListener('change', () => {
    writeMode = writeBox.checked && current !== null;
    paintMode();
  });

  // ── 왼쪽: 연결 · 테이블 ──

  const fileList = el('div', 'db-files');
  const tableFilter = el('input', 'sm db-filter');
  tableFilter.type = 'search';
  tableFilter.placeholder = 'Filter tables';
  tableFilter.spellcheck = false;
  tableFilter.setAttribute('aria-label', 'Filter tables');
  tableFilter.addEventListener('input', () => {
    filter = tableFilter.value;
    paintTables();
  });
  tableFilter.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && tableFilter.value !== '') {
      e.stopPropagation();
      tableFilter.value = filter = '';
      paintTables();
    } else if (isEnterKey(e)) {
      const first = filterTables(tables, filter)[0];
      if (first !== undefined) void pickTable(first.name);
    }
  });
  const tableList = el('div', 'db-tables');
  const side = el('div', 'pane db-side');
  const filesHead = el('div', 'ph');
  // 새 연결은 단추 하나: 가운데 모달에서 종류(PostgreSQL·MySQL·SQLite 파일)부터 고른다
  const newConn = button('+ New connection', 'btn sm', () => openForm('new'));
  newConn.title = 'Connect to PostgreSQL or MySQL, or open a SQLite file';
  filesHead.append(el('b', 'grow', 'Connections'), newConn);
  const tablesHead = el('div', 'ph');
  const tablesTitle = el('b', 'grow', 'Tables');
  const tablesReload = button('↻', 'btn icon sm ghost', () => void reloadTables());
  tablesReload.title = 'Reload the table list';
  tablesReload.setAttribute('aria-label', 'Reload the table list');
  tablesHead.append(tablesTitle, tablesReload);
  const filterWrap = el('div', 'db-filterbar');
  filterWrap.append(tableFilter);
  side.append(filesHead, fileList, tablesHead, filterWrap, tableList);

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
  const form = buildServerForm({
    api,
    canSavePasswords: () => canSavePasswords,
    onSaved: (v) => void afterSaved(v),
    onClose: () => paintForm(),
    addFile: async (path) => {
      const r = await (path === undefined ? api.pick() : api.addPath({ path }));
      if (!r.ok) return r.failure;
      if (r.data === null) return 'cancelled';
      form.close();
      await refreshList(r.data.id);
      if (current?.id !== r.data.id) await openFile(r.data);
      return null;
    },
  });
  main.append(tabsRow, schemaPanel, rowsPanel, sqlPanel);
  // 연결 폼은 가운데 모달(바깥을 누르거나 Esc 로 닫힌다)
  const formLayer = el('div', 'veil db-form-layer');
  formLayer.hidden = true;
  formLayer.append(form.root);
  formLayer.addEventListener('mousedown', (e) => {
    if (e.target === formLayer) form.close();
  });
  const body = el('div', 'db-body');
  body.append(side, main);
  root.append(head, limit, notice, body, formLayer);

  // ── 칸 상세(고른 칸의 전체 값 · 복사) ──
  function cellPane(): { readonly root: HTMLElement; show(p: PickedCell, columns: readonly string[]): void; hide(): void } {
    const pane = el('div', 'db-detail');
    pane.hidden = true;
    const title = el('span', 'hint grow db-detail-title');
    const pre = el('pre', 'db-detail-body mono');
    let picked: { p: PickedCell; columns: readonly string[] } | null = null;
    const copied = async (text: string, what: string): Promise<void> => say((await copy(text)) ? `Copied ${what}.` : 'Could not copy to the clipboard.');
    const bar = el('div', 'bar db-detail-bar');
    bar.append(
      title,
      button('Copy value', 'btn sm', () => {
        if (picked !== null) void copied(cellCopyText(picked.p.cell), 'the value');
      }),
      button('Copy row', 'btn sm', () => {
        if (picked !== null) void copied(rowsAsTsv(picked.columns, [picked.p.values], true), 'the row (tab-separated, with column names)');
      }),
      button('×', 'btn icon sm ghost', () => hide()),
    );
    pane.append(bar, pre);
    function show(p: PickedCell, columns: readonly string[]): void {
      picked = { p, columns };
      const c = p.cell;
      const kind = cellClass(c);
      const size = typeof c === 'string' ? ` · ${c.length.toLocaleString('en-US')} chars` : typeof c === 'object' && c !== null ? ` · ${c.blob.toLocaleString('en-US')} bytes` : '';
      title.textContent = `${p.column} · row ${p.row + 1} · ${kind === 'num' ? 'number' : kind === 'null' ? 'NULL' : kind === 'blob' ? 'BLOB' : 'text'}${size}`;
      pre.textContent = cellDetail(c);
      pre.classList.toggle('null', c === null);
      pane.hidden = false;
    }
    function hide(): void {
      pane.hidden = true;
      picked = null;
    }
    return { root: pane, show, hide };
  }

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
  const rowsCell = cellPane();
  rowsPanel.append(rowsBar, rowsNote, rowsBody, rowsCell.root);

  // ── SQL 칸 ──
  const editorHost = el('div', 'db-editor');
  const editor = new CodeEditor(editorHost, { onChange: () => undefined, onCursor: () => undefined });
  editor.add('sql', SAMPLES.sqlite, 'sql', INDENT, false);
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
  const runBtn = button('Run', 'btn run', () => void run());
  runBtn.title = `Run the statement at the cursor, or only the selected text (${RUN_KEY})`;
  const cancelBtn = button('Cancel', 'btn', () => {
    if (running !== null) void api.cancel(running);
  });
  cancelBtn.hidden = true;
  const timeoutSel = select(TIMEOUTS, '10', (v) => (timeoutSec = Number(v)));
  timeoutSel.classList.add('sm');
  timeoutSel.setAttribute('aria-label', 'Query time limit');
  const historyBtn = button('History', 'btn sm', () => openHistory());
  historyBtn.title = 'Recent queries on this connection';
  const sqlHint = el('span', 'hint grow db-sqlhint', `${RUN_KEY} runs the statement at the cursor (or the selection)`);
  const sqlCsv = button('Export CSV', 'btn sm', () => void exportCsv(lastResult, 'result'));
  sqlCsv.hidden = true;
  const sqlBar = el('div', 'bar db-sqlbar');
  sqlBar.append(runBtn, cancelBtn, timeoutSel, historyBtn, sqlHint, sqlCsv);
  const sqlStatus = el('div', 'bar db-status');
  const sqlBody = el('div', 'db-result');
  const sqlCell = cellPane();
  sqlPanel.append(editorHost, sqlBar, sqlStatus, sqlBody, sqlCell.root);

  // ── 그리기 ──
  function paintFiles(): void {
    fileList.replaceChildren();
    if (connections.length === 0) {
      fileList.append(el('div', 'hint db-pad', 'No connections yet. Add a MySQL / PostgreSQL server, or type the path of a SQLite file.'));
      return;
    }
    for (const c of connections) {
      const row = el('div', c.id === current?.id ? 'row-item db-row db-conn on' : 'row-item db-row db-conn');
      row.tabIndex = 0;
      row.title = `${KIND_LABEL[c.kind]} · ${c.path}`;
      const badge = el('span', `db-badge ${c.kind}`, KIND_BADGE[c.kind]);
      badge.setAttribute('aria-label', KIND_LABEL[c.kind]);
      const text = el('span', 'db-conn-text');
      const sub = c.server === null ? c.path : `${c.server.user}@${c.server.host}:${c.server.port}/${c.server.database}`;
      text.append(el('span', 'db-name', c.name), el('span', 'db-conn-sub', sub));
      const st = status.get(c.id);
      const dot = el('span', `db-state ${st ?? ''}`);
      dot.title = st === 'ok' ? 'Connected' : st === 'error' ? 'Last attempt failed' : st === 'busy' ? 'Connecting…' : 'Not opened yet';
      row.append(badge, text, dot);
      const actions = el('span', 'db-conn-actions');
      const act = (label: string, title: string, run: () => void): HTMLButtonElement => {
        const b = button(label, 'btn icon sm ghost', run);
        b.title = title;
        b.setAttribute('aria-label', title);
        b.addEventListener('click', (e) => e.stopPropagation());
        return b;
      };
      if (c.server !== null) {
        actions.append(act('✎', `Edit ${c.name}`, () => openForm('edit', c)), act('⧉', `Duplicate ${c.name}`, () => openForm('copy', c)));
      }
      actions.append(act('×', c.kind === 'sqlite' ? `Remove ${c.name} from this list (the file is not deleted)` : `Remove ${c.name} from this list (the database is not changed${c.savedPassword === true ? ', the saved password is deleted' : ''})`, () => void removeFile(c)));
      row.append(actions);
      row.addEventListener('click', () => void openFile(c));
      row.addEventListener('keydown', (e) => {
        if (isEnterKey(e)) void openFile(c);
      });
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showMenu({ x: e.clientX, y: e.clientY }, [
          { label: 'Open', pick: () => void openFile(c) },
          ...(c.server === null ? [] : [{ label: 'Edit…', pick: () => openForm('edit', c) }, { label: 'Duplicate…', pick: () => openForm('copy', c) }]),
          { label: 'Copy address', pick: () => void copy(c.path).then((ok) => say(ok ? 'Copied the address (no password).' : 'Could not copy to the clipboard.')) },
          'sep',
          { label: 'Remove from list', danger: true, pick: () => void removeFile(c) },
        ]);
      });
      fileList.append(row);
    }
  }
  function paintTables(): void {
    tableList.replaceChildren();
    const shown = filterTables(tables, filter);
    tablesTitle.textContent = tables.length === 0 ? 'Tables' : filter.trim() === '' ? `Tables (${tables.length})` : `Tables (${shown.length} of ${tables.length})`;
    tablesReload.disabled = current === null || tablesLoading;
    filterWrap.hidden = tables.length === 0;
    if (current === null) return;
    if (tablesLoading) return void tableList.append(loading(current.kind === 'sqlite' ? 'Reading tables…' : `Connecting to ${current.server?.host ?? current.name}…`));
    if (status.get(current.id) === 'error' && tables.length === 0) return void tableList.append(el('div', 'hint db-pad', 'Could not open this database. See the message on the right.'));
    if (tables.length === 0) {
      tableList.append(el('div', 'hint db-pad', current.kind === 'sqlite' ? 'This file has no tables.' : current.kind === 'postgres' ? 'No tables in the current schema (search_path). Other schemas: use the SQL tab.' : 'No tables in this database.'));
      return;
    }
    if (shown.length === 0) return void tableList.append(el('div', 'hint db-pad', `No table matches “${filter.trim()}”.`));
    for (const t of shown) {
      const row = el('div', t.name === table ? 'row-item db-row on' : 'row-item db-row');
      row.tabIndex = 0;
      row.title = t.name;
      row.append(el('span', `db-ticon ${t.kind}`, t.kind === 'view' ? '◇' : '▦'), el('span', 'db-name', t.name));
      if (t.kind === 'view') row.append(chipOf('view', 'blue'));
      row.addEventListener('click', () => void pickTable(t.name));
      row.addEventListener('keydown', (e) => {
        if (isEnterKey(e)) void pickTable(t.name);
      });
      tableList.append(row);
    }
  }
  function paintForm(): void {
    const open = form.isOpen();
    formLayer.hidden = !open;
    newConn.classList.toggle('on', open);
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
    if (failure !== undefined) return void schemaPanel.append(problemCard(failure, () => void loadDetail()));
    if (detail === null) return void schemaPanel.append(table === null ? empty('Pick a table', 'Choose a table on the left to see its columns.') : loading('Loading columns…'));
    const bar = el('div', 'bar');
    bar.append(chipOf(detail.kind === 'view' ? 'View' : 'Table', detail.kind === 'view' ? 'blue' : ''), el('span', 'hint grow', `${detail.columns.length} columns`));
    bar.append(
      button('Browse rows', 'btn sm', () => switchSub('rows')),
      button('Query it', 'btn sm', () => {
        editor.replace('sql', `SELECT * FROM ${quoteFor(current?.kind ?? 'sqlite', detail?.name ?? '')} LIMIT 100;`, 'sql', INDENT, false);
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
      const key = el('td', 'db-cell text', c.primaryKey > 0 ? `PK ${c.primaryKey}` : '');
      if (c.primaryKey > 0) key.classList.add('db-pk');
      tr.append(el('td', 'db-cell text db-colname', c.hidden ? `${c.name} (hidden)` : c.name), el('td', 'db-cell text db-type', c.type === '' ? '—' : c.type), el('td', `db-cell text${c.notNull ? '' : ' null'}`, c.notNull ? 'NOT NULL' : 'NULL'), el('td', 'db-cell text', c.defaultValue ?? '—'), key);
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
    rowsCell.hide();
    const has = rowsPage !== null && failure === undefined;
    prevBtn.disabled = !has || page <= 0;
    nextBtn.disabled = !has || page + 1 >= pageCount(rowsPage!.total, rowsPage!.pageSize);
    rowsCsv.disabled = !has;
    rowsRefresh.disabled = table === null;
    if (failure !== undefined) {
      pageText.textContent = '';
      return void rowsBody.append(problemCard(failure, () => void loadRows()));
    }
    if (rowsPage === null) {
      pageText.textContent = '';
      return void rowsBody.append(table === null ? empty('Pick a table', tables.length === 0 ? 'This database has no tables to browse. Use the SQL tab to run a query.' : 'Choose a table on the left to see its rows.') : loading(`Loading ${table}…`));
    }
    pageText.textContent = `${pageLabel(rowsPage.page, rowsPage.total, rowsPage.pageSize)} · ${rowsPage.result.elapsedMs.toLocaleString('en-US')} ms`;
    const note = truncationNote(rowsPage.result);
    rowsNote.hidden = note === null;
    rowsNote.textContent = note ?? '';
    const columns = rowsPage.result.columns;
    rowsBody.append(resultTable(rowsPage.result, { sort, onSort: (col) => void sortBy(col), firstRowNumber: rowsPage.page * rowsPage.pageSize + 1, onPick: (p) => rowsCell.show(p, columns) }));
  }
  function paintMain(failure?: DbFailure): void {
    paintSub();
    if (current === null) {
      const startButton = (): HTMLButtonElement => button('+ New connection', 'btn primary', () => openForm('new'));
      schemaPanel.replaceChildren(empty('No database open', 'Connect to a MySQL or PostgreSQL server, or open a SQLite file.', startButton()));
      rowsBody.replaceChildren(empty('No database open', 'Connect to a MySQL or PostgreSQL server, or open a SQLite file.', startButton()));
      prevBtn.disabled = nextBtn.disabled = rowsCsv.disabled = rowsRefresh.disabled = true;
      pageText.textContent = '';
      return;
    }
    if (failure !== undefined) {
      const c = current;
      const retry = (): void => void openFile(c);
      const card = (): HTMLElement => {
        const box = problemCard(failure, retry);
        if (c.server !== null) box.append(button('Edit connection…', 'btn sm', () => openForm('edit', c)));
        return box;
      };
      schemaPanel.replaceChildren(card());
      rowsBody.replaceChildren(card());
      prevBtn.disabled = nextBtn.disabled = rowsCsv.disabled = rowsRefresh.disabled = true;
      return;
    }
    if (tablesLoading) {
      const text = current.kind === 'sqlite' ? `Opening ${current.name}…` : `Connecting to ${current.server?.host ?? current.name}…`;
      schemaPanel.replaceChildren(loading(text));
      rowsBody.replaceChildren(loading(text));
      prevBtn.disabled = nextBtn.disabled = rowsCsv.disabled = rowsRefresh.disabled = true;
      pageText.textContent = '';
      return;
    }
    paintSchema();
    paintRows();
  }

  // ── 동작 ──
  function switchSub(next: Sub): void {
    sub = next;
    paintSub();
    if (next === 'sql') editor.focus();
    if (current === null || table === null) return;
    if (next === 'rows' && rowsPage === null) void loadRows();
    if (next === 'schema' && detail === null) void loadDetail();
  }

  function openForm(kind: 'new' | 'edit' | 'copy', c?: DbConnectionView): void {
    if (kind === 'new' || c === undefined) form.openNew();
    else if (kind === 'edit') form.openEdit(c);
    else form.openCopy(c);
    paintForm();
  }

  async function afterSaved(v: DbConnectionView): Promise<void> {
    paintForm();
    // 고친 연결이 열려 있었으면 새 값으로 다시 연다
    if (current?.id === v.id) current = null;
    await refreshList(v.id);
    if (current?.id !== v.id) await openFile(v);
  }

  async function refreshList(selectId?: string): Promise<void> {
    const r = await api.list();
    if (!r.ok) {
      say(`${r.failure.title}. ${r.failure.message}`);
      return;
    }
    connections = r.data.connections;
    canSavePasswords = r.data.canSavePasswords;
    form.refresh();
    paintFiles();
    const want = selectId ?? store.get(LAST_KEY) ?? undefined;
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
    if (form.isOpen()) form.close();
    current = c;
    writeMode = false;
    table = null;
    detail = null;
    rowsPage = null;
    sort = null;
    page = 0;
    tables = [];
    tablesLoading = true;
    tableFilter.value = filter = '';
    status.set(c.id, 'busy');
    store.set(LAST_KEY, c.id);
    // 편집기가 아직 예시 그대로면 이 DB 의 예시로 바꾼다
    if (Object.values(SAMPLES).includes(editor.textOf('sql') ?? '')) editor.replace('sql', SAMPLES[c.kind], 'sql', INDENT, false);
    paintFiles();
    paintTables();
    paintMode();
    paintMain();
    let r = await api.tables(c.id);
    if (mine !== seq) return;
    // 저장한 비밀번호가 없는 서버: 물어서 받으면 한 번 더
    if (!r.ok && r.failure.kind === 'need-password' && (await askPassword(c, r.failure))) {
      if (mine !== seq) return;
      r = await api.tables(c.id);
      if (mine !== seq) return;
    }
    tablesLoading = false;
    status.set(c.id, r.ok ? 'ok' : 'error');
    paintFiles();
    if (!r.ok) {
      paintTables();
      paintMain(r.failure);
      return;
    }
    tables = r.data;
    paintTables();
    const first = tables[0];
    if (first !== undefined) await pickTable(first.name);
    else paintMain();
  }

  async function reloadTables(): Promise<void> {
    if (current === null) return;
    const c = current;
    const mine = seq;
    tablesLoading = true;
    paintTables();
    const r = await api.tables(c.id);
    if (mine !== seq) return;
    tablesLoading = false;
    status.set(c.id, r.ok ? 'ok' : 'error');
    if (r.ok) tables = r.data;
    else say(`${r.failure.title}. ${r.failure.message}`);
    paintFiles();
    paintTables();
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
    if (rowsPage === null) paintRows();
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

  /** 비밀번호 창. 접속이 되면 true. 비밀번호는 main 으로만 가고 화면에 남기지 않는다 */
  async function askPassword(c: DbConnectionView, why: DbFailure): Promise<boolean> {
    let note = why.message;
    for (;;) {
      const answer = await askDialog({ title: `Connect to ${c.name}`, body: `${note}\n${c.path}`, input: { label: 'Password', value: '', secret: true }, okLabel: 'Connect' });
      if (!answer.ok) return false;
      // 전에 저장해 두었다면(이 컴퓨터에서 못 풀었을 때) 다시 저장하고, 저장하지 않기로 했으면 이번 실행 동안만 기억한다
      const r = await api.unlock({ id: c.id, password: answer.value, savePassword: c.savedPassword === true && canSavePasswords });
      if (r.ok) return true;
      if (r.failure.kind !== 'auth') {
        paintMain(r.failure);
        return false;
      }
      note = `${r.failure.title}. ${r.failure.help ?? ''}`.trim();
    }
  }
  async function removeFile(c: DbConnectionView): Promise<void> {
    const r = await api.remove(c.id);
    if (!r.ok) return say(r.failure.message);
    connections = r.data.connections;
    canSavePasswords = r.data.canSavePasswords;
    status.delete(c.id);
    if (current?.id === c.id) clearCurrent();
    paintFiles();
  }

  async function exportCsv(result: DbResultSet | null, name: string): Promise<void> {
    if (result === null || result.columns.length === 0) return;
    const r = await api.exportCsv({ csv: toCsv(result.columns, result.rows), name });
    if (!r.ok) return say(`${r.failure.title}. ${r.failure.message}`);
    say(r.data.saved ? `Saved ${r.data.fileName ?? 'the CSV'}.` : '');
  }

  function openHistory(): void {
    const items = current === null ? [] : history.forConnection(current.id).slice(0, 20);
    showMenu(historyBtn, items.length === 0 ? [{ heading: 'No queries yet on this connection' }] : [
      { heading: 'Recent queries — pick one to put it in the editor' },
      ...items.map((i) => ({ label: QueryHistory.oneLine(i.sql), pick: () => {
        editor.replace('sql', i.sql, 'sql', INDENT, false);
        editor.focus();
      } })),
    ]);
  }

  function paintRun(status: string, failure?: DbFailure, result?: DbResultSet, ran?: string): void {
    sqlStatus.replaceChildren();
    sqlBody.replaceChildren();
    sqlCell.hide();
    sqlCsv.hidden = result === undefined || result.columns.length === 0;
    if (failure !== undefined) {
      sqlBody.append(problemCard(failure));
      return;
    }
    if (result === undefined) {
      if (status !== '') sqlBody.append(loading(status));
      return;
    }
    sqlStatus.append(chipOf(result.kind === 'read' ? 'Read' : result.kind === 'write' ? 'Changed data' : 'Changed schema', result.kind === 'read' ? 'green' : 'red'), el('span', 'hint', resultLine(result)));
    if (ran !== undefined) {
      const q = el('span', 'hint grow db-ran mono', QueryHistory.oneLine(ran));
      q.title = ran;
      sqlStatus.append(q);
    }
    const note = truncationNote(result);
    if (note !== null) sqlBody.append(el('div', 'notice db-trunc', note));
    if (result.columns.length === 0) {
      sqlBody.append(el('div', 'hint db-none', result.kind === 'read' ? 'The statement returned no columns.' : 'Done.'));
      return;
    }
    sqlBody.append(resultTable(result, { onPick: (p) => sqlCell.show(p, result.columns) }));
  }

  async function run(): Promise<void> {
    if (running !== null) return;
    if (current === null) return paintRun('', { kind: 'bad-input', title: 'No database open', message: 'Add a SQLite file or a server first.', help: null });
    const range = editor.cursorRange();
    const text = statementAt(editor.textOf('sql') ?? '', range.head, range.from === range.to ? null : range);
    if (text === '') return paintRun('', { kind: 'bad-input', title: 'Nothing to run', message: 'Type a SQL statement first.', help: null });
    let statement: SqlStatement;
    try {
      statement = SqlStatement.parse(text, current.kind);
      statement.assertAllowed({ writeMode, confirm: true });
    } catch (error) {
      const m = error instanceof DbInputError ? error.message : 'That SQL cannot be run.';
      const kind = error instanceof DbInputError && error.kind === 'write-mode' ? 'write-mode' : 'bad-input';
      return paintRun('', { kind, title: kind === 'write-mode' ? 'Write mode is off' : 'That statement cannot be run', message: m, help: kind === 'write-mode' ? 'Turn on Write mode (top right) if you really want to change this database.' : null });
    }
    let confirmed = false;
    if (statement.needsWriteMode()) {
      const answer = await askDialog({ title: `Run ${statement.verb} on ${current.name}?`, body: `${sqlPreview(statement.text)}\n\nThis changes the ${current.kind === 'sqlite' ? 'file' : 'database on the server'} and cannot be undone.`, okLabel: 'Run', danger: true });
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
    history = history.add(statement.text, id, Date.now());
    store.set(HISTORY_KEY, JSON.stringify(history.toJSON()));
    const r = await api.query({ id, sql: statement.text, writeMode, confirm: confirmed, timeoutSec, key });
    running = null;
    runBtn.disabled = false;
    cancelBtn.hidden = true;
    if (!r.ok) {
      lastResult = null;
      return paintRun('', r.failure);
    }
    lastResult = r.data;
    paintRun('', undefined, r.data, statement.text);
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
