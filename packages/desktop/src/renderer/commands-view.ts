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
  head.append(el('b', undefined, 'Commands'), el('span', 'hint', 'Type / in the chat box to autocomplete these commands.'));

  let book = CommandBook.initial();
  let editing: string | null = null;
  const open = new Set<string>();

  // ── 내 명령 폼 ──
  const form = el('form', 'cmdform pane');
  const formTitle = el('div', 'ph', 'Add my command');
  const name = el('input');
  name.placeholder = 'Name  e.g. deploycheck (type /deploycheck in chat)';
  const desc = el('input');
  desc.placeholder = 'One-line description  e.g. check things before deploying';
  const template = el('textarea');
  template.rows = 3;
  template.placeholder = 'Prompt to send to the team  e.g. Make a pre-deploy checklist for {{target}}. Environment: {{env|qa}}';
  const note = el('div', 'hint', '{{name}} is a blank you fill in when running the command (required); {{name|default}} is optional. The last blank takes all the remaining text.');
  const error = el('div', 'err');
  const save = el('button', 'btn primary', 'Add');
  save.type = 'submit';
  const cancel = el('button', 'btn', 'Cancel');
  cancel.type = 'button';
  cancel.hidden = true;
  const btns = el('div', 'row');
  btns.append(save, cancel);
  const fields = el('div', 'fields');
  fields.append(name, desc, template, note, error, btns);
  form.append(formTitle, fields);

  const list = el('div', 'cmdlist');
  const reset = el('button', 'btn', 'Restore default commands');
  reset.title = 'Turns every disabled default command back on. Your own commands stay.';
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
    formTitle.textContent = c === null ? 'Add my command' : `Edit /${c.name}`;
    save.textContent = c === null ? 'Add' : 'Save';
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
    const box = el('div', enabled ? 'item cmd' : 'item cmd off');
    const top = el('div', 'top');
    const title = el('b', undefined, c.usage());
    const aliases = c.aliases.length > 0 ? el('span', 'chip', c.aliases.map((a) => `/${a}`).join(' ')) : null;
    const more = el('button', 'btn sm', open.has(c.id) ? 'Collapse' : 'Details');
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
      toggle.append(box2, el('span', undefined, enabled ? 'On' : 'Off'));
      top.append(toggle);
    } else {
      const edit = el('button', 'btn sm', 'Edit');
      edit.addEventListener('click', () => startEdit(c));
      const del = el('button', 'btn sm danger', 'Delete');
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
        for (const a of c.args) args.appendChild(el('div', undefined, `${a.name}: ${a.required ? 'required' : `default "${a.fallback ?? ''}"`}${c.argHelp(a.name) !== null ? ` · ${c.argHelp(a.name)}` : ''}`));
        body.appendChild(args);
      }
      if (c.action.kind === 'prompt') body.appendChild(el('pre', 'tpl', c.action.template));
      else body.appendChild(el('div', 'dim', 'The app does this directly, without calling a model.'));
      box.appendChild(body);
    }
    return box;
  }

  function render(): void {
    list.replaceChildren();
    const entries = book.entries();
    for (const group of COMMAND_GROUPS) {
      const mine = entries.filter((e) => e.command.group === group);
      if (mine.length === 0 && group !== 'My commands') continue;
      const pane = el('div', 'pane cgroup');
      pane.appendChild(el('div', 'ph', group));
      if (mine.length === 0) pane.appendChild(el('div', 'dim pad', 'None yet. Add one above.'));
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
