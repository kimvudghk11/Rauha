import { moveChoices } from '../shared/code-ops.js';
import type { NodeKind } from '../shared/code-api.js';
import { el, isEnterKey } from './dom.js';

export interface Choice {
  readonly id: string;
  readonly label: string;
  readonly kind?: 'primary' | 'danger';
}

/** 작은 확인 창. 고른 버튼의 id를 돌려준다(Esc는 마지막 버튼). 본문 아래에 안내 줄들을 더할 수 있다. */
export function ask(title: string, body: string, choices: readonly Choice[], notes: readonly string[] = []): Promise<string> {
  return new Promise((resolve) => {
    const veil = el('div', 'veil');
    const box = el('div', 'dialog');
    const done = (id: string): void => {
      veil.remove();
      window.removeEventListener('keydown', onKey, true);
      resolve(id);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      done(choices[choices.length - 1]?.id ?? 'cancel');
    };
    const btns = el('div', 'btns');
    for (const c of choices) {
      const b = el('button', `btn sm${c.kind === undefined ? '' : ` ${c.kind}`}`, c.label);
      b.addEventListener('click', () => done(c.id));
      btns.append(b);
    }
    box.append(el('b', undefined, title), el('p', undefined, body));
    for (const n of notes) box.append(el('p', 'hint', n));
    box.append(btns);
    veil.append(box);
    window.addEventListener('keydown', onKey, true);
    document.body.append(veil);
    // 위험한 확인(삭제)은 가장 안전한 버튼(마지막 = 취소)에 먼저 포커스를 둔다
    const danger = btns.querySelector('.danger') !== null;
    (danger ? btns.querySelector<HTMLElement>('button:last-child') : (btns.querySelector<HTMLElement>('.primary') ?? btns.querySelector<HTMLElement>('button')))?.focus();
  });
}

/** "이동" 대화상자: 갈 폴더를 골라 그 경로를 돌려준다(작업 폴더는 ''). 취소하면 null. */
export function chooseFolder(name: string, path: string, kind: NodeKind, dirs: readonly string[]): Promise<string | null> {
  return new Promise((resolve) => {
    const veil = el('div', 'veil');
    const box = el('div', 'dialog');
    const finish = (value: string | null): void => {
      veil.remove();
      window.removeEventListener('keydown', onKey, true);
      resolve(value);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      finish(null);
    };
    const all = moveChoices(path, kind, dirs);
    const search = el('input', 'sm');
    search.placeholder = '폴더 찾기';
    search.spellcheck = false;
    const list = el('div', 'choose-list');
    const paint = (): void => {
      const q = search.value.trim().toLowerCase();
      const shown = all.filter((d) => q === '' || d.toLowerCase().includes(q) || (d === '' && '작업 폴더'.includes(q)));
      list.replaceChildren();
      if (shown.length === 0) list.append(el('div', 'hint pad', '갈 수 있는 폴더가 없어요.'));
      for (const d of shown.slice(0, 200)) {
        const b = el('button', 'choose-row', d === '' ? '(작업 폴더)' : d);
        b.type = 'button';
        b.addEventListener('click', () => finish(d));
        list.append(b);
      }
    };
    search.addEventListener('input', paint);
    search.addEventListener('keydown', (e) => {
      if (!isEnterKey(e)) return;
      e.preventDefault();
      list.querySelector<HTMLElement>('.choose-row')?.click();
    });
    const cancel = el('button', 'btn sm', '취소');
    cancel.addEventListener('click', () => finish(null));
    const btns = el('div', 'btns');
    btns.append(cancel);
    box.append(el('b', undefined, `‘${name}’을(를) 어느 폴더로 옮길까요?`), el('p', 'hint', '같은 이름이 있는 곳은 덮어쓰지 않고 거절해요. 끌어서 놓아도 돼요.'), search, list, btns);
    veil.append(box);
    window.addEventListener('keydown', onKey, true);
    document.body.append(veil);
    paint();
    search.focus();
  });
}
