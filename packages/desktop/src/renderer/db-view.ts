import { DB_LIMIT_NOTE, type DbApi, type DbFailure, type DbResultSet, type DbTableDetail, type DbTableInfo } from '../shared/db-api.js';
import type { DbConnectionView } from '../shared/db-connections.js';
import { toCsv } from '../shared/db-csv.js';
import type { DbSchemaGraph } from '../shared/db-diagram.js';
import { QueryHistory } from '../shared/db-history.js';
import { DbInputError } from '../shared/db-names.js';
import { envOf, groupConnections, guessEnv, type DbEnv } from '../shared/db-organize.js';
import type { DbKind } from '../shared/db-server.js';
import { SqlStatement } from '../shared/db-sql.js';
import { statementAt } from '../shared/db-sql-pick.js';
import { browseSql, cellClass, cellCopyText, cellDetail, filterTables, resultLine, rowsAsTsv, sqlPreview, truncationNote, viaLine, viaShort } from '../shared/db-view-text.js';
import { CodeEditor } from './code-editor.js';
import { buildDiagram } from './db-diagram.js';
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

/** 가운데 칸: SQL(편집기 + 결과) · Diagram(테이블 시각화) */
type Sub = 'sql' | 'diagram';
const SUBS: readonly (readonly [Sub, string])[] = [
  ['sql', 'SQL'],
  ['diagram', 'Diagram'],
];
const TIMEOUTS: readonly (readonly [string, string])[] = [
  ['10', '10 s limit'],
  ['30', '30 s limit'],
  ['60', '60 s limit'],
];
const LAST_KEY = 'rauha.db.last';
const HISTORY_KEY = 'rauha.db.history';
/** 접어 둔 연결 그룹 이름들 */
const CLOSED_GROUPS_KEY = 'rauha.db.closedGroups';
/** 편집기에 처음 넣어 두는 예시(연결 종류마다) */
const SAMPLES: Readonly<Record<DbKind, string>> = {
  sqlite: 'SELECT name, type FROM sqlite_schema ORDER BY name;',
  mysql: 'SHOW TABLES;',
  postgres: 'SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = current_schema() ORDER BY table_name;',
};
const KIND_LABEL: Readonly<Record<DbKind, string>> = { sqlite: 'SQLite', mysql: 'MySQL', postgres: 'PostgreSQL' };
/** 연결 목록의 종류 표시(작은 글자 배지) */
const KIND_BADGE: Readonly<Record<DbKind, string>> = { sqlite: 'SQ', mysql: 'My', postgres: 'Pg' };
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

/** 접속 중 안내: 주소가 여럿이면 몇 개를 차례로 시도하는지 */
const connectingText = (c: DbConnectionView): string => {
  if (c.server === null) return `Opening ${c.name}…`;
  const n = c.server.addresses.length;
  return n > 1 ? `Connecting… trying ${n} addresses in order` : `Connecting to ${c.server.addresses[0]?.host ?? c.name}…`;
};

