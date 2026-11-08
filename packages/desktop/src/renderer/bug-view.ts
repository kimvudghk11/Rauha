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
  box.setAttribute('aria-label', '답답한 점 적기');
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
    const result = await deps.api.apply(op).catch(() => ({ ok: false as const, error: '저장하지 못했어요.' }));
    if (result.ok) state = result.state;
    else say(result.error, true);
    return result.ok;
  }

  async function save(): Promise<void> {
    if (busy) return;
    if (draft.title.trim() === '') {
      say('제목을 적어 주세요.', true);
      box.querySelector<HTMLInputElement>('.bug-title')?.focus();
      return;
    }
    busy = true;
    const ok = await mutate({ kind: 'add', title: draft.title, memo: draft.memo, screen: deps.screen() });
    busy = false;
    if (ok) {
      draft = { title: '', memo: '' };
      view = 'open';
      status = { text: '적어 두었어요. 이 컴퓨터에 저장됐어요.', bad: false };
    }
    render();
    box.querySelector<HTMLInputElement>('.bug-title')?.focus();
  }

  async function startUpload(): Promise<void> {
    if (busy) return;
    busy = true;
    say('가린 결과를 만드는 중이에요…');
    const result = await deps.api.preview().catch(() => ({ ok: false as const, error: '미리보기를 만들지 못했어요.' }));
    busy = false;
    if (!result.ok) return say(result.error, true);
    if (result.items.length === 0) return say('올릴 새 메모가 없어요.');
    preview = { items: result.items, digest: result.digest };
    status = { text: '', bad: false };
    render();
  }

  async function confirmUpload(): Promise<void> {
    if (busy || preview === null) return;
    const digest = preview.digest;
    busy = true;
    say('내 AWS에 올리는 중이에요…');
    const result = await deps.api.upload(digest).catch(() => ({ ok: false as const, error: '올리지 못했어요.' }));
    busy = false;
    preview = null;
    if (!result.ok) return say(result.error, true);
    state = result.state;
    if (result.failed > 0) say(`${result.uploaded}건 올리고 ${result.failed}건은 못 올렸어요. ${result.firstError ?? ''} 메모는 이 컴퓨터에 그대로 있어요.`, true);
    else say(`${result.uploaded}건을 내 AWS에 올렸어요.`);
  }

  async function download(): Promise<void> {
    if (busy) return;
    busy = true;
    say('내 AWS에서 받아오는 중이에요…');
    const result = await deps.api.download().catch(() => ({ ok: false as const, error: '받아오지 못했어요.' }));
    busy = false;
    if (!result.ok) return say(result.error, true);
    state = result.state;
    const skipped = result.skipped > 0 ? ` (읽지 못한 ${result.skipped}건은 건너뛰었어요)` : '';
    say(`받아왔어요. 새 메모 ${result.added}건, 상태가 바뀐 메모 ${result.updated}건${skipped}`);
  }

  async function remove(note: BugNoteJson): Promise<void> {
    const answer = await askDialog({ title: '이 메모를 지울까요?', body: `${note.title}\n\n이 컴퓨터에서만 지워져요. 내 AWS에 올려 둔 것은 그대로예요.`, okLabel: '지우기', danger: true });
    if (!answer.ok) return;
    await mutate({ kind: 'remove', id: note.id });
    render();
  }

  async function toTodo(note: BugNoteJson): Promise<void> {
    const text = requestTextOf(note);
    const result = await deps.addTodo(text);
    flash(result.ok ? '할 일 카드로 만들었어요.' : result.error);
  }

  function row(note: BugNoteJson): HTMLElement {
    const item = el('div', 'item bug-item');
    const head = el('div', 'bar');
    head.append(el('b', 'grow bug-name', note.title), el('span', note.uploaded ? 'chip green' : 'chip', note.uploaded ? '올림' : '안 올림'));
    item.appendChild(head);
    if (note.memo !== '') item.appendChild(el('div', 'dim bug-memo', note.memo));
    const meta = [whenText(note.createdAt), note.screen, note.appVersion === '' ? '' : `v${note.appVersion}`, note.os].filter((s) => s !== '');
    item.appendChild(el('div', 'hint bug-meta', meta.join(' · ')));
    const actions = el('div', 'btns');
    actions.append(
      actionButton({ label: '수정 요청으로 쓰기', small: true, title: '채팅 입력칸에 채워 넣어요(보내지는 않아요)', onClick: () => (deps.fillChat(requestTextOf(note)), close()) }),
      actionButton({ label: '할 일 카드로', small: true, onClick: () => void toTodo(note) }),
      note.status === 'open'
        ? actionButton({ label: '해결', icon: 'check', small: true, onClick: () => void mutate({ kind: 'resolve', id: note.id }).then(render) })
        : actionButton({ label: '다시 열기', icon: 'undo', small: true, onClick: () => void mutate({ kind: 'reopen', id: note.id }).then(render) }),
      iconButton('trash', '메모 지우기', () => void remove(note), 'btn icon sm danger'),
    );
    item.appendChild(actions);
    return item;
  }

  function previewBody(p: { items: readonly BugPreviewItem[]; digest: string }): void {
    const hidden = p.items.reduce((sum, i) => sum + i.redactions, 0);
    box.append(
      el('b', undefined, '내 AWS에 올리기 전에 확인해 주세요'),
      el('div', 'hint', `아래 ${p.items.length}건이 이 모양 그대로 올라가요. 회사 이름·도메인·IP·키·이메일은 가렸어요(가려진 곳 ${hidden}곳). 이 컴퓨터의 메모는 바뀌지 않아요.`),
    );
    const list = el('div', 'bug-list');
    for (const i of p.items) {
      const item = el('div', 'item bug-item');
      item.append(el('b', 'bug-name', i.title), el('div', 'dim bug-memo', i.memo === '' ? '(메모 없음)' : i.memo), el('div', 'hint', i.redactions > 0 ? `가린 곳 ${i.redactions}곳` : '가린 곳 없음'));
      list.appendChild(item);
    }
    box.appendChild(list);
    if (status.text !== '') box.appendChild(el('div', status.bad ? 'err' : 'hint', status.text));
    const btns = el('div', 'btns end');
    const back = actionButton({ label: '돌아가기', onClick: () => ((preview = null), render()) });
    const go = actionButton({ label: '확인하고 올리기', icon: 'push', kind: 'primary', onClick: () => void confirmUpload() });
    go.disabled = busy;
    btns.append(back, go);
    box.appendChild(btns);
  }

  function render(): void {
    const hadFocus = box.contains(document.activeElement);
    box.replaceChildren();
    const head = el('div', 'bar');
    head.append(el('b', 'grow', '답답한 점 적기'), el('span', 'hint', shortcutText(deps.platform)), iconButton('close', '닫기', close));
    box.appendChild(head);
    if (preview !== null) {
      previewBody(preview);
      if (hadFocus) box.focus();
      return;
    }

    // 적기
    const title = el('input', 'bug-title');
    title.placeholder = '어떤 점이 답답했나요? (한 줄, 꼭 적어요)';
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
    memo.placeholder = '자세한 내용 (선택): 무엇을 하다가, 어떻게 됐나요?';
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
    const saveBtn = actionButton({ label: '적어 두기', icon: 'plus', kind: 'primary', onClick: () => void save() });
    saveBtn.disabled = busy || draft.title.trim() === '';
    const form = el('div', 'bug-form');
    form.append(title, memo);
    const formBar = el('div', 'bar');
    formBar.append(el('span', 'hint grow', `화면(${deps.screen()}) · 앱 버전 · OS가 자동으로 붙어요. 이 컴퓨터에 먼저 저장돼요.`), saveBtn);
    box.append(form, formBar);

    // 목록
    const open = state.items.filter((n) => n.status === 'open');
    const done = state.items.filter((n) => n.status === 'done');
    const tabs = el('div', 'tabs');
    for (const [id, label, count] of [['open', '미해결', open.length], ['done', '해결', done.length]] as const) {
      const tab = el('button', id === view ? 'tab on' : 'tab', `${label} ${count}`);
      tab.type = 'button';
      tab.addEventListener('click', () => ((view = id), render()));
      tabs.appendChild(tab);
    }
    box.appendChild(tabs);
    const shown = view === 'open' ? open : done;
    const list = el('div', 'bug-list');
    if (shown.length === 0) list.appendChild(el('div', 'hint pad', view === 'open' ? '미해결 메모가 없어요.' : '해결한 메모가 없어요.'));
    for (const n of shown) list.appendChild(row(n));
    box.appendChild(list);

    // 내 AWS
    const sync = el('div', 'bar bug-sync');
    const up = actionButton({ label: '내 AWS로 올리기', icon: 'push', small: true, title: state.syncBlocked ?? '가린 결과를 먼저 보여 드려요', onClick: () => void startUpload() });
    const down = actionButton({ label: '받아오기', icon: 'pull', small: true, title: state.syncBlocked ?? '내 AWS에 올려 둔 메모를 합쳐요', onClick: () => void download() });
    up.disabled = busy || state.syncBlocked !== null;
    down.disabled = busy || state.syncBlocked !== null;
    sync.append(up, down);
    box.appendChild(sync);
    if (state.syncBlocked !== null) box.appendChild(el('div', 'hint', `${state.syncBlocked} (설정 > 내 AWS)`));
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

