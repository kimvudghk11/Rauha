import { BUG_MEMO_LIMIT, BUG_TITLE_LIMIT, requestTextOf } from '../shared/bug-note.js';
import type { BugApi, BugPreviewItem, BugStateJson } from '../shared/bug-api.js';
import type { BugNoteJson } from '../shared/bug-note-dto.js';
import { el, isEnterKey } from './dom.js';
import { askDialog } from './git-common.js';
import { actionButton, flash, iconButton } from './record-parts.js';
import { whenText } from './records-view.js';

export interface BugViewDeps {
  readonly api: BugApi;
  /** 지금 보고 있는 탭 이름(메모에 자동으로 붙는다) */
  screen(): string;
  /** 단축키 안내에 쓰는 OS */
  readonly platform: string;
  /** 수정 요청 글을 채팅 입력칸에 채워 넣는다 */
  fillChat(text: string): void;
  /** 수정 요청 글을 할 일 카드로 만든다(기존 할 일 추가 경로) */
  addTodo(text: string): Promise<{ ok: true } | { ok: false; error: string }>;
}

export const shortcutText = (platform: string): string => (platform === 'darwin' ? '⌘⇧B' : 'Ctrl+Shift+B');

type View = 'open' | 'done';

/**
 * 답답한 점 적기: 어느 탭에서나 열리는 창. 제목 한 줄 + 메모를 이 컴퓨터에 먼저 저장하고(인터넷이 없어도 잃지 않는다),
 * 목록에서 해결 표시·지우기·수정 요청으로 쓰기를 하고, 가린 미리보기를 확인한 뒤에야 내 AWS에 올린다.
 * 화면은 그리기만 한다. 규칙(글자 수·계정 확인·가림)은 shared와 main이 지킨다.
 */
