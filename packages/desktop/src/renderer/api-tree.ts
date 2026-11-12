import type { ApiCollections, TreeItem } from '../shared/api-collections.js';
import type { HistoryEntry } from '../shared/api-response.js';
import { el, isEnterKey } from './dom.js';
import { ago, methodBadge, shortUrl } from './api-parts.js';
import { showMenu, type MenuItem } from './todo-parts.js';

export interface TreeActions {
  openRequest(id: string): void;
  openHistory(entry: HistoryEntry): void;
  newRequest(parentId: string | null): void;
  newFolder(parentId: string | null): void;
  rename(id: string, current: string): void;
  duplicate(id: string): void;
  remove(id: string, name: string, isFolder: boolean): void;
  copyCurl(id: string): void;
  exportHttp(id: string): void;
  removeHistory(id: string): void;
}

const dots = (anchor: HTMLElement, label: string, items: () => MenuItem[]): HTMLElement => {
  const b = el('button', 'btn icon sm ghost api-more', '⋯');
  b.type = 'button';
  b.title = label;
  b.setAttribute('aria-label', label);
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    showMenu(b, items());
  });
  anchor.append(b);
  return b;
};

/** 컬렉션 나무: 폴더(접기)와 요청 줄. 줄을 누르면 열고, ⋯ 메뉴나 오른쪽 클릭으로 복제·이름 바꾸기·삭제 */
export function paintCollections(host: HTMLElement, c: ApiCollections, open: Set<string>, currentId: string | null, actions: TreeActions, toggle: (id: string) => void): void {
  host.replaceChildren();
  const tree = c.tree();
  if (tree.length === 0) {
    const empty = el('div', 'api-empty');
    empty.append(el('b', undefined, 'No requests yet'), el('span', 'dim', 'Choose a project above to list its API, create a request, or import a cURL command, a .http file or an OpenAPI document.'));
    host.append(empty);
    return;
  }
  const walk = (items: readonly TreeItem[], depth: number): void => {
    for (const item of items) {
      const row = el('div', `row-item api-row${item.kind === 'request' && item.id === currentId ? ' on' : ''}${item.gone ? ' gone' : ''}${item.auto ? ' auto' : ''}`);
      if (item.gone) row.title = 'This endpoint is no longer in the project code. Delete it if you do not need it.';
      else if (item.auto) row.title = 'Made from the project code. Your edits are kept when the project is read again.';
      row.style.setProperty('--depth', String(depth));
      row.tabIndex = 0;
      row.dataset['id'] = item.id;
      if (item.kind === 'folder') {
        const isOpen = open.has(item.id);
        row.append(el('span', 'api-chev', isOpen ? '▾' : '▸'), el('span', 'api-name grow', item.name), el('span', 'dim api-count', String(countRequests(item))));
        const menuItems = (): MenuItem[] => [
          { label: 'New request here', pick: () => actions.newRequest(item.id) },
          { label: 'New folder here', pick: () => actions.newFolder(item.id) },
          'sep',
          { label: 'Rename', pick: () => actions.rename(item.id, item.name) },
          { label: 'Duplicate', pick: () => actions.duplicate(item.id) },
          { label: 'Export as .http', pick: () => actions.exportHttp(item.id) },
          'sep',
          { label: 'Delete', danger: true, pick: () => actions.remove(item.id, item.name, true) },
        ];
        dots(row, `Folder actions for ${item.name}`, menuItems);
        row.addEventListener('click', () => toggle(item.id));
        row.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          showMenu({ x: e.clientX, y: e.clientY }, menuItems());
        });
        row.addEventListener('keydown', (e) => {
          if (isEnterKey(e) || e.key === ' ') {
            e.preventDefault();
            toggle(item.id);
          }
        });
        host.append(row);
        if (isOpen) walk(item.children, depth + 1);
      } else {
        row.append(methodBadge(item.method), el('span', 'api-name grow', item.name));
        if (item.gone) row.append(el('span', 'chip api-gone', 'Removed in code'));
        const menuItems = (): MenuItem[] => [
          { label: 'Rename', pick: () => actions.rename(item.id, item.name) },
          { label: 'Duplicate', pick: () => actions.duplicate(item.id) },
          { label: 'Copy as cURL', pick: () => actions.copyCurl(item.id) },
          { label: 'Export as .http', pick: () => actions.exportHttp(item.id) },
          'sep',
          { label: 'Delete', danger: true, pick: () => actions.remove(item.id, item.name, false) },
        ];
        dots(row, `Request actions for ${item.name}`, menuItems);
        row.addEventListener('click', () => actions.openRequest(item.id));
        row.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          showMenu({ x: e.clientX, y: e.clientY }, menuItems());
        });
        row.addEventListener('keydown', (e) => {
          if (isEnterKey(e)) actions.openRequest(item.id);
        });
        host.append(row);
      }
    }
  };
  walk(tree, 0);
}

const countRequests = (t: TreeItem): number => (t.kind === 'request' ? 1 : t.children.reduce((n, c) => n + countRequests(c), 0));

const STATUS_COLOR = (s: number | null): string => (s === null ? 'red' : s >= 500 ? 'red' : s >= 400 ? 'yellow' : s >= 200 && s < 300 ? 'green' : 'blue');

/** 기록 목록: 최근 것이 위. 줄을 누르면 그 요청을 편집기로 불러온다 */
export function paintHistory(host: HTMLElement, entries: readonly HistoryEntry[], now: number, actions: TreeActions): void {
  host.replaceChildren();
  if (entries.length === 0) {
    const empty = el('div', 'api-empty');
    empty.append(el('b', undefined, 'No history yet'), el('span', 'dim', 'Requests you send show up here (the latest 100).'));
    host.append(empty);
    return;
  }
  for (const e of entries) {
    const row = el('div', 'row-item api-row api-hist');
    row.tabIndex = 0;
    const text = el('div', 'api-hist-text grow');
    text.append(el('span', 'api-name', e.request.name === '' ? shortUrl(e.request.url) : `${e.request.name}`), el('span', 'dim api-url', `${shortUrl(e.request.url)} · ${ago(e.at, now)}`));
    row.append(methodBadge(e.request.method), text, el('span', `chip ${STATUS_COLOR(e.status)}`, e.status === null ? 'Failed' : String(e.status)));
    dots(row, 'History actions', () => [{ label: 'Remove from history', danger: true, pick: () => actions.removeHistory(e.id) }]);
    row.addEventListener('click', () => actions.openHistory(e));
    row.addEventListener('keydown', (ev) => {
      if (isEnterKey(ev)) actions.openHistory(e);
    });
    host.append(row);
  }
}
