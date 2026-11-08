import { codeFailText, type CodeApi, type TreeEntry } from '../shared/code-api.js';
import { el } from './dom.js';

export interface TreeHooks {
  readonly api: Pick<CodeApi, 'tree'>;
  /** 파일을 눌렀다 */
  readonly open: (path: string) => void;
}

const MORE = '항목이 너무 많아 일부만 보여요.';

/**
 * 파일 탐색기. 폴더는 펼칠 때 그 폴더만 읽는다(지연 로딩). 생성물 폴더(node_modules·dist …)는 흐리게 접어 두고,
 * 비밀 파일과 작업 폴더 밖으로 가는 바로가기는 눌러도 열리지 않는다.
 */
export class CodeTreeView {
  readonly root = el('div', 'tree');
  private readonly expanded = new Set<string>();
  private active: string | null = null;
  private generation = 0;

  constructor(private readonly hooks: TreeHooks) {}

  /** 처음부터 다시 그린다. 펼쳐 둔 폴더는 다시 읽어 그대로 펼친다. */
  async refresh(): Promise<void> {
    const gen = ++this.generation;
    const top = el('div', 'tree-children');
    await this.fill(top, '', 0, gen);
    if (gen === this.generation) this.root.replaceChildren(top);
  }

  /** 지금 열려 있는 파일 표시를 바꾼다 */
  setActive(path: string | null): void {
    this.active = path;
    for (const row of this.root.querySelectorAll<HTMLElement>('.tree-row')) row.classList.toggle('on', row.dataset['path'] === path);
  }

  /** 파일이 있는 폴더들을 펼쳐 보이게 한다(다른 곳에서 파일을 열었을 때) */
  async reveal(path: string): Promise<void> {
    const parts = path.split('/').slice(0, -1);
    let changed = false;
    for (let i = 1; i <= parts.length; i++) {
      const dir = parts.slice(0, i).join('/');
      if (!this.expanded.has(dir)) {
        this.expanded.add(dir);
        changed = true;
      }
    }
    if (changed) await this.refresh();
    this.setActive(path);
  }

  private async fill(container: HTMLElement, dir: string, depth: number, gen: number): Promise<void> {
    const result = await this.hooks.api.tree(dir);
    if (gen !== this.generation) return;
    if (!result.ok) {
      container.append(el('div', 'tree-note', codeFailText(result.reason)));
      return;
    }
    if (result.entries.length === 0 && depth === 0) container.append(el('div', 'tree-note', '비어 있는 폴더예요.'));
    for (const entry of result.entries) {
      const row = this.row(entry, depth);
      container.append(row.row);
      if (entry.kind === 'dir') {
        container.append(row.children);
        if (this.expanded.has(entry.path) && !entry.blocked) await this.fill(row.children, entry.path, depth + 1, gen);
        if (gen !== this.generation) return;
      }
    }
    if (result.truncated) container.append(el('div', 'tree-note', MORE));
  }

  private row(entry: TreeEntry, depth: number): { row: HTMLElement; children: HTMLElement } {
    const row = el('button', 'tree-row');
    row.type = 'button';
    row.dataset['path'] = entry.path;
    row.style.paddingLeft = `${8 + depth * 12}px`;
    row.classList.toggle('on', entry.path === this.active);
    row.classList.toggle('heavy', entry.heavy);
    row.classList.toggle('locked', entry.locked || entry.blocked);
    const children = el('div', 'tree-children');
    const open = entry.kind === 'dir' && this.expanded.has(entry.path) && !entry.blocked;
    row.append(el('span', 'tree-chev', entry.kind === 'dir' ? (open ? '▾' : '▸') : ''), el('span', 'tree-name', entry.name));
    if (entry.link) row.append(el('span', 'tree-tag', '링크'));
    if (entry.locked) row.append(el('span', 'tree-tag', '비밀'));
    if (entry.heavy) row.append(el('span', 'tree-tag', '생성물'));
    row.title = entry.locked ? '비밀 파일이라 열지 않아요' : entry.blocked ? '작업 폴더 밖을 가리켜서 열지 않아요' : entry.path;
    row.addEventListener('click', () => {
      if (entry.locked || entry.blocked) return;
      if (entry.kind === 'file') return this.hooks.open(entry.path);
      void this.toggle(entry, row, children);
    });
    return { row, children };
  }

  private async toggle(entry: TreeEntry, row: HTMLElement, children: HTMLElement): Promise<void> {
    const chev = row.querySelector('.tree-chev');
    if (this.expanded.has(entry.path)) {
      this.expanded.delete(entry.path);
      children.replaceChildren();
      if (chev !== null) chev.textContent = '▸';
      return;
    }
    this.expanded.add(entry.path);
    if (chev !== null) chev.textContent = '▾';
    const depth = Math.round((Number.parseInt(row.style.paddingLeft, 10) - 8) / 12) + 1;
    await this.fill(children, entry.path, depth, this.generation);
  }
}
