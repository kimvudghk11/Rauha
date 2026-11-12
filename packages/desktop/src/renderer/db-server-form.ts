import type { DbApi, DbFailure, DbServerForm } from '../shared/db-api.js';
import type { DbConnectionView } from '../shared/db-connections.js';
import { defaultPort, ServerTarget, type ServerKind, type SslMode } from '../shared/db-server.js';
import { sslHelp } from '../shared/db-view-text.js';
import { el, isEnterKey } from './dom.js';
import { button, select } from './todo-parts.js';

const SERVER_KINDS: readonly (readonly [ServerKind, string])[] = [
  ['postgres', 'PostgreSQL'],
  ['mysql', 'MySQL'],
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
}

/**
 * 서버 연결 폼(DBeaver·TablePlus 의 새 연결 창처럼 가운데 칸에 크게): 이름표가 붙은 칸, 종류에 맞는 기본 포트,
 * SSL 설명, "Test connection"(저장하지 않고 접속만), 오류는 단추 바로 아래.
 * 고치기에서는 비밀번호 칸을 비워 두면 저장한 비밀번호를 그대로 쓴다(비밀번호는 화면으로 돌아오지 않는다).
 */
export function buildServerForm(deps: ServerFormDeps) {
  let mode: Mode = { kind: 'new' };
  let kind: ServerKind = 'postgres';
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
  const kindSel = select(SERVER_KINDS, kind, (v) => setKind(v));
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
  grid.append(field('Type', kindSel), field('Name', name), field('Host', hostRow), field('User', user), field('Password', pass, passNote), field('Database', database), field('SSL', sslSel, sslNote), field('', saveLabel));
  root.append(top, grid, actions, result);

  for (const i of [name, host, port, user, pass, database]) {
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
    testBtn.disabled = saveBtn.disabled = on;
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

  function open(next: Mode): void {
    mode = next;
    fill(next.kind === 'new' ? null : next.conn);
    title.textContent = next.kind === 'edit' ? `Edit ${next.conn.name}` : next.kind === 'copy' ? `Duplicate ${next.conn.name}` : 'New server connection';
    sub.textContent = next.kind === 'edit' ? 'Rauha connects with the new details first and saves them only if that works.' : 'MySQL or PostgreSQL. Rauha connects once to check, then saves it. Everything opens read-only.';
    pass.placeholder = next.kind === 'edit' ? (next.conn.savedPassword === true ? 'Saved — leave empty to keep' : 'Leave empty to use the one you typed this session') : '';
    passNote.textContent = next.kind === 'copy' ? 'Type the password again for the copy.' : '';
    passNote.hidden = passNote.textContent === '';
    saveBtn.textContent = next.kind === 'edit' ? 'Save' : 'Connect';
    root.hidden = false;
    (next.kind === 'new' ? host : name).focus();
  }

  function close(): void {
    if (root.hidden) return;
    pass.value = '';
    root.hidden = true;
    deps.onClose();
  }

  return {
    root,
    openNew: () => open({ kind: 'new' }),
    openEdit: (c: DbConnectionView) => open({ kind: 'edit', conn: c }),
    openCopy: (c: DbConnectionView) => open({ kind: 'copy', conn: c }),
    close,
    isOpen: () => !root.hidden,
    /** 비밀번호 저장 가능 여부가 바뀌면 다시 그린다 */
    refresh: () => paintSave(),
  };
}
