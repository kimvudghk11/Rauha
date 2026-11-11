import type { EnvironmentsView } from '../shared/api-dto.js';
import type { EnvResult } from '../shared/api-ipc.js';
import { el } from './dom.js';
import { askText } from './api-parts.js';
import { button, confirmDialog } from './todo-parts.js';

interface Row {
  name: string;
  /** null = 비밀 값을 그대로 둔다(화면은 값을 모른다) */
  value: string | null;
  secret: boolean;
  has: boolean;
}

export interface EnvDialogDeps {
  envs(): EnvironmentsView;
  apply(op: unknown): Promise<EnvResult>;
  /** 닫힐 때(바뀐 환경 목록으로 위쪽 선택칸을 다시 그린다) */
  changed(envs: EnvironmentsView): void;
}

/**
 * 환경 관리 창: 환경을 만들고 지우고, 변수(이름·값·비밀)를 고친다.
 * 비밀 변수의 값은 화면이 모른다. 값 칸을 건드리지 않으면 그대로 두고, 새로 적으면 바꾼다.
 */
export function openEnvDialog(deps: EnvDialogDeps, startId: string | null): void {
  const veil = el('div', 'veil');
  const box = el('div', 'dialog api-env');
  let selected = startId ?? deps.envs().items[0]?.id ?? null;
  let rows: Row[] = [];
  let name = '';
  let dirty = false;

  const close = (): void => {
    veil.remove();
    document.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && document.querySelectorAll('.veil').length === 1) {
      e.stopPropagation();
      tryClose();
    }
  };
  const tryClose = (): void => {
    if (!dirty) return close();
    confirmDialog('Discard changes?', 'The environment has changes that are not saved.', [{ label: 'Discard', cls: 'btn danger', pick: close }]);
  };

  const load = (): void => {
    const env = deps.envs().items.find((e) => e.id === selected);
    name = env?.name ?? '';
    rows = (env?.vars ?? []).map((v) => ({ name: v.name, value: v.secret ? null : v.value, secret: v.secret, has: v.has }));
    dirty = false;
  };

  const notice = el('div', 'notice');
  notice.hidden = true;
  const say = (t: string): void => {
    notice.textContent = t;
    notice.hidden = t === '';
  };

  const run = async (op: unknown): Promise<boolean> => {
    const r = await deps.apply(op);
    if (!r.ok) {
      say(r.error);
      return false;
    }
    say('');
    deps.changed(r.envs);
    return true;
  };

  const paint = (): void => {
    const envs = deps.envs();
    box.replaceChildren();
    const head = el('div', 'bar');
    head.append(el('b', 'grow', 'Environments'), button('×', 'btn icon ghost', tryClose));
    (head.lastElementChild as HTMLElement).setAttribute('aria-label', 'Close');

    const pick = el('select');
    for (const e of envs.items) {
      const o = el('option', undefined, e.name);
      o.value = e.id;
      pick.append(o);
    }
    if (selected !== null) pick.value = selected;
    pick.addEventListener('change', () => {
      selected = pick.value;
      load();
      paint();
    });
    const add = button('New', 'btn', async () => {
      const n = await askText({ title: 'New environment', placeholder: 'Local', ok: 'Create' });
      if (n === null) return;
      if (await run({ kind: 'add', name: n })) {
        selected = deps.envs().items.find((e) => e.name === n.trim())?.id ?? selected;
        load();
        paint();
      }
    });
    const bar = el('div', 'bar');
    if (envs.items.length > 0) bar.append(pick);
    bar.append(add);
    box.append(head, bar, notice);

    if (selected === null || !envs.items.some((e) => e.id === selected)) {
      box.append(el('div', 'hint', 'No environments yet. Create one to store variables such as {{base_url}} and {{token}}.'));
      veil.append(box);
      return;
    }

    const nameInput = el('input');
    nameInput.value = name;
    nameInput.spellcheck = false;
    nameInput.addEventListener('input', () => {
      name = nameInput.value;
      dirty = true;
    });
    const nameRow = el('label', 'api-field');
    nameRow.append(el('span', 'lbl', 'Name'), nameInput);

    const list = el('div', 'api-vars');
    rows.forEach((row, i) => {
      const line = el('div', 'api-var');
      const n = el('input', 'sm');
      n.value = row.name;
      n.placeholder = 'name';
      n.spellcheck = false;
      n.addEventListener('input', () => {
        row.name = n.value;
        dirty = true;
      });
      const v = el('input', 'sm');
      v.type = row.secret ? 'password' : 'text';
      v.value = row.value ?? '';
      v.placeholder = row.value === null && row.has ? 'Saved, hidden (type to replace)' : 'value';
      v.autocomplete = 'off';
      v.addEventListener('input', () => {
        row.value = v.value;
        dirty = true;
      });
      const secret = el('input');
      secret.type = 'checkbox';
      secret.checked = row.secret;
      secret.addEventListener('change', () => {
        row.secret = secret.checked;
        // 숨겨 둔 값은 화면이 모르므로 비밀을 풀 때는 값을 다시 적게 한다
        if (!row.secret && row.value === null) row.value = '';
        dirty = true;
        paint();
      });
      const sl = el('label', 'api-mask');
      sl.append(secret, el('span', undefined, 'Secret'));
      const del = button('×', 'btn icon sm ghost', () => {
        rows.splice(i, 1);
        dirty = true;
        paint();
      });
      del.title = 'Remove variable';
      del.setAttribute('aria-label', 'Remove variable');
      line.append(n, v, sl, del);
      list.append(line);
    });

    const foot = el('div', 'btns');
    const addVar = button('Add variable', 'btn', () => {
      rows.push({ name: '', value: '', secret: false, has: false });
      dirty = true;
      paint();
      box.querySelectorAll<HTMLInputElement>('.api-var:last-child input.sm')[0]?.focus();
    });
    const remove = button('Delete environment', 'btn danger', () =>
      confirmDialog('Delete this environment?', `"${name}" and its variables will be removed. Requests that use them will report missing variables.`, [
        {
          label: 'Delete',
          cls: 'btn danger',
          pick: async () => {
            if (selected !== null && (await run({ kind: 'remove', id: selected }))) {
              selected = deps.envs().items[0]?.id ?? null;
              load();
              paint();
            }
          },
        },
      ]),
    );
    const save = button('Save', 'btn primary', async () => {
      if (selected === null) return;
      const vars = rows.filter((r) => r.name.trim() !== '').map((r) => ({ name: r.name.trim(), value: r.value, secret: r.secret }));
      if (await run({ kind: 'save', id: selected, name, vars })) {
        load();
        paint();
        say('Saved.');
      }
    });
    foot.append(addVar, el('span', 'grow'), remove, save);
    box.append(nameRow, el('div', 'hint', 'Secret values stay on this computer, are never sent to the AI, and are hidden in history. Use them in requests as {{name}}.'), list, foot);
    veil.append(box);
  };

  load();
  paint();
  document.addEventListener('keydown', onKey, true);
  document.body.append(veil);
  box.querySelector<HTMLElement>('select, button')?.focus();
}
