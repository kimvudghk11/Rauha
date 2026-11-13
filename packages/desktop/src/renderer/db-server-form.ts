import type { DbApi, DbFailure, DbServerForm } from '../shared/db-api.js';
import type { DbConnectionView } from '../shared/db-connections.js';
import { defaultPort, FAILOVER_CONNECT_TIMEOUT_MS, MAX_ADDRESSES, ServerTarget, type ServerKind, type SslMode } from '../shared/db-server.js';
import { ConnectionUrl } from '../shared/db-url.js';
import { sslHelp, viaShort } from '../shared/db-view-text.js';
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
/** 주소 줄 이름표 예시(1번 · 2번 · 그 뒤) */
const LABEL_HINTS = ['Private', 'Public', 'VPN'];

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

/** 주소 한 줄: 번호 · 이름표 · 호스트 · 포트 · 순서 바꾸기 · 지우기 */
interface AddressRow {
  readonly root: HTMLElement;
  readonly label: HTMLInputElement;
  readonly host: HTMLInputElement;
  readonly port: HTMLInputElement;
}

/**
 * 서버 연결 폼(가운데 모달): 이름표가 붙은 칸, 주소 여러 개(1번이 안 되면 다음 번호로), 종류에 맞는 기본 포트,
 * SSL 설명, "Test connection"(저장하지 않고 접속만, 붙은 주소를 보인다), 오류는 단추 바로 아래.
 * 호스트 칸에 postgres://… · mysql://… 연결 문자열을 붙여 넣으면 칸을 채운다.
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

  /** 칸 하나(이름표를 누르면 그 칸으로). 입력이 여럿인 칸(주소 목록)은 div 로 */
  const field = (label: string, ...parts: HTMLElement[]): HTMLElement => {
    const row = el(parts.length === 1 && !(parts[0] instanceof HTMLDivElement) ? 'label' : 'div', 'db-field');
    const box = el('div', 'db-field-box');
    box.append(...parts);
    row.append(el('span', 'lbl', label), box);
    return row;
  };

  // ── 주소 여러 개 ──
  const addrList = el('div', 'db-addrs');
  const rows: AddressRow[] = [];
  const addBtn = button('+ Add address', 'btn sm', () => {
    addRow({ host: '', port: '', label: '' }).host.focus();
  });
  addBtn.title = 'Add another host or IP for the same database (e.g. a public IP when the private one is not reachable)';
  const addrNote = el('div', 'hint db-form-note');
  const addrFoot = el('div', 'db-addr-foot');
  addrFoot.append(addBtn, addrNote);

  function addRow(v: { readonly host: string; readonly port: string; readonly label: string }): AddressRow {
    const r = el('div', 'db-addr');
    const label = input('Address label', 'Label');
    label.classList.add('db-addr-label');
    label.value = v.label;
    const host = input('Host', 'db.example.com, 10.0.0.5 or paste postgres://…');
    host.value = v.host;
    const port = input('Port');
    port.inputMode = 'numeric';
    port.classList.add('db-port');
    port.value = v.port === '' ? String(defaultPort(kind)) : v.port;
    port.placeholder = String(defaultPort(kind));
    const row: AddressRow = { root: r, label, host, port };
    const num = el('span', 'db-addr-n');
    const up = button('↑', 'btn icon sm ghost', () => move(row, -1));
    const down = button('↓', 'btn icon sm ghost', () => move(row, 1));
    const del = button('×', 'btn icon sm ghost', () => removeRow(row));
    r.append(num, label, host, el('span', 'hint', 'Port'), port, up, down, del);
    for (const i of [label, host, port]) wireEnter(i);
    host.addEventListener('input', () => onHostInput(host));
    // "3.39.2.12:3306" 처럼 포트까지 붙여 넣으면 칸을 나눠 보여 준다(포트 칸이 비어 있을 때만)
    host.addEventListener('change', () => {
      const m = /^(?:\[([^\]]+)\]|([^:[\]/@\s]+)):(\d{1,5})$/.exec(host.value.trim());
      if (m === null || port.value.trim() !== '') return;
      host.value = m[1] ?? m[2] ?? '';
      port.value = m[3] ?? '';
    });
    rows.push(row);
    addrList.append(r);
    paintRows();
    return row;
  }
  function move(row: AddressRow, by: number): void {
    const at = rows.indexOf(row);
    const to = at + by;
    if (at === -1 || to < 0 || to >= rows.length) return;
    rows.splice(at, 1);
    rows.splice(to, 0, row);
    addrList.replaceChildren(...rows.map((r) => r.root));
    paintRows();
    showResult(null);
  }
  function removeRow(row: AddressRow): void {
    if (rows.length <= 1) return;
    rows.splice(rows.indexOf(row), 1);
    row.root.remove();
    paintRows();
    showResult(null);
  }
  function setRows(list: readonly { readonly host: string; readonly port: string; readonly label: string }[]): void {
    rows.length = 0;
    addrList.replaceChildren();
    for (const v of list.length === 0 ? [{ host: '', port: '', label: '' }] : list.slice(0, MAX_ADDRESSES)) addRow(v);
  }
  /** 번호 · 이름 · 단추 켜기/끄기 · 안내 */
  function paintRows(): void {
    const many = rows.length > 1;
    rows.forEach((r, i) => {
      const [num, , , , , up, down, del] = [...r.root.children] as HTMLElement[];
      num!.textContent = `${i + 1}`;
      num!.title = i === 0 ? 'Tried first' : `Tried if #${i} does not answer`;
      r.host.setAttribute('aria-label', i === 0 ? 'Host' : `Host #${i + 1}`);
      r.port.setAttribute('aria-label', i === 0 ? 'Port' : `Port #${i + 1}`);
      r.label.setAttribute('aria-label', `Label for host #${i + 1}`);
      r.label.placeholder = LABEL_HINTS[i] ?? 'Label';
      // 주소가 하나면 이름표·순서 단추는 숨긴다(필요할 때만 보인다)
      r.label.hidden = !many;
      for (const [b, t] of [[up, `Move host #${i + 1} up`], [down, `Move host #${i + 1} down`], [del, `Remove host #${i + 1}`]] as const) {
        b!.title = t;
        b!.setAttribute('aria-label', t);
        b!.hidden = !many;
      }
      (up as HTMLButtonElement).disabled = i === 0;
      (down as HTMLButtonElement).disabled = i === rows.length - 1;
    });
    addBtn.hidden = rows.length >= MAX_ADDRESSES;
    addrNote.textContent = many ? `Tried in order. If a host does not answer within ${FAILOVER_CONNECT_TIMEOUT_MS / 1000} s, Rauha tries the next one. A wrong password stops right away.` : '';
    addrNote.hidden = !many;
  }
  const hosts = (): string[] => rows.map((r) => r.host.value.trim());

  /** 호스트 칸에 연결 문자열을 붙여 넣으면 칸을 채우고, RDS 엔드포인트면 SSL 을 권한다 */
  function onHostInput(host: HTMLInputElement): void {
    const parsed = ConnectionUrl.parse(host.value);
    if (parsed !== null && parsed.addresses.length > 0) {
      setKind(parsed.kind);
      if (formKind !== parsed.kind) setFormKind(parsed.kind);
      setRows(parsed.addresses);
      if (parsed.user !== '') user.value = parsed.user;
      if (parsed.password !== '' && pass.value === '') pass.value = parsed.password;
      if (parsed.database !== '') database.value = parsed.database;
      if (parsed.ssl !== null) {
        ssl = parsed.ssl;
        sslSel.value = ssl;
        sslTouched = true;
      }
      showResult(null, 'Filled in from the connection string.');
      result.className = 'db-form-result wait';
    }
    // RDS 엔드포인트를 붙여 넣으면 SSL 을 권한다(사용자가 SSL 을 직접 고르지 않았을 때만)
    if (!sslTouched && ssl === 'off' && hosts().some((h) => ServerTarget.isAwsRdsHost(h))) {
      ssl = 'verify';
      sslSel.value = ssl;
    }
    paintSsl();
  }

  const testBtn = button('Test connection', 'btn', () => void test());
  const saveBtn = button('Connect', 'btn primary', () => void submit());
  const cancelBtn = button('Cancel', 'btn', () => close());
  const actions = el('div', 'bar db-form-actions');
  actions.append(saveBtn, testBtn, cancelBtn);
  const result = el('div', 'db-form-result');
  result.setAttribute('aria-live', 'polite');

  const grid = el('div', 'db-form-grid');
  const serverFields = [field('Name', name), field('Hosts', addrList, addrFoot), field('User', user), field('Password', pass, passNote), field('Database', database), field('SSL', sslSel, sslNote), field('', saveLabel)];
  const fileField = field('File', fileRow);
  grid.append(field('Type', kindSel), fileField, ...serverFields);
  root.append(top, grid, actions, result);

  function wireEnter(i: HTMLInputElement): void {
    i.addEventListener('keydown', (e) => {
      if (isEnterKey(e)) {
        e.preventDefault();
        void submit();
      }
    });
    i.addEventListener('input', () => showResult(null));
  }
  for (const i of [name, user, pass, database, filePath]) wireEnter(i);
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
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
    for (const r of rows) {
      if (r.port.value.trim() === '' || r.port.value.trim() === oldDefault) r.port.value = String(defaultPort(next));
      r.port.placeholder = String(defaultPort(next));
    }
    user.placeholder = next === 'postgres' ? 'postgres' : 'root';
    database.placeholder = next === 'postgres' ? 'postgres' : 'app';
  }
  function paintSsl(): void {
    const hs = hosts();
    sslNote.textContent = sslHelp(ssl, hs.find((h) => ServerTarget.isAwsRdsHost(h)) ?? hs[0] ?? '');
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
  const form = (): DbServerForm => ({
    name: name.value,
    kind,
    addresses: rows.map((r) => ({ host: r.host.value, port: r.port.value, label: rows.length > 1 ? r.label.value : '' })),
    user: user.value,
    password: pass.value,
    database: database.value,
    ssl,
    savePassword: save.checked && deps.canSavePasswords(),
  });
  const missing = (): string | null => {
    const emptyHost = hosts().findIndex((h) => h === '');
    const empty = [emptyHost === -1 ? null : rows.length > 1 ? `host #${emptyHost + 1}` : 'host', user.value.trim() === '' ? 'user' : null, database.value.trim() === '' ? 'database' : null].filter((x) => x !== null);
    return empty.length === 0 ? null : `Fill in the ${empty.join(', ')}.`;
  };
  const connecting = (): string => (rows.length > 1 ? `Connecting… trying ${rows.length} hosts in order` : `Connecting to ${hosts()[0] ?? ''}…`);
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
    setBusy(true, connecting());
    const r = await deps.api.testServer(mode.kind === 'edit' ? { ...form(), id: mode.conn.id, keepPassword: keeping() } : form());
    setBusy(false);
    if (r.ok) showResult(null, `Connected${r.data.via === null ? '' : ` ${viaShort(r.data.via)}`} · ${r.data.elapsedMs.toLocaleString('en-US')} ms`);
    else showResult(r.failure);
  }

  async function submit(): Promise<void> {
    if (busy) return;
    if (formKind === 'sqlite') return submitFile();
    const m = missing();
    if (m !== null) return showResult({ kind: 'bad-input', title: 'Missing details', message: m, help: null });
    setBusy(true, connecting());
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
    setRows(s === null ? [] : s.addresses.map((a) => ({ host: a.host, port: String(a.port), label: a.label ?? '' })));
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
    (next.kind !== 'new' ? name : formKind === 'sqlite' ? filePath : rows[0]!.host).focus();
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
