import type { DbApi, DbFailure, DbServerForm } from '../shared/db-api.js';
import type { DbConnectionView } from '../shared/db-connections.js';
import { defaultPort, ServerTarget, type ServerKind, type SslMode } from '../shared/db-server.js';
import { sslHelp } from '../shared/db-view-text.js';
import { el, isEnterKey } from './dom.js';
import { button, select } from './todo-parts.js';

/** 새 연결의 종류: 서버 둘과 SQLite 파일(한 폼에서 고른다) */
type FormKind = ServerKind | 'sqlite';
const FORM_KINDS: readonly (readonly [FormKind, string])[] = [
  ['postgres', 'PostgreSQL'],
  ['mysql', 'MySQL'],
  ['sqlite', 'SQLite file'],
];
const SSL_MODES: readonly (readonly [SslMode, string])[] = [
  ['off', 'Off'],
  ['require', 'Require (encrypt, no certificate check)'],
  ['verify', 'Verify certificate'],
];

type Mode = { readonly kind: 'new' } | { readonly kind: 'edit'; readonly conn: DbConnectionView } | { readonly kind: 'copy'; readonly conn: DbConnectionView };

export interface ServerFormDeps {
  readonly api: DbApi;
  readonly canSavePasswords: () => boolean;
  /** 저장(추가·고치기)이 되었을 때 */
  readonly onSaved: (view: DbConnectionView) => void;
  readonly onClose: () => void;
  /** SQLite 파일 연결: path 가 없으면 파일 고르기 창. 실패면 그 이유, 고르기를 취소하면 'cancelled', 되면 null */
  readonly addFile: (path?: string) => Promise<DbFailure | 'cancelled' | null>;
}

/**
 * 서버 연결 폼(DBeaver·TablePlus 의 새 연결 창처럼 가운데 칸에 크게): 이름표가 붙은 칸, 종류에 맞는 기본 포트,
 * SSL 설명, "Test connection"(저장하지 않고 접속만), 오류는 단추 바로 아래.
 * 고치기에서는 비밀번호 칸을 비워 두면 저장한 비밀번호를 그대로 쓴다(비밀번호는 화면으로 돌아오지 않는다).
 */
