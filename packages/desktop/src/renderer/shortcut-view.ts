import { shortcutSheet } from '../shared/shortcut-sheet.js';
import { el } from './dom.js';

let open: (() => void) | null = null;

/** 단축키 안내창. 이미 열려 있으면 닫는다(같은 키로 켜고 끈다). Esc·바깥 누르기·Close로 닫는다. */
export function toggleShortcutSheet(platform: string): void {
  if (open !== null) return open();
  const veil = el('div', 'veil');
  const box = el('div', 'dialog sheet');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Keyboard shortcuts');
  box.appendChild(el('b', undefined, 'Keyboard shortcuts'));
  for (const group of shortcutSheet(platform)) {
    box.appendChild(el('span', 'dim', group.title));
    const list = el('div', 'sheet-list');
    for (const row of group.rows) list.append(el('span', 'kbd', row.keys), el('span', undefined, row.label));
    box.appendChild(list);
  }
  const close = el('button', 'btn primary', 'Close');
  const row = el('div', 'btns');
  row.appendChild(close);
  box.appendChild(row);
  const finish = () => {
    document.removeEventListener('keydown', onKey, true);
    veil.remove();
    open = null;
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    finish();
  };
  open = finish;
  close.addEventListener('click', finish);
  veil.addEventListener('click', (e) => e.target === veil && finish());
  document.addEventListener('keydown', onKey, true);
  veil.appendChild(box);
  document.body.appendChild(veil);
  close.focus();
}
