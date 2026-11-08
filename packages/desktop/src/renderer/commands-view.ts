import { COMMAND_GROUPS, CommandBook, CommandError, type Command } from '../shared/command-book.js';
import { CommandBookDto, type CommandBookJson } from '../shared/command-dto.js';
import { el } from './dom.js';

export interface CommandsApi {
  load(): Promise<CommandBook>;
  /** 저장하고, 저장된 모음을 돌려준다 */
  save(book: CommandBook): Promise<CommandBook>;
  onChange(book: CommandBook): void;
}

/** 저장소 API(JSON) ↔ 화면의 CommandBook */
export const commandsApi = (api: { getCommands(): Promise<CommandBookJson>; saveCommands(b: CommandBookJson): Promise<CommandBookJson> }, onChange: (book: CommandBook) => void): CommandsApi => ({
  load: async () => CommandBookDto.from(await api.getCommands()).toEntity(),
  save: async (book) => CommandBookDto.from(await api.saveCommands(CommandBookDto.fromEntity(book).toJSON())).toEntity(),
  onChange,
});

/**
 * 명령어 탭: 기본 명령(끄고 켜기·되돌리기)과 내 명령(더하기·고치기·지우기).
 * 입력창에서 `/`를 치면 여기 있는 켜진 명령이 자동완성으로 뜬다. 규칙은 CommandBook이 지키고 화면은 그리기만 한다.
 */
export function buildCommands(api: CommandsApi) {
  const root = el('section', 'commands');
  const head = el('div', 'rhead');
  head.append(el('b', undefined, '명령어'), el('span', 'hint', '입력창에 /를 치면 여기 있는 명령이 자동완성으로 떠요.'));

  let book = CommandBook.initial();
  let editing: string | null = null;
  const open = new Set<string>();

  // ── 내 명령 폼 ──
  const form = el('form', 'cmdform pane');
  const formTitle = el('div', 'ph', '내 명령 더하기');
  const name = el('input');
  name.placeholder = '이름  예: 배포점검 (입력창에서 /배포점검)';
  const desc = el('input');
  desc.placeholder = '한 줄 설명  예: 배포 전에 확인할 것을 점검해요';
  const template = el('textarea');
  template.rows = 3;
  template.placeholder = '팀에 보낼 프롬프트  예: {{대상}}의 배포 전 점검 목록을 만들어줘. 환경은 {{환경|qa}}';
  const note = el('div', 'hint', '{{이름}}은 명령을 칠 때 채우는 칸(꼭 필요), {{이름|기본값}}은 안 채워도 되는 칸이에요. 마지막 칸은 남은 글 전부를 받아요.');
  const error = el('div', 'err');
  const save = el('button', 'btn primary', '더하기');
  save.type = 'submit';
  const cancel = el('button', 'btn', '취소');
  cancel.type = 'button';
  cancel.hidden = true;
  const btns = el('div', 'row');
  btns.append(save, cancel);
  const fields = el('div', 'fields');
  fields.append(name, desc, template, note, error, btns);
  form.append(formTitle, fields);

  const list = el('div', 'cmdlist');
  const reset = el('button', 'btn', '기본 명령 되돌리기');
  reset.title = '꺼 둔 기본 명령을 모두 다시 켜요. 내 명령은 그대로예요.';
  const foot = el('div', 'cmdfoot');
  foot.append(reset);
  root.append(head, form, list, foot);

  async function persist(next: CommandBook): Promise<void> {
    try {
      book = await api.save(next);
      error.textContent = '';
      api.onChange(book);
    } catch (e) {
      error.textContent = e instanceof Error ? e.message : String(e);
    }
    render();
  }

  function startEdit(c: Command | null): void {
    editing = c?.id ?? null;
    formTitle.textContent = c === null ? '내 명령 더하기' : `/${c.name} 고치기`;
    save.textContent = c === null ? '더하기' : '저장';
    cancel.hidden = c === null;
    name.value = c?.name ?? '';
    desc.value = c?.description ?? '';
    template.value = c !== null && c.action.kind === 'prompt' ? c.action.template : '';
    error.textContent = '';
    if (c !== null) form.scrollIntoView({ block: 'nearest' });
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const draft = { name: name.value, description: desc.value, template: template.value };
    try {
      const next = editing === null ? book.add(draft, () => crypto.randomUUID()) : book.edit(editing, draft);
      startEdit(null);
      void persist(next);
    } catch (err) {
      error.textContent = err instanceof CommandError ? err.message : String(err);
    }
  });
  cancel.addEventListener('click', () => startEdit(null));
  reset.addEventListener('click', () => void persist(book.restoreDefaults()));

  function card(c: Command, enabled: boolean): HTMLElement {
    const box = el('div', enabled ? 'cmd' : 'cmd off');
    const top = el('div', 'top');
    const title = el('b', undefined, c.usage());
    const aliases = c.aliases.length > 0 ? el('span', 'chip', c.aliases.map((a) => `/${a}`).join(' ')) : null;
    const more = el('button', 'btn', open.has(c.id) ? '접기' : '자세히');
    more.addEventListener('click', () => {
      if (open.has(c.id)) open.delete(c.id);
      else open.add(c.id);
      render();
    });
    top.append(title);
    if (aliases !== null) top.append(aliases);
    top.append(el('span', 'ds', c.description), more);
    if (c.builtin) {
      const toggle = el('label', 'tg');
      const box2 = el('input');
      box2.type = 'checkbox';
      box2.checked = enabled;
      box2.addEventListener('change', () => void persist(book.setEnabled(c.id, box2.checked)));
      toggle.append(box2, el('span', undefined, enabled ? '켬' : '끔'));
      top.append(toggle);
    } else {
      const edit = el('button', 'btn', '고치기');
      edit.addEventListener('click', () => startEdit(c));
      const del = el('button', 'btn', '지우기');
      del.addEventListener('click', () => {
        if (editing === c.id) startEdit(null);
        void persist(book.remove(c.id));
      });
      top.append(edit, del);
    }
    box.appendChild(top);
    if (open.has(c.id)) {
      const body = el('div', 'body');
      body.appendChild(el('div', undefined, c.detail));
      if (c.args.length > 0) {
        const args = el('div', 'args');
        for (const a of c.args) args.appendChild(el('div', undefined, `${a.name}: ${a.required ? '꼭 필요해요' : `없으면 "${a.fallback ?? ''}"`}${c.argHelp(a.name) !== null ? ` · ${c.argHelp(a.name)}` : ''}`));
        body.appendChild(args);
      }
      if (c.action.kind === 'prompt') body.appendChild(el('pre', 'tpl', c.action.template));
      else body.appendChild(el('div', 'dim', '모델을 부르지 않고 앱이 바로 해요.'));
      box.appendChild(body);
    }
    return box;
  }

  function render(): void {
    list.replaceChildren();
    const entries = book.entries();
    for (const group of COMMAND_GROUPS) {
      const mine = entries.filter((e) => e.command.group === group);
      if (mine.length === 0 && group !== '내 명령') continue;
      const pane = el('div', 'pane cgroup');
      pane.appendChild(el('div', 'ph', group));
      if (mine.length === 0) pane.appendChild(el('div', 'dim pad', '아직 없어요. 위에서 더해 보세요.'));
      for (const e of mine) pane.appendChild(card(e.command, e.enabled));
      list.appendChild(pane);
    }
    reset.disabled = book.disabledIds.length === 0;
  }

  void api.load().then((b) => {
    book = b;
    api.onChange(book);
    render();
  });
  return { root };
}
