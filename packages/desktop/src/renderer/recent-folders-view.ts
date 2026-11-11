import { recentFolderRows } from '../shared/recent-folders.js';
import { el } from './dom.js';

export interface RecentFoldersDeps {
  /** 최근 폴더(맨 앞이 가장 최근) */
  readonly folders: readonly string[];
  /** 지금 작업 폴더(목록에서 뺀다) */
  readonly current: string | null;
  /** 폴더가 디스크에 아직 있는지(경로 → 있음) */
  status(): Promise<Readonly<Record<string, boolean>>>;
  /** 목록에서 뺀다(폴더 자체는 지우지 않는다) */
  forget(path: string): Promise<unknown>;
  /** 쓰겠다고 골랐다. 허락은 호출한 쪽의 기존 흐름이 묻는다(여기서 열지 않는다). */
  choose(path: string): void;
}

/**
 * 최근 작업 폴더 목록. 고르는 것만 돕는다: 단추는 `choose`를 부를 뿐 폴더를 열거나 허락하지 않는다.
 * 사라진 폴더는 흐리게 두고 "Remove"만 준다. 고르는 순간에도 디스크를 한 번 더 확인한다.
 */
export function buildRecentFolders(deps: RecentFoldersDeps): HTMLElement {
  const root = el('div', 'recent');
  let folders = deps.folders;
  let exists: Readonly<Record<string, boolean>> = {};

  const paint = (): void => {
    const rows = recentFolderRows(folders, exists, deps.current);
    root.hidden = rows.length === 0;
    root.replaceChildren();
    if (rows.length === 0) return;
    root.appendChild(el('div', 'hint pad', 'Recent folders'));
    for (const r of rows) {
      const item = el('div', r.missing ? 'item recent-row off' : 'item recent-row');
      const text = el('span', 'recent-text');
      text.append(el('b', undefined, r.name), el('span', 'hint', r.missing ? `Not found · ${r.path}` : r.path));
      item.title = r.path;
      const btn = el('button', 'btn sm', r.missing ? 'Remove' : 'Use');
      btn.type = 'button';
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        btn.disabled = true;
        void (r.missing ? remove(r.path) : use(r.path)).finally(() => (btn.disabled = false));
      });
      item.append(text, btn);
      root.appendChild(item);
    }
  };
  const remove = async (path: string): Promise<void> => {
    await deps.forget(path);
    folders = folders.filter((p) => p !== path);
    paint();
  };
  const use = async (path: string): Promise<void> => {
    exists = await deps.status().catch(() => exists);
    if (exists[path] !== true) return paint();
    deps.choose(path);
  };

  void deps.status().then((s) => {
    exists = s;
    paint();
  }, paint);
  paint();
  return root;
}