export function openBugDialog(deps: BugViewDeps): void {
  const existing = document.querySelector<HTMLElement>('.veil.bugs-veil');
  if (existing !== null) {
    existing.querySelector<HTMLInputElement>('.bug-title')?.focus();
    return;
  }
  const veil = el('div', 'veil bugs-veil');
  const box = el('div', 'dialog bugs');
  box.tabIndex = -1;
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Write a report');
  veil.appendChild(box);
  document.body.appendChild(veil);

  let state: BugStateJson = { items: [], syncBlocked: null };
  let view: View = 'open';
  let busy = false;
  let status: { text: string; bad: boolean } = { text: '', bad: false };
  let preview: { items: readonly BugPreviewItem[]; digest: string } | null = null;
  let draft = { title: '', memo: '' };

  const close = (): void => veil.remove();
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (preview !== null) {
        preview = null;
        render();
      } else close();
    }
  });
  veil.addEventListener('mousedown', (e) => {
    if (e.target === veil) close();
  });

  const say = (text: string, bad = false): void => {
    status = { text, bad };
    render();
  };

  async function mutate(op: unknown): Promise<boolean> {
    const result = await deps.api.apply(op).catch(() => ({ ok: false as const, error: 'Could not save.' }));
    if (result.ok) state = result.state;
    else say(result.error, true);
    return result.ok;
  }

  async function save(): Promise<void> {
    if (busy) return;
    if (draft.title.trim() === '') {
      say('Please enter a title.', true);
      box.querySelector<HTMLInputElement>('.bug-title')?.focus();
      return;
    }
    busy = true;
    const ok = await mutate({ kind: 'add', title: draft.title, memo: draft.memo, screen: deps.screen() });
    busy = false;
    if (ok) {
      draft = { title: '', memo: '' };
      view = 'open';
      status = { text: 'Saved on this computer.', bad: false };
    }
    render();
    box.querySelector<HTMLInputElement>('.bug-title')?.focus();
  }

  async function startUpload(): Promise<void> {
    if (busy) return;
    busy = true;
    say('Building the redacted preview…');
    const result = await deps.api.preview().catch(() => ({ ok: false as const, error: 'Could not build the preview.' }));
    busy = false;
    if (!result.ok) return say(result.error, true);
    if (result.items.length === 0) return say('No new notes to upload.');
    preview = { items: result.items, digest: result.digest };
    status = { text: '', bad: false };
    render();
  }

  async function confirmUpload(): Promise<void> {
    if (busy || preview === null) return;
    const digest = preview.digest;
    busy = true;
    say('Uploading to your AWS…');
    const result = await deps.api.upload(digest).catch(() => ({ ok: false as const, error: 'Could not upload.' }));
    busy = false;
    preview = null;
    if (!result.ok) return say(result.error, true);
    state = result.state;
    if (result.failed > 0) say(`Uploaded ${result.uploaded}, failed ${result.failed}. ${result.firstError ?? ''} The notes are still on this computer.`, true);
    else say(`Uploaded ${result.uploaded} to your AWS.`);
  }

  async function download(): Promise<void> {
    if (busy) return;
    busy = true;
    say('Downloading from your AWS…');
    const result = await deps.api.download().catch(() => ({ ok: false as const, error: 'Could not download.' }));
    busy = false;
    if (!result.ok) return say(result.error, true);
    state = result.state;
    const skipped = result.skipped > 0 ? ` (skipped ${result.skipped} unreadable)` : '';
    say(`Downloaded. ${result.added} new note(s), ${result.updated} changed${skipped}`);
  }

  async function remove(note: BugNoteJson): Promise<void> {
    const answer = await askDialog({ title: 'Delete this note?', body: `${note.title}\n\nOnly removed from this computer. Copies already in your AWS stay.`, okLabel: 'Delete', danger: true });
    if (!answer.ok) return;
    await mutate({ kind: 'remove', id: note.id });
    render();
  }

  async function toTodo(note: BugNoteJson): Promise<void> {
    const text = requestTextOf(note);
    const result = await deps.addTodo(text);
    flash(result.ok ? 'Made a Todo card.' : result.error);
  }

  function row(note: BugNoteJson): HTMLElement {
    const item = el('div', 'item bug-item');
    const head = el('div', 'bar');
    head.append(el('b', 'grow bug-name', note.title), el('span', note.uploaded ? 'chip green' : 'chip', note.uploaded ? 'Uploaded' : 'Not uploaded'));
    item.appendChild(head);
    if (note.memo !== '') item.appendChild(el('div', 'dim bug-memo', note.memo));
    const meta = [whenText(note.createdAt), note.screen, note.appVersion === '' ? '' : `v${note.appVersion}`, note.os].filter((s) => s !== '');
    item.appendChild(el('div', 'hint bug-meta', meta.join(' · ')));
    const actions = el('div', 'btns');
    actions.append(
      actionButton({ label: 'Use as a fix request', small: true, title: 'Fills the chat box (does not send)', onClick: () => (deps.fillChat(requestTextOf(note)), close()) }),
      actionButton({ label: 'To Todo card', small: true, onClick: () => void toTodo(note) }),
      note.status === 'open'
        ? actionButton({ label: 'Resolve', icon: 'check', small: true, onClick: () => void mutate({ kind: 'resolve', id: note.id }).then(render) })
        : actionButton({ label: 'Reopen', icon: 'undo', small: true, onClick: () => void mutate({ kind: 'reopen', id: note.id }).then(render) }),
      iconButton('trash', 'Delete note', () => void remove(note), 'btn icon sm danger'),
    );
    item.appendChild(actions);
    return item;
  }

  function previewBody(p: { items: readonly BugPreviewItem[]; digest: string }): void {
    const hidden = p.items.reduce((sum, i) => sum + i.redactions, 0);
    box.append(
      el('b', undefined, 'Check before uploading to your AWS'),
      el('div', 'hint', `The ${p.items.length} note(s) below are uploaded exactly like this. Company names, domains, IPs, keys and emails are hidden (${hidden} place(s)). Notes on this computer do not change.`),
    );
    const list = el('div', 'bug-list');
    for (const i of p.items) {
      const item = el('div', 'item bug-item');
      item.append(el('b', 'bug-name', i.title), el('div', 'dim bug-memo', i.memo === '' ? '(no memo)' : i.memo), el('div', 'hint', i.redactions > 0 ? `${i.redactions} place(s) hidden` : 'Nothing hidden'));
      list.appendChild(item);
    }
    box.appendChild(list);
    if (status.text !== '') box.appendChild(el('div', status.bad ? 'err' : 'hint', status.text));
    const btns = el('div', 'btns end');
    const back = actionButton({ label: 'Back', onClick: () => ((preview = null), render()) });
    const go = actionButton({ label: 'Confirm and upload', icon: 'push', kind: 'primary', onClick: () => void confirmUpload() });
    go.disabled = busy;
    btns.append(back, go);
    box.appendChild(btns);
  }

  function render(): void {
    const hadFocus = box.contains(document.activeElement);
    box.replaceChildren();
    const head = el('div', 'bar');
    head.append(el('b', 'grow', 'Write a report'), el('span', 'hint', shortcutText(deps.platform)), iconButton('close', 'Close', close));
    box.appendChild(head);
    if (preview !== null) {
      previewBody(preview);
      if (hadFocus) box.focus();
      return;
    }

    // 적기
    const title = el('input', 'bug-title');
    title.placeholder = 'What bothered you? (one line, required)';
    title.maxLength = BUG_TITLE_LIMIT;
    title.value = draft.title;
    title.addEventListener('input', () => {
      draft = { ...draft, title: title.value };
      saveBtn.disabled = busy || title.value.trim() === '';
    });
    title.addEventListener('keydown', (e) => {
      if (isEnterKey(e)) {
        e.preventDefault();
        void save();
      }
    });
    const memo = el('textarea', 'bug-memo-input');
    memo.placeholder = 'Details (optional): what were you doing, what happened?';
    memo.rows = 3;
    memo.maxLength = BUG_MEMO_LIMIT;
    memo.value = draft.memo;
    memo.addEventListener('input', () => (draft = { ...draft, memo: memo.value }));
    memo.addEventListener('keydown', (e) => {
      if (isEnterKey(e) && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        void save();
      }
    });
    const saveBtn = actionButton({ label: 'Save note', icon: 'plus', kind: 'primary', onClick: () => void save() });
    saveBtn.disabled = busy || draft.title.trim() === '';
    const form = el('div', 'bug-form');
    form.append(title, memo);
    const formBar = el('div', 'bar');
    formBar.append(el('span', 'hint grow', `The screen (${deps.screen()}), app version and OS are added automatically. Saved on this computer first.`), saveBtn);
    box.append(form, formBar);

    // 목록
    const open = state.items.filter((n) => n.status === 'open');
    const done = state.items.filter((n) => n.status === 'done');
    const tabs = el('div', 'tabs');
    for (const [id, label, count] of [['open', 'Open', open.length], ['done', 'Resolved', done.length]] as const) {
      const tab = el('button', id === view ? 'tab on' : 'tab', `${label} ${count}`);
      tab.type = 'button';
      tab.addEventListener('click', () => ((view = id), render()));
      tabs.appendChild(tab);
    }
    box.appendChild(tabs);
    const shown = view === 'open' ? open : done;
    const list = el('div', 'bug-list');
    if (shown.length === 0) list.appendChild(el('div', 'hint pad', view === 'open' ? 'No open notes.' : 'No resolved notes.'));
    for (const n of shown) list.appendChild(row(n));
    box.appendChild(list);

    // 내 AWS
    const sync = el('div', 'bar bug-sync');
    const up = actionButton({ label: 'Upload to my AWS', icon: 'push', small: true, title: state.syncBlocked ?? 'Shows the redacted result first', onClick: () => void startUpload() });
    const down = actionButton({ label: 'Download', icon: 'pull', small: true, title: state.syncBlocked ?? 'Merges notes stored in your AWS', onClick: () => void download() });
    up.disabled = busy || state.syncBlocked !== null;
    down.disabled = busy || state.syncBlocked !== null;
    sync.append(up, down);
    box.appendChild(sync);
    if (state.syncBlocked !== null) box.appendChild(el('div', 'hint', `${state.syncBlocked} (Settings > My AWS)`));
    if (status.text !== '') box.appendChild(el('div', status.bad ? 'err' : 'hint', status.text));
    if (hadFocus && document.activeElement === document.body) box.focus();
  }

  render();
  title0().focus();
  void deps.api.get().then((s) => {
    state = s;
    render();
  });

  function title0(): HTMLInputElement {
    return box.querySelector<HTMLInputElement>('.bug-title')!;
  }
}