export function buildServerForm(deps: ServerFormDeps) {
  let mode: Mode = { kind: 'new' };
  let kind: ServerKind = 'postgres';
  /** 폼에서 고른 종류(SQLite 면 파일 칸만 보인다) */
  let formKind: FormKind = 'postgres';
  let ssl: SslMode = 'off';
  let sslTouched = false;
  let busy = false;

  const root = el('form', 'db-form');
  root.hidden = true;
  root.noValidate = true;
  root.addEventListener('submit', (e) => e.preventDefault());
  const title = el('b', 'db-form-title');
  const sub = el('span', 'hint');
  const top = el('div', 'db-form-head');
  top.append(title, sub);

  const input = (label: string, placeholder = ''): HTMLInputElement => {
    const i = el('input');
    i.placeholder = placeholder;
    i.spellcheck = false;
    i.setAttribute('aria-label', label);
    return i;
  };
  const name = input('Connection name', 'e.g. Prod read replica');
  const host = input('Host', 'db.example.com or 127.0.0.1');
  const port = input('Port');
  port.inputMode = 'numeric';
  port.classList.add('db-port');
  const user = input('User name', 'postgres');
  const pass = input('Password');
  pass.type = 'password';
  pass.autocomplete = 'new-password';
  const database = input('Database name', 'postgres');
  const kindSel = select(FORM_KINDS, formKind, (v) => setFormKind(v));
  const filePath = input('Full path of a SQLite file', 'C:\\data\\app.db or /Users/me/app.db');
  const chooseBtn = button('Choose file…', 'btn', () => void chooseFile());
  const fileRow = el('div', 'db-hostport');
  fileRow.append(filePath, chooseBtn);
  kindSel.setAttribute('aria-label', 'Database type');
  const sslSel = select(SSL_MODES, ssl, (v) => {
    ssl = v;
    sslTouched = true;
    paintSsl();
  });
  sslSel.setAttribute('aria-label', 'SSL');
  const sslNote = el('div', 'hint db-form-note');
  const save = el('input');
  save.type = 'checkbox';
  save.checked = true;
  const saveLabel = el('label', 'db-check');
  saveLabel.append(save, el('span', undefined, 'Save password (encrypted with your system keychain)'));
  const passNote = el('div', 'hint db-form-note');

  const field = (label: string, ...parts: HTMLElement[]): HTMLElement => {
    const row = el('label', 'db-field');
    const box = el('div', 'db-field-box');
    box.append(...parts);
    row.append(el('span', 'lbl', label), box);
    return row;
  };
  const hostRow = el('div', 'db-hostport');
  hostRow.append(host, el('span', 'hint', 'Port'), port);

  const testBtn = button('Test connection', 'btn', () => void test());
  const saveBtn = button('Connect', 'btn primary', () => void submit());
  const cancelBtn = button('Cancel', 'btn', () => close());
  const actions = el('div', 'bar db-form-actions');
  actions.append(saveBtn, testBtn, cancelBtn);
  const result = el('div', 'db-form-result');
  result.setAttribute('aria-live', 'polite');

  const grid = el('div', 'db-form-grid');
  const serverFields = [field('Name', name), field('Host', hostRow), field('User', user), field('Password', pass, passNote), field('Database', database), field('SSL', sslSel, sslNote), field('', saveLabel)];
  const fileField = field('File', fileRow);
  grid.append(field('Type', kindSel), fileField, ...serverFields);
  root.append(top, grid, actions, result);

  for (const i of [name, host, port, user, pass, database, filePath]) {
    i.addEventListener('keydown', (e) => {
      if (isEnterKey(e)) {
        e.preventDefault();
        void submit();
      }
    });
    i.addEventListener('input', () => showResult(null));
  }
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  });
  host.addEventListener('input', () => {
    // RDS 엔드포인트를 붙여 넣으면 SSL 을 권한다(사용자가 SSL 을 직접 고르지 않았을 때만)
    if (!sslTouched && ssl === 'off' && ServerTarget.isAwsRdsHost(host.value)) {
      ssl = 'verify';
      sslSel.value = ssl;
    }
    paintSsl();
  });

  /** 종류 고르기: SQLite 면 파일 칸만, 서버면 서버 칸만 보인다 */
  function setFormKind(next: FormKind): void {
    formKind = next;
    kindSel.value = next;
    const file = next === 'sqlite';
    fileField.hidden = !file;
    for (const f of serverFields) f.hidden = file;
    testBtn.hidden = file;
    if (next !== 'sqlite') setKind(next);
    if (mode.kind !== 'edit') sub.textContent = file ? 'Pick a SQLite file on this computer. It opens read-only.' : 'MySQL or PostgreSQL. Rauha connects once to check, then saves it. Everything opens read-only.';
    showResult(null);
  }
  async function chooseFile(): Promise<void> {
    if (busy) return;
    setBusy(true);
    const r = await deps.addFile();
    setBusy(false);
    if (r === 'cancelled' || r === null) return showResult(null);
    showResult(r);
  }
  async function submitFile(): Promise<void> {
    if (filePath.value.trim() === '') return showResult({ kind: 'bad-input', title: 'Missing details', message: 'Type the full path of a SQLite file, or press Choose file.', help: null });
    setBusy(true, 'Opening the file…');
    const r = await deps.addFile(filePath.value);
    setBusy(false);
    if (r === 'cancelled' || r === null) {
      filePath.value = '';
      return showResult(null);
    }
    showResult(r);
  }

  function setKind(next: ServerKind): void {
    const oldDefault = String(defaultPort(kind));
    kind = next;
    kindSel.value = next;
    // 포트를 손대지 않았으면(비었거나 이전 기본값) 새 기본값으로
    if (port.value.trim() === '' || port.value.trim() === oldDefault) port.value = String(defaultPort(next));
    port.placeholder = String(defaultPort(next));
    user.placeholder = next === 'postgres' ? 'postgres' : 'root';
    database.placeholder = next === 'postgres' ? 'postgres' : 'app';
  }
  function paintSsl(): void {
    sslNote.textContent = sslHelp(ssl, host.value);
  }
  function paintSave(): void {
    const can = deps.canSavePasswords();
    save.disabled = !can;
    if (!can) save.checked = false;
    saveLabel.title = can ? 'Stored encrypted with your system keychain. Rauha never shows it again.' : 'This computer cannot encrypt passwords, so Rauha will ask each time you connect.';
  }
  function showResult(f: DbFailure | null, okText?: string): void {
    result.replaceChildren();
    result.className = 'db-form-result';
    if (f === null && okText === undefined) return;
    if (okText !== undefined) {
      result.classList.add('ok');
      result.append(el('b', undefined, okText));
      return;
    }
    result.classList.add('bad');
    result.append(el('b', undefined, f!.title), el('div', 'db-msg', f!.message));
    if (f!.help !== null) result.append(el('div', 'hint', f!.help));
  }

  const keeping = (): boolean => mode.kind === 'edit' && pass.value === '';
  const form = (): DbServerForm => ({ name: name.value, kind, host: host.value, port: port.value, user: user.value, password: pass.value, database: database.value, ssl, savePassword: save.checked && deps.canSavePasswords() });
  const missing = (): string | null => {
    const empty = [host.value.trim() === '' ? 'host' : null, user.value.trim() === '' ? 'user' : null, database.value.trim() === '' ? 'database' : null].filter((x) => x !== null);
    return empty.length === 0 ? null : `Fill in the ${empty.join(', ')}.`;
  };
  function setBusy(on: boolean, label?: string): void {
    busy = on;
    testBtn.disabled = saveBtn.disabled = chooseBtn.disabled = on;
    if (on && label !== undefined) showResult(null, label);
    if (on) result.className = 'db-form-result wait';
  }

  async function test(): Promise<void> {
    if (busy) return;
    const m = missing();
    if (m !== null) return showResult({ kind: 'bad-input', title: 'Missing details', message: m, help: null });
    setBusy(true, `Connecting to ${host.value.trim()}…`);
    const r = await deps.api.testServer(mode.kind === 'edit' ? { ...form(), id: mode.conn.id, keepPassword: keeping() } : form());
    setBusy(false);
    if (r.ok) showResult(null, `Connected · ${r.data.elapsedMs.toLocaleString('en-US')} ms`);
    else showResult(r.failure);
  }

  async function submit(): Promise<void> {
    if (busy) return;
    if (formKind === 'sqlite') return submitFile();
    const m = missing();
    if (m !== null) return showResult({ kind: 'bad-input', title: 'Missing details', message: m, help: null });
    setBusy(true, `Connecting to ${host.value.trim()}…`);
    const r = mode.kind === 'edit' ? await deps.api.editServer({ ...form(), id: mode.conn.id, keepPassword: keeping() }) : await deps.api.addServer(form());
    setBusy(false);
    if (!r.ok) return showResult(r.failure);
    pass.value = '';
    root.hidden = true;
    deps.onSaved(r.data);
  }

  function fill(c: DbConnectionView | null): void {
    const s = c?.server ?? null;
    name.value = c === null ? '' : mode.kind === 'copy' ? `${c.name} copy` : c.name;
    setKind(s?.kind ?? 'postgres');
    host.value = s?.host ?? '';
    port.value = String(s?.port ?? defaultPort(kind));
    user.value = s?.user ?? '';
    database.value = s?.database ?? '';
    ssl = s?.ssl ?? 'off';
    sslSel.value = ssl;
    sslTouched = s !== null;
    pass.value = '';
    save.checked = c?.savedPassword !== false;
    paintSave();
    paintSsl();
    showResult(null);
  }

  function open(next: Mode, startKind: FormKind = 'postgres'): void {
    mode = next;
    fill(next.kind === 'new' ? null : next.conn);
    filePath.value = '';
    // 고치기·복제는 서버 연결만(SQLite 는 다시 고르면 된다). 새 연결은 종류부터 고른다
    kindSel.disabled = next.kind !== 'new';
    title.textContent = next.kind === 'edit' ? `Edit ${next.conn.name}` : next.kind === 'copy' ? `Duplicate ${next.conn.name}` : 'New connection';
    if (next.kind === 'edit') sub.textContent = 'Rauha connects with the new details first and saves them only if that works.';
    setFormKind(next.kind === 'new' ? startKind : (next.conn.server?.kind ?? 'postgres'));
    pass.placeholder = next.kind === 'edit' ? (next.conn.savedPassword === true ? 'Saved — leave empty to keep' : 'Leave empty to use the one you typed this session') : '';
    passNote.textContent = next.kind === 'copy' ? 'Type the password again for the copy.' : '';
    passNote.hidden = passNote.textContent === '';
    saveBtn.textContent = next.kind === 'edit' ? 'Save' : 'Connect';
    root.hidden = false;
    (next.kind !== 'new' ? name : formKind === 'sqlite' ? filePath : host).focus();
  }

  function close(): void {
    if (root.hidden) return;
    pass.value = '';
    root.hidden = true;
    deps.onClose();
  }

  return {
    root,
    openNew: (startKind: FormKind = 'postgres') => open({ kind: 'new' }, startKind),
    openEdit: (c: DbConnectionView) => open({ kind: 'edit', conn: c }),
    openCopy: (c: DbConnectionView) => open({ kind: 'copy', conn: c }),
    close,
    isOpen: () => !root.hidden,
    /** 비밀번호 저장 가능 여부가 바뀌면 다시 그린다 */
    refresh: () => paintSave(),
  };
}
