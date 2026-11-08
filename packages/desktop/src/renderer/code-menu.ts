import { el } from './dom.js';

export interface MenuItem {
  readonly label: string;
  /** 오른쪽에 흐리게 보일 단축키 */
  readonly hint?: string;
  readonly danger?: boolean;
  readonly disabled?: boolean;
  /** 막은 까닭(마우스를 올리면 보인다) */
  readonly why?: string;
  readonly run: () => void;
}

export type MenuEntry = MenuItem | 'sep';

let closeOpen: (() => void) | null = null;

/** 오른쪽 클릭 메뉴(공통 .menu). 바깥을 누르거나 Esc, 창이 포커스를 잃으면 닫힌다. ↑↓로 고르고 Enter로 실행한다. */
export function openMenu(entries: readonly MenuEntry[], x: number, y: number): HTMLElement {
  closeOpen?.();
  const menu = el('div', 'menu ctx');
  menu.setAttribute('role', 'menu');
  const buttons: HTMLButtonElement[] = [];
  const close = (): void => {
    menu.remove();
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', close);
    if (closeOpen === close) closeOpen = null;
  };
  for (const entry of entries) {
    if (entry === 'sep') {
      menu.append(el('div', 'sep'));
      continue;
    }
    const b = el('button', entry.danger === true ? 'danger' : undefined);
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.disabled = entry.disabled === true;
    if (entry.why !== undefined) b.title = entry.why;
    b.append(el('span', undefined, entry.label));
    if (entry.hint !== undefined) b.append(el('span', 'menu-hint', entry.hint));
    b.addEventListener('click', () => {
      close();
      entry.run();
    });
    buttons.push(b);
    menu.append(b);
  }
  const onDown = (e: Event): void => {
    if (!menu.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const live = buttons.filter((b) => !b.disabled);
    if (live.length === 0) return;
    const at = live.indexOf(document.activeElement as HTMLButtonElement);
    live[(at + (e.key === 'ArrowDown' ? 1 : -1) + live.length) % live.length]?.focus();
  };
  closeOpen = close;
  document.body.append(menu);
  menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - menu.offsetWidth - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - menu.offsetHeight - 4))}px`;
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', close);
  buttons.find((b) => !b.disabled)?.focus();
  return menu;
}

export function closeMenu(): void {
  closeOpen?.();
}
