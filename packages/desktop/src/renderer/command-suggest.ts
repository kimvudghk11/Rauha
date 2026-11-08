import type { Command } from '../shared/command-book.js';
import { el, isEnterKey } from './dom.js';

/**
 * 입력창에 `/`를 치는 동안 입력창 위에 뜨는 명령 후보 목록.
 * 키: ↑↓ 고르기, Tab 이름 채우기, Enter(이름이 덜 쳐졌으면 채우기, 다 쳤으면 보내기), Esc 닫기.
 */
export function attachSuggest(input: HTMLTextAreaElement, host: HTMLElement, suggest: (text: string) => readonly Command[]) {
  const box = el('div', 'cmd-suggest');
  box.hidden = true;
  host.appendChild(box);
  let list: readonly Command[] = [];
  let index = 0;

  const fill = (c: Command): void => {
    input.value = `/${c.name}${c.args.length > 0 ? ' ' : ''}`;
    input.focus();
    update();
  };

  function paint(): void {
    box.replaceChildren();
    list.forEach((c, i) => {
      const row = el('div', i === index ? 'it on' : 'it');
      row.append(el('b', undefined, c.usage()), el('span', 'ds', c.description));
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        fill(c);
      });
      box.appendChild(row);
    });
    box.children[index]?.scrollIntoView({ block: 'nearest' });
  }

  function update(): void {
    list = suggest(input.value);
    index = Math.min(index, Math.max(0, list.length - 1));
    box.hidden = list.length === 0;
    if (list.length > 0) paint();
  }

  const close = (): void => {
    list = [];
    box.hidden = true;
  };

  return {
    update,
    close,
    /** 키를 썼으면 true(그 키는 입력창 기본 동작을 하지 않는다) */
    key(e: KeyboardEvent): boolean {
      if (box.hidden || list.length === 0 || e.isComposing) return false;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        index = (index + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length;
        paint();
        return true;
      }
      if (e.key === 'Escape') {
        close();
        return true;
      }
      const picked = list[index]!;
      const typed = input.value.trim().slice(1).toLowerCase();
      const complete = picked.name.toLowerCase() === typed || picked.aliases.some((a) => a.toLowerCase() === typed);
      if (e.key === 'Tab' || (isEnterKey(e) && !e.shiftKey && !complete)) {
        fill(picked);
        return true;
      }
      return false;
    },
  };
}
