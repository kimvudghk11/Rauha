import { el } from './dom.js';
import { gitIcon, type GitIcon } from './git-icons.js';

export interface ActionOptions {
  readonly label: string;
  readonly icon?: GitIcon | undefined;
  readonly kind?: 'primary' | 'danger' | 'ghost' | undefined;
  readonly small?: boolean;
  /** 마우스를 올렸을 때 나오는 설명(없으면 글자가 그대로 접근성 이름) */
  readonly title?: string;
  readonly onClick: () => void;
}

/** 아이콘 + 글자 버튼. 모양은 ui.css의 .btn만 쓴다. */
export function actionButton(o: ActionOptions): HTMLButtonElement {
  const b = el('button', ['btn', o.kind, o.small === true ? 'sm' : ''].filter((c) => c !== undefined && c !== '').join(' '));
  b.type = 'button';
  if (o.icon !== undefined) b.append(gitIcon(o.icon));
  b.append(el('span', undefined, o.label));
  if (o.title !== undefined) {
    b.title = o.title;
    b.setAttribute('aria-label', o.title);
  }
  b.addEventListener('click', o.onClick);
  return b;
}

/** 아이콘만 있는 작은 버튼: 툴팁과 접근성 이름이 꼭 있어야 한다. */
export function iconButton(icon: GitIcon, label: string, onClick: () => void, className = 'btn icon sm ghost'): HTMLButtonElement {
  const b = el('button', className);
  b.type = 'button';
  b.title = label;
  b.setAttribute('aria-label', label);
  b.append(gitIcon(icon));
  b.addEventListener('click', onClick);
  return b;
}

/** "복사했어요" 같은 잠깐 뜨는 알림(오른쪽 아래). 2.6초 뒤 사라진다. */
export function flash(text: string, host: ParentNode = document.body): void {
  const toasts = host.querySelector('.toasts') ?? document.querySelector('.toasts') ?? host;
  const t = el('div', 'toast flash', text);
  t.setAttribute('role', 'status');
  toasts.append(t);
  setTimeout(() => t.remove(), 2600);
}

let closeMenu: (() => void) | null = null;

/** 기준 단추 아래에 고르기 메뉴(.menu)를 띄운다. 바깥을 누르거나 Esc로 닫힌다. 체크 표시는 켜진 항목. */
export function openChoiceMenu(anchor: HTMLElement, title: string, items: readonly { readonly label: string; readonly on: boolean; readonly pick: () => void }[]): void {
  closeMenu?.();
  const menu = el('div', 'menu');
  menu.setAttribute('role', 'menu');
  const close = (): void => {
    menu.remove();
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', close);
    anchor.setAttribute('aria-expanded', 'false');
    if (closeMenu === close) closeMenu = null;
  };
  const onDown = (e: Event): void => {
    if (!menu.contains(e.target as Node) && !anchor.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      anchor.focus();
    }
  };
  menu.append(el('div', 'lbl', title));
  for (const it of items) {
    const b = el('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitemcheckbox');
    b.setAttribute('aria-checked', String(it.on));
    const mark = gitIcon('check');
    mark.classList.add('menu-mark');
    if (!it.on) mark.classList.add('off');
    b.append(mark, el('span', 'grow', it.label));
    b.addEventListener('click', () => {
      close();
      it.pick();
    });
    menu.append(b);
  }
  document.body.append(menu);
  const a = anchor.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(a.left, window.innerWidth - menu.offsetWidth - 4))}px`;
  menu.style.top = `${Math.min(a.bottom + 2, Math.max(4, window.innerHeight - menu.offsetHeight - 4))}px`;
  anchor.setAttribute('aria-expanded', 'true');
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', close);
  closeMenu = close;
  (menu.querySelector('button') as HTMLElement | null)?.focus();
}