/**
 * DB 탭: SQLite 파일이나 MySQL·PostgreSQL 서버를 열어 SQL 을 돌리고 결과를 본다(가운데는 SQL 편집기 + 결과).
 * 왼쪽 테이블을 누르면 SELECT * … LIMIT 100 을 넣고 바로 돌린다. ⓘ 는 그 테이블 구조, Diagram 탭은 테이블·FK 관계 그림.
 * 화면은 그리기만 하고, 어떤 SQL 이 쓰기인지·경로가 맞는지·상한은 shared 와 main 이 정한다(여기서 한 검사는 빠른 안내용일 뿐이다).
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
  let openFailure: DbFailure | null = null;
  let tables: readonly DbTableInfo[] = [];
  let tablesLoading = false;
  let filter = '';
  let table: string | null = null;
  let sub: Sub = 'sql';
  let writeMode = false;
  let running: string | null = null;
  let runCount = 0;
  let timeoutSec = 10;
  let lastResult: DbResultSet | null = null;
  let seq = 0;
  let canSavePasswords = false;
  let history = readHistory();
  /** Diagram 재료(연결마다 한 번 읽고, 구조를 바꾸면 버린다) */
  let graph: DbSchemaGraph | null = null;
  let graphLoading = false;

  // ── 머리줄 ──
  const modeChip = el('span');
  const fileHint = el('span', 'hint grow db-file-hint');
  const viaText = el('span', 'db-via');
  viaText.hidden = true;
  const writeBox = el('input');
  writeBox.type = 'checkbox';
  writeBox.setAttribute('aria-label', 'Write mode');
  const writeLabel = el('label', 'db-write');
  writeLabel.append(writeBox, el('span', undefined, 'Write mode'));
  writeLabel.title = 'Allow INSERT, UPDATE, DELETE and schema changes. Each one still asks for confirmation.';
  const head = el('div', 'rhead db-head');
  head.append(el('b', undefined, 'DB'), modeChip, viaText, fileHint, writeLabel);
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
    // 서버면 지금 붙어 있는 주소(여러 주소 중 몇 번째인지)
    const via = current !== null && status.get(current.id) === 'ok' ? current.via : null;
    viaText.hidden = via === null;
    viaText.textContent = via === null ? '' : viaLine(via);
    viaText.title = via === null ? '' : `${viaLine(via)}${via.total > 1 ? ` (tried in order; ${via.total} addresses saved)` : ''}`;
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
      if (first !== undefined) void browseTable(first.name);
    }
  });
  const tableList = el('div', 'db-tables');
  const side = el('div', 'pane db-side');
  const filesHead = el('div', 'ph');
  // 새 연결은 단추 하나: 가운데 모달에서 종류(PostgreSQL·MySQL·SQLite 파일)부터 고른다
  const newConn = button('+ New connection', 'btn sm', () => openForm('new'));
  newConn.title = 'Connect to PostgreSQL or MySQL, or open a SQLite file';
  filesHead.append(el('b', 'grow', 'Connections'), newConn);
  // 연결이 많아지면: 이름·주소·그룹·환경으로 거르는 칸(5개 이상일 때만 보인다)
  let connQuery = '';
  const connFilter = el('input', 'sm db-conn-filter');
  connFilter.placeholder = 'Filter connections (name, host, group, prod…)';
  connFilter.spellcheck = false;
  connFilter.setAttribute('aria-label', 'Filter connections');
  connFilter.addEventListener('input', () => {
    connQuery = connFilter.value;
    paintFiles();
  });
  connFilter.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && connFilter.value !== '') {
      e.stopPropagation();
      connFilter.value = connQuery = '';
      paintFiles();
    }
  });
  const closedGroups = new Set<string>(((): string[] => {
    try {
      const v: unknown = JSON.parse(store.get(CLOSED_GROUPS_KEY) ?? '[]');
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 100) : [];
    } catch {
      return [];
    }
  })());
  const tablesHead = el('div', 'ph');
  const tablesTitle = el('b', 'grow', 'Tables');
  const tablesReload = button('↻', 'btn icon sm ghost', () => void reloadTables());
  tablesReload.title = 'Reload the table list';
  tablesReload.setAttribute('aria-label', 'Reload the table list');
  tablesHead.append(tablesTitle, tablesReload);
  const filterWrap = el('div', 'db-filterbar');
  filterWrap.append(tableFilter);
  side.append(filesHead, connFilter, fileList, tablesHead, filterWrap, tableList);

  // ── 가운데: 탭(SQL · Diagram) ──
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

  const sqlPanel = el('div', 'db-panel');
  const diagramPanel = el('div', 'db-panel');
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
  main.append(tabsRow, sqlPanel, diagramPanel);
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
  const cellPaneEl = el('div', 'db-detail');
  cellPaneEl.hidden = true;
  const cellTitle = el('span', 'hint grow db-detail-title');
  const cellPre = el('pre', 'db-detail-body mono');
  let picked: { p: PickedCell; columns: readonly string[] } | null = null;
  const copied = async (text: string, what: string): Promise<void> => say((await copy(text)) ? `Copied ${what}.` : 'Could not copy to the clipboard.');
  const cellBar = el('div', 'bar db-detail-bar');
  cellBar.append(
    cellTitle,
    button('Copy value', 'btn sm', () => {
      if (picked !== null) void copied(cellCopyText(picked.p.cell), 'the value');
    }),
    button('Copy row', 'btn sm', () => {
      if (picked !== null) void copied(rowsAsTsv(picked.columns, [picked.p.values], true), 'the row (tab-separated, with column names)');
    }),
    button('×', 'btn icon sm ghost', () => hideCell()),
  );
  cellPaneEl.append(cellBar, cellPre);
  function showCell(p: PickedCell, columns: readonly string[]): void {
    picked = { p, columns };
    const c = p.cell;
    const kind = cellClass(c);
    const size = typeof c === 'string' ? ` · ${c.length.toLocaleString('en-US')} chars` : typeof c === 'object' && c !== null ? ` · ${c.blob.toLocaleString('en-US')} bytes` : '';
    cellTitle.textContent = `${p.column} · row ${p.row + 1} · ${kind === 'num' ? 'number' : kind === 'null' ? 'NULL' : kind === 'blob' ? 'BLOB' : 'text'}${size}`;
    cellPre.textContent = cellDetail(c);
    cellPre.classList.toggle('null', c === null);
    cellPaneEl.hidden = false;
  }
  function hideCell(): void {
    cellPaneEl.hidden = true;
    picked = null;
  }

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
  const sqlCsv = button('Export CSV', 'btn sm', () => void exportCsv(lastResult, table ?? 'result'));
  sqlCsv.hidden = true;
  const sqlBar = el('div', 'bar db-sqlbar');
  sqlBar.append(runBtn, cancelBtn, timeoutSel, historyBtn, sqlHint, sqlCsv);
  // 구조(ⓘ): 결과 위에 접히는 작은 칸
  const structPane = el('div', 'db-struct');
  structPane.hidden = true;
  const sqlStatus = el('div', 'bar db-status');
  const sqlBody = el('div', 'db-result');
  sqlPanel.append(editorHost, sqlBar, structPane, sqlStatus, sqlBody, cellPaneEl);

  // ── Diagram 칸 ──
  const diagram = buildDiagram({
    onPick: (name) => {
      table = name;
      paintTables();
      paintSub();
      if (graph !== null) diagram.show(graph, name, false);
    },
    onOpen: (name) => void browseTable(name),
  });
  const diagramMsg = el('div', 'db-result');
  diagramPanel.append(diagramMsg, diagram.root);

  // ── 그리기 ──
  /** 그룹·환경 고치기: 그룹 이름(있는 그룹에서 고르거나 새로 적기)과 환경(비우면 이름·주소로 추정) */
  function openRetag(c: DbConnectionView): void {
    const veil = el('div', 'veil');
    const box = el('div', 'dialog db-retag');
    box.setAttribute('role', 'dialog');
    const close = (): void => {
      veil.remove();
      document.removeEventListener('keydown', onKey, true);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') (e.stopPropagation(), close());
    };
    const groupIn = el('input');
    groupIn.value = c.group;
    groupIn.placeholder = 'e.g. Company A, Personal (empty = no group)';
    groupIn.spellcheck = false;
    const listId = `db-groups-${Date.now()}`;
    groupIn.setAttribute('list', listId);
    const dl = el('datalist');
    dl.id = listId;
    for (const g of [...new Set(connections.map((x) => x.group).filter((g) => g !== ''))].sort()) {
      const o = el('option');
      o.value = g;
      dl.append(o);
    }
    const guessed = guessEnv(c);
    const envSel = select([['', `Guess from the name${guessed === null ? '' : ` (${guessed})`}`], ['local', 'local'], ['dev', 'dev'], ['staging', 'staging'], ['prod', 'prod — be careful']] as const, c.env ?? '', () => undefined);
    const err = el('div', 'err');
    const save = async (): Promise<void> => {
      const r = await api.retag({ id: c.id, group: groupIn.value, env: envSel.value === '' ? null : (envSel.value as DbEnv) });
      if (!r.ok) return void (err.textContent = r.failure.message);
      connections = r.data.connections;
      paintFiles();
      close();
    };
    groupIn.addEventListener('keydown', (e) => {
      if (isEnterKey(e)) (e.preventDefault(), void save());
    });
    const row = (label: string, input: HTMLElement): HTMLElement => {
      const l = el('label', 'db-retag-row');
      l.append(el('span', 'lbl', label), input);
      return l;
    };
    const btns = el('div', 'btns end');
    btns.append(button('Cancel', 'btn', close), button('Save', 'btn primary', () => void save()));
    box.append(el('b', undefined, `Group & environment — ${c.name}`), el('div', 'hint', 'Groups fold the list into sections. The environment colors the row so production stands out.'), row('Group', groupIn), dl, row('Environment', envSel), err, btns);
    veil.append(box);
    veil.addEventListener('mousedown', (e) => {
      if (e.target === veil) close();
    });
    document.addEventListener('keydown', onKey, true);
    document.body.append(veil);
    groupIn.focus();
  }

  function paintFiles(): void {
    fileList.replaceChildren();
    connFilter.hidden = connections.length < 5 && connQuery === '';
    if (connections.length === 0) {
      fileList.append(el('div', 'hint db-pad', 'No connections yet. Add a MySQL / PostgreSQL server, or type the path of a SQLite file.'));
      return;
    }
    const groups = groupConnections(connections, connQuery);
    if (groups.length === 0) fileList.append(el('div', 'hint db-pad', `No connection matches “${connQuery.trim()}”.`));
    for (const g of groups) {
      // 그룹 머리(그룹을 하나도 쓰지 않으면 머리 없이 한 묶음). 검색 중에는 접힌 그룹도 펼쳐 보인다
      const closed = g.name !== '' && connQuery.trim() === '' && closedGroups.has(g.name);
      if (g.name !== '') {
        const head = el('button', 'db-group-head');
        head.type = 'button';
        head.setAttribute('aria-expanded', String(!closed));
        const prod = g.items.filter((c) => envOf(c).env === 'prod').length;
        head.append(el('span', `db-group-chev${closed ? '' : ' open'}`, '›'), el('span', 'grow', g.name), ...(prod > 0 ? [el('span', 'db-env-chip prod', `${prod} prod`)] : []), el('span', 'dim', String(g.items.length)));
        head.addEventListener('click', () => {
          if (closedGroups.has(g.name)) closedGroups.delete(g.name);
          else closedGroups.add(g.name);
          store.set(CLOSED_GROUPS_KEY, JSON.stringify([...closedGroups]));
          paintFiles();
        });
        fileList.append(head);
      }
      if (closed) continue;
      for (const c of g.items) paintConnRow(c, g.name !== '');
    }
  }

  function paintConnRow(c: DbConnectionView, inGroup: boolean): void {
    {
      const env = envOf(c);
      const row = el('div', `row-item db-row db-conn${c.id === current?.id ? ' on' : ''}${env.env !== null ? ` env-${env.env}` : ''}${env.guessed ? ' env-guessed' : ''}${inGroup ? ' in-group' : ''}`);
      row.tabIndex = 0;
      row.title = `${KIND_LABEL[c.kind]} · ${c.path}${c.via !== null ? `\n${viaLine(c.via)}` : ''}`;
      const badge = el('span', `db-badge ${c.kind}`, KIND_BADGE[c.kind]);
      badge.setAttribute('aria-label', KIND_LABEL[c.kind]);
      const text = el('span', 'db-conn-text');
      // 붙은 적이 있으면 어느 주소로 붙었는지, 아니면 저장한 주소
      const sub = c.via !== null && status.get(c.id) === 'ok' ? viaShort(c.via) : c.path;
      text.append(el('span', 'db-name', c.name), el('span', c.via !== null && status.get(c.id) === 'ok' ? 'db-conn-sub via' : 'db-conn-sub', sub));
      const st = status.get(c.id);
      const dot = el('span', `db-state ${st ?? ''}`);
      dot.title = st === 'ok' ? 'Connected' : st === 'error' ? 'Last attempt failed' : st === 'busy' ? 'Connecting…' : 'Not opened yet';
      row.append(badge, text);
      // 운영·스테이징은 글자 칩으로도(색만으로 구분하지 않게)
      if (env.env === 'prod' || env.env === 'staging') {
        const chip = el('span', `db-env-chip ${env.env}${env.guessed ? ' guessed' : ''}`, env.env);
        chip.title = env.guessed ? `Looks like ${env.env} from the name or host. Set it in Group & environment…` : `Environment: ${env.env}`;
        row.append(chip);
      }
      row.append(dot);
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
      actions.append(act('⚑', `Group & environment of ${c.name}`, () => openRetag(c)));
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
          { label: 'Group & environment…', pick: () => openRetag(c) },
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
    if (tablesLoading) return void tableList.append(loading(current.kind === 'sqlite' ? 'Reading tables…' : connectingText(current)));
    if (status.get(current.id) === 'error' && tables.length === 0) return void tableList.append(el('div', 'hint db-pad', 'Could not open this database. See the message on the right.'));
    if (tables.length === 0) {
      tableList.append(el('div', 'hint db-pad', current.kind === 'sqlite' ? 'This file has no tables.' : current.kind === 'postgres' ? 'No tables in the current schema (search_path). Other schemas: use SQL.' : 'No tables in this database.'));
      return;
    }
    if (shown.length === 0) return void tableList.append(el('div', 'hint db-pad', `No table matches “${filter.trim()}”.`));
    for (const t of shown) {
      const row = el('div', t.name === table ? 'row-item db-row db-trow on' : 'row-item db-row db-trow');
      row.tabIndex = 0;
      row.title = `${t.name} — click to run SELECT * … LIMIT 100`;
      row.append(el('span', `db-ticon ${t.kind}`, t.kind === 'view' ? '◇' : '▦'), el('span', 'db-name', t.name));
      if (t.kind === 'view') row.append(chipOf('view', 'blue'));
      const info = button('ⓘ', 'btn icon sm ghost db-tinfo', () => void showStructure(t.name));
      info.title = `Columns of ${t.name}`;
      info.setAttribute('aria-label', `Columns of ${t.name}`);
      info.addEventListener('click', (e) => e.stopPropagation());
      row.append(info);
      row.addEventListener('click', () => void browseTable(t.name));
      row.addEventListener('keydown', (e) => {
        if (isEnterKey(e)) void browseTable(t.name);
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
    sqlPanel.hidden = sub !== 'sql';
    diagramPanel.hidden = sub !== 'diagram';
    tableTitle.textContent = table ?? '';
  }
  /** 연결이 없거나·여는 중이거나·실패했을 때 결과 칸과 그림 칸에 보일 것. 열려 있으면 null */
  function placeholder(): (() => HTMLElement) | null {
    if (current === null) return () => empty('No database open', 'Connect to a MySQL or PostgreSQL server, or open a SQLite file.', button('+ New connection', 'btn primary', () => openForm('new')));
    const c = current;
    if (openFailure !== null) {
      const f = openFailure;
      return () => {
        const box = problemCard(f, () => void openFile(c));
        if (c.server !== null) box.append(button('Edit connection…', 'btn sm', () => openForm('edit', c)));
        return box;
      };
    }
    if (tablesLoading) return () => loading(connectingText(c));
    return null;
  }
  function paintMain(): void {
    paintSub();
    const ph = placeholder();
    runBtn.disabled = ph !== null || running !== null;
    if (ph !== null) {
      sqlStatus.replaceChildren();
      sqlBody.replaceChildren(ph());
      sqlCsv.hidden = true;
      structPane.hidden = true;
      hideCell();
      diagram.clear();
      diagram.root.hidden = true;
      diagramMsg.hidden = false;
      diagramMsg.replaceChildren(ph());
      return;
    }
    if (lastResult === null && running === null && sqlBody.childElementCount === 0) {
      sqlBody.replaceChildren(empty('Run a query', tables.length === 0 ? `Type SQL above and press ${RUN_KEY}.` : `Click a table on the left to see its first 100 rows, or type SQL above and press ${RUN_KEY}.`));
    }
    if (sub === 'diagram') void loadGraph();
  }

  // ── 동작 ──
  function switchSub(next: Sub): void {
    sub = next;
    paintSub();
    if (next === 'sql') editor.focus();
    if (next === 'diagram') void loadGraph();
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

  /** 서버에 붙은 뒤: 목록을 다시 읽어 붙은 주소(via)를 머리줄·목록에 보인다 */
  async function syncVia(id: string): Promise<void> {
    const r = await api.list();
    if (!r.ok) return;
    connections = r.data.connections;
    const fresh = connections.find((c) => c.id === id);
    if (fresh !== undefined && current?.id === id) current = fresh;
    paintFiles();
    paintMode();
  }

  function clearCurrent(): void {
    current = null;
    tables = [];
    table = null;
    lastResult = null;
    graph = null;
    openFailure = null;
    writeMode = false;
    sqlBody.replaceChildren();
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
    tables = [];
    graph = null;
    lastResult = null;
    openFailure = null;
    tablesLoading = true;
    tableFilter.value = filter = '';
    status.set(c.id, 'busy');
    store.set(LAST_KEY, c.id);
    // 편집기가 아직 예시 그대로면 이 DB 의 예시로 바꾼다
    if (Object.values(SAMPLES).includes(editor.textOf('sql') ?? '')) editor.replace('sql', SAMPLES[c.kind], 'sql', INDENT, false);
    sqlBody.replaceChildren();
    structPane.hidden = true;
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
    if (!r.ok) openFailure ??= r.failure;
    else tables = r.data;
    sqlBody.replaceChildren();
    paintFiles();
    paintTables();
    paintMode();
    paintMain();
    if (r.ok && c.server !== null) await syncVia(c.id);
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
    if (r.ok) {
      tables = r.data;
      graph = null;
      if (sub === 'diagram') void loadGraph();
    } else say(`${r.failure.title}. ${r.failure.message}`);
    paintFiles();
    paintTables();
    if (r.ok && c.server !== null) await syncVia(c.id);
  }

  /** 왼쪽 테이블을 누르면: 편집기에 SELECT * … LIMIT 100 을 넣고 바로 돌린다 */
  async function browseTable(name: string): Promise<void> {
    if (current === null) return;
    table = name;
    paintTables();
    editor.replace('sql', browseSql(current.kind, name), 'sql', INDENT, false);
    sub = 'sql';
    paintSub();
    if (!structPane.hidden && structPane.dataset['table'] !== name) structPane.hidden = true;
    await run();
  }

  /** ⓘ: 결과 위 작은 칸에 그 테이블의 열(형식 · NULL · 기본값 · 키)과 CREATE 문을 보인다 */
  async function showStructure(name: string): Promise<void> {
    if (current === null) return;
    if (!structPane.hidden && structPane.dataset['table'] === name) {
      structPane.hidden = true;
      return;
    }
    sub = 'sql';
    paintSub();
    structPane.dataset['table'] = name;
    structPane.hidden = false;
    structPane.replaceChildren(loading(`Loading columns of ${name}…`));
    const mine = seq;
    const r = await api.detail({ id: current.id, table: name });
    if (mine !== seq || structPane.dataset['table'] !== name) return;
    paintStructure(name, r.ok ? r.data : null, r.ok ? undefined : r.failure);
  }
  function paintStructure(name: string, d: DbTableDetail | null, failure?: DbFailure): void {
    structPane.replaceChildren();
    const bar = el('div', 'bar db-struct-bar');
    const close = button('×', 'btn icon sm ghost', () => (structPane.hidden = true));
    close.setAttribute('aria-label', 'Close columns');
    if (d === null) {
      bar.append(el('b', 'grow', name), close);
      structPane.append(bar, problemCard(failure!));
      return;
    }
    bar.append(chipOf(d.kind === 'view' ? 'View' : 'Table', d.kind === 'view' ? 'blue' : ''), el('b', 'db-struct-name', d.name), el('span', 'hint grow', `${d.columns.length} columns`), close);
    const grid = el('div', 'db-scroll db-struct-grid');
    const t = el('table', 'tbl db-table');
    const thead = el('thead');
    const hr = el('tr');
    for (const h of ['Column', 'Type', 'Null', 'Default', 'Key']) hr.append(el('th', 'db-th', h));
    thead.append(hr);
    const tb = el('tbody');
    for (const c of d.columns) {
      const tr = el('tr');
      const key = el('td', 'db-cell text', c.primaryKey > 0 ? `PK ${c.primaryKey}` : '');
      if (c.primaryKey > 0) key.classList.add('db-pk');
      tr.append(el('td', 'db-cell text db-colname', c.hidden ? `${c.name} (hidden)` : c.name), el('td', 'db-cell text db-type', c.type === '' ? '—' : c.type), el('td', `db-cell text${c.notNull ? '' : ' null'}`, c.notNull ? 'NOT NULL' : 'NULL'), el('td', 'db-cell text', c.defaultValue ?? '—'), key);
      tb.append(tr);
    }
    t.append(thead, tb);
    grid.append(t);
    structPane.append(bar, grid);
    if (d.createSql !== null) {
      const more = el('details', 'db-create-wrap');
      const summary = el('summary', 'hint', 'CREATE statement');
      const pre = el('pre', 'db-create mono');
      pre.textContent = d.createSql;
      more.append(summary, pre);
      structPane.append(more);
    }
  }

  async function loadGraph(): Promise<void> {
    if (current === null || placeholder() !== null) return;
    if (graph !== null) {
      diagramMsg.hidden = true;
      diagram.root.hidden = false;
      return;
    }
    if (graphLoading) return;
    const c = current;
    const mine = seq;
    graphLoading = true;
    diagram.root.hidden = true;
    diagramMsg.hidden = false;
    diagramMsg.replaceChildren(loading('Reading tables and relations…'));
    const r = await api.graph(c.id);
    graphLoading = false;
    if (mine !== seq) return;
    if (!r.ok) {
      diagramMsg.replaceChildren(problemCard(r.failure, () => void loadGraph()));
      return;
    }
    graph = r.data;
    if (graph.tables.length === 0) {
      diagramMsg.replaceChildren(empty('Nothing to draw', 'This database has no tables yet.'));
      return;
    }
    diagramMsg.hidden = true;
    diagram.root.hidden = false;
    diagram.show(graph, table);
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
        openFailure = r.failure;
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
    hideCell();
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
    sqlBody.append(resultTable(result, { onPick: (p) => showCell(p, result.columns) }));
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
    if (current?.id !== id) return;
    if (!r.ok) {
      lastResult = null;
      return paintRun('', r.failure);
    }
    lastResult = r.data;
    paintRun('', undefined, r.data, statement.text);
    // 주소가 여럿인 서버는 쿼리마다 다시 접속하니(1번이 돌아왔을 수 있다) 붙은 주소를 새로 읽는다
    if (current.server !== null && current.server.addresses.length > 1) void syncVia(id);
    // 구조를 바꿨으면 테이블 목록·그림을 새로 읽는다
    if (r.data.kind === 'schema') {
      graph = null;
      const list = await api.tables(id);
      if (list.ok && current?.id === id) {
        tables = list.data;
        if (table !== null && !tables.some((t) => t.name === table)) table = null;
        paintTables();
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
