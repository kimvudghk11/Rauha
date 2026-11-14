import type { CookiesView } from '../shared/api-ipc.js';
import { el } from './dom.js';
import { button } from './todo-parts.js';

export interface CookieDialogDeps {
  get(): Promise<CookiesView>;
  clear(domain?: string): Promise<CookiesView>;
  /** 개수가 바뀌면 알린다(환경 바의 단추 글) */
  changed(count: number): void;
}

/** 쿠키 저장소 창: 도메인별 쿠키(값은 앞부분만), 도메인 지우기, 모두 지우기 */
export async function openCookieDialog(deps: CookieDialogDeps): Promise<void> {
  const veil = el('div', 'veil');
  const box = el('div', 'dialog api-cookies');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Cookies');
  const list = el('div', 'api-cookie-list');
  const close = (): void => {
    veil.remove();
    document.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  const paint = (v: CookiesView): void => {
    deps.changed(v.count);
    list.replaceChildren();
    if (v.items.length === 0) {
      list.append(el('div', 'hint pad', 'No cookies yet. Cookies a server sets (Set-Cookie) are kept here and sent back to the same site, like a browser.'));
      return;
    }
    const domains = [...new Set(v.items.map((c) => c.domain))];
    for (const d of domains) {
      const head = el('div', 'bar api-cookie-domain');
      head.append(el('b', 'mono grow', d), button('Remove', 'btn sm', async () => paint(await deps.clear(d))));
      const table = el('table', 'tbl');
      const tb = el('tbody');
      for (const c of v.items.filter((x) => x.domain === d)) {
        const tr = el('tr');
        const flags = [c.path !== '/' ? `path ${c.path}` : '', c.httpOnly ? 'HttpOnly' : '', c.secure ? 'Secure' : '', c.expires === null ? 'session' : `until ${c.expires.slice(0, 16).replace('T', ' ')}`].filter((x) => x !== '').join(' · ');
        tr.append(el('td', 'mono', c.name), el('td', 'mono dim', c.value), el('td', 'hint', flags));
        tb.append(tr);
      }
      table.append(tb);
      list.append(head, table);
    }
  };
  const btns = el('div', 'btns end');
  btns.append(button('Clear all', 'btn danger', async () => paint(await deps.clear())), button('Close', 'btn', close));
  box.append(el('b', undefined, 'Cookies'), el('div', 'hint', 'Kept only while the app is open. Values are shortened here.'), list, btns);
  veil.append(box);
  veil.addEventListener('click', (e) => {
    if (e.target === veil) close();
  });
  document.addEventListener('keydown', onKey, true);
  document.body.append(veil);
  paint(await deps.get());
}
