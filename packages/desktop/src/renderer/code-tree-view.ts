import { codeFailText, type CodeApi, type NodeKind, type TreeEntry } from '../shared/code-api.js';
import { ChangeMap, type ChangeCode } from '../shared/code-changes.js';
import { checkName, nameOf, parentOf, planMove, stemEnd } from '../shared/code-ops.js';
import { repoNodeMark } from '../shared/repo-node.js';
import type { RepoRow } from '../shared/ipc.js';
import { el, isEnterKey } from './dom.js';
import { iconByName } from './file-icons.js';
import { changeTitle, folderMark, shownCode } from './tree-mark.js';


/** 오른쪽 클릭·키보드로 고른 대상. 빈 곳이면 kind가 'root'(작업 폴더). */
export interface TreeTarget {
  readonly path: string;
  readonly kind: NodeKind | 'root';
  /** 눌러도 열리지 않는 항목(비밀 파일·밖으로 가는 바로가기) */
  readonly blocked: boolean;
  /** 이 줄이 레포 노드면 그 정보 */
  readonly repo: RepoRow | null;
}

export interface TreeHooks {
  readonly api: Pick<CodeApi, 'tree'>;
  /** 파일을 눌렀다 */
  readonly open: (path: string) => void;
  readonly contextMenu: (target: TreeTarget, x: number, y: number) => void;
  /** 트리에 포커스가 있을 때 누른 키(F2·Delete·복사·붙여넣기). 처리했으면 true. */
  readonly key: (e: KeyboardEvent, target: TreeTarget | null) => boolean;
  /** 끌어다 놓았다 */
  readonly drop: (path: string, destDir: string) => void;
  readonly openGit: (repoRoot: string) => void;
  readonly reloadRepos: () => void;
  /** 이름 겹침을 대소문자 구분 없이 보는 PC인지(Windows·macOS) */
  readonly caseInsensitive: boolean;
  /** 고른 줄이 바뀌었다(도구줄 단추를 켜고 끈다) */
  readonly onPick?: (target: TreeTarget | null) => void;
  /** 열리지 않는 항목을 눌렀다: 이유를 알리게 한다('secret'은 비밀 파일, 'outside'는 작업 폴더 밖 바로가기) */
  readonly refused?: (name: string, reason: 'secret' | 'outside') => void;
}

const MORE = '항목이 너무 많아 일부만 보여요.';
const DRAG_TYPE = 'text/x-rauha-path';


/**
 * 파일 탐색기. 폴더는 펼칠 때 그 폴더만 읽는다(지연 로딩). 생성물 폴더(node_modules·dist …)는 흐리게 접어 두고,
 * 비밀 파일과 작업 폴더 밖으로 가는 바로가기는 눌러도 열리지 않는다.
 * 작업 폴더 아래의 레포·문서 폴더는 줄에 브랜치·↑↓·변경 수·작업 중 표시가 붙는 "레포 노드"가 된다.
 * 줄 고르기, 오른쪽 클릭 메뉴, 이름 바꾸기·새로 만들기 입력, 끌어서 옮기기도 여기서 받고 실제 조작은 hooks 쪽이 한다.
 */
export class CodeTreeView {
  readonly root = el('div', 'tree');
  private readonly expanded = new Set<string>();
  /** 읽어 온 폴더의 항목들(이름 겹침 검사·끌어 놓기 계산에 쓴다) */
  private listing: Map<string, readonly TreeEntry[]> = new Map();
  /** 폴더 경로 → 그 폴더 안 항목이 들어가는 칸 */
  private containers = new Map<string, HTMLElement>();
  private active: string | null = null;
  private picked: TreeTarget | null = null;
  private changes = ChangeMap.empty();
  private repos = new Map<string, RepoRow>();
  private generation = 0;
  private editor: { close: () => void } | null = null;
  private dragging: { path: string; kind: NodeKind } | null = null;

  constructor(private readonly hooks: TreeHooks) {
    this.root.tabIndex = 0;
    this.root.addEventListener('contextmenu', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('.tree-row');
      e.preventDefault();
      if ((e.target as HTMLElement).closest('.repo-line') !== null) return;
      const target = row === null ? this.rootTarget() : this.targetOf(row);
      if (target === null) return;
      this.pick(target);
      this.hooks.contextMenu(target, e.clientX, e.clientY);
    });
    this.root.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).closest('.tree-edit') !== null) return;
      if (this.hooks.key(e, this.picked)) {
        e.preventDefault();
        e.stopPropagation();
      }
    });
    // 빈 곳에 놓으면 작업 폴더로 옮긴다
    this.root.addEventListener('dragover', (e) => this.dragOver(e, ''));
    this.root.addEventListener('drop', (e) => this.dropOn(e, ''));
    this.root.addEventListener('dragleave', (e) => {
      if (!this.root.contains(e.relatedTarget as Node | null)) this.clearDrop();
    });
  }

  // ── 고른 줄 ──
  selection(): TreeTarget | null {
    return this.picked;
  }

  private rootTarget(): TreeTarget {
    return { path: '', kind: 'root', blocked: false, repo: this.repos.get('.') ?? null };
  }

  private targetOf(row: HTMLElement): TreeTarget | null {
    const path = row.dataset['path'];
    const kind = row.dataset['kind'];
    if (path === undefined || (kind !== 'dir' && kind !== 'file')) return null;
    return { path, kind, blocked: row.classList.contains('locked'), repo: this.repos.get(path) ?? null };
  }

  /** 줄을 고른다(파일을 열지는 않는다) */
  pick(target: TreeTarget | null): void {
    this.picked = target;
    this.hooks.onPick?.(target);
    for (const row of this.root.querySelectorAll<HTMLElement>('.tree-row')) row.classList.toggle('picked', target !== null && row.dataset['path'] === target.path);
  }

  /** 폴더 안 이름들(이름 겹침 검사용). 아직 안 읽은 폴더는 빈 목록. */
  namesIn(dir: string): string[] {
    return (this.listing.get(dir) ?? []).map((e) => e.name);
  }

  /** 읽어 둔 모든 폴더(옮기기 대화상자의 후보) */
  knownDirs(): string[] {
    const dirs = new Set<string>();
    for (const entries of this.listing.values()) for (const e of entries) if (e.kind === 'dir' && !e.blocked) dirs.add(e.path);
    return [...dirs];
  }

  kindOf(path: string): NodeKind | null {
    return this.listing.get(parentOf(path))?.find((e) => e.path === path)?.kind ?? null;
  }

  // ── 그리기 ──
  /** 처음부터 다시 그린다. 펼쳐 둔 폴더는 다시 읽어 그대로 펼친다. */
  async refresh(): Promise<void> {
    const gen = ++this.generation;
    const top = el('div', 'tree-children');
    const listing = new Map<string, readonly TreeEntry[]>();
    const containers = new Map<string, HTMLElement>([['', top]]);
    await this.fill(top, '', 0, gen, listing, containers);
    if (gen !== this.generation) return;
    this.listing = listing;
    this.containers = containers;
    this.root.replaceChildren(top);
    if (this.picked !== null) this.pick(this.picked);
  }

  /** git 변경 표시를 바꾼다. 목록을 다시 읽지 않고 보이는 줄에만 입힌다. */
  setChanges(map: ChangeMap): void {
    this.changes = map;
    for (const row of this.root.querySelectorAll<HTMLElement>('.tree-row')) this.decorate(row);
  }

  /** 레포 노드 정보를 바꾼다. 목록을 다시 읽지 않고 보이는 줄에만 입힌다. */
  setRepos(rows: readonly RepoRow[]): void {
    this.repos = new Map(rows.map((r) => [r.relative.replace(/\\/g, '/'), r]));
    for (const row of this.root.querySelectorAll<HTMLElement>('.tree-row')) this.decorateRepo(row);
  }

  private decorate(row: HTMLElement): void {
    const path = row.dataset['path'] ?? '';
    row.querySelector('.tree-badge')?.remove();
    row.querySelector('.tree-name')?.removeAttribute('title');
    for (const c of ['chg-M', 'chg-A', 'chg-D', 'chg-R', 'chg-U', 'chg-!', 'chg-dir']) row.classList.remove(c);
    if (row.dataset['kind'] === 'dir') {
      const mark = folderMark(this.changes, path);
      if (mark === null) return;
      if (mark.badge === null) {
        row.classList.add('chg-dir');
        row.querySelector('.tree-name')?.setAttribute('title', mark.title);
        return;
      }
      row.classList.add(`chg-${mark.badge}`);
      const b = el('span', 'tree-badge', mark.badge);
      b.title = mark.title;
      row.append(b);
      return;
    }
    const raw = this.changes.statusOf(path);
    if (raw === null) return;
    const code = shownCode(raw);
    row.classList.add(`chg-${code}`);
    const badge = el('span', 'tree-badge', code);
    badge.title = changeTitle(raw);
    row.append(badge);
  }

  /** 레포·문서 폴더 줄: 이름만 두고, 바뀐 것이 있으면 이름 색으로, 자세한 상태는 툴팁으로만 알린다 */
  private decorateRepo(row: HTMLElement): void {
    row.classList.remove('repo-node', 'repo-dirty');
    const info = this.repos.get(row.dataset['path'] ?? '');
    if (info === undefined || row.dataset['kind'] !== 'dir') return;
    const mark = repoNodeMark(info);
    row.classList.add('repo-node');
    row.classList.toggle('repo-dirty', mark.dirty);
    row.title = mark.title;
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

  /** 폴더 이름이 바뀌거나 옮겨졌을 때 펼침 상태를 새 경로로 옮긴다 */
  moveExpanded(from: string, to: string): void {
    for (const p of [...this.expanded]) {
      if (p === from || p.startsWith(`${from}/`)) {
        this.expanded.delete(p);
        this.expanded.add(`${to}${p.slice(from.length)}`);
      }
    }
  }

  forgetExpanded(path: string): void {
    for (const p of [...this.expanded]) if (p === path || p.startsWith(`${path}/`)) this.expanded.delete(p);
  }

  /** 폴더를 펼쳐 둔다(새로 만들기 전에) */
  async expand(dir: string): Promise<void> {
    if (dir === '' || this.expanded.has(dir)) return;
    const parts = dir.split('/');
    for (let i = 1; i <= parts.length; i++) this.expanded.add(parts.slice(0, i).join('/'));
    await this.refresh();
  }

  private async fill(container: HTMLElement, dir: string, depth: number, gen: number, listing: Map<string, readonly TreeEntry[]>, containers: Map<string, HTMLElement>): Promise<void> {
    const result = await this.hooks.api.tree(dir);
    if (gen !== this.generation) return;
    if (!result.ok) {
      container.append(el('div', 'tree-note', codeFailText(result.reason)));
      return;
    }
    listing.set(dir, result.entries);
    containers.set(dir, container);
    if (result.entries.length === 0 && depth === 0) container.append(el('div', 'tree-note', '비어 있는 폴더예요.'));
    for (const entry of result.entries) {
      const row = this.row(entry, depth);
      container.append(row.row);
      this.decorateRepo(row.row);
      if (entry.kind === 'dir') {
        container.append(row.children);
        if (this.expanded.has(entry.path) && !entry.blocked) await this.fill(row.children, entry.path, depth + 1, gen, listing, containers);
        if (gen !== this.generation) return;
      }
    }
    if (result.truncated) container.append(el('div', 'tree-note', MORE));
  }

  private row(entry: TreeEntry, depth: number): { row: HTMLElement; children: HTMLElement } {
    const row = el('button', 'tree-row');
    row.type = 'button';
    row.dataset['path'] = entry.path;
    row.dataset['kind'] = entry.kind;
    row.style.paddingLeft = `${8 + depth * 12}px`;
    row.classList.toggle('on', entry.path === this.active);
    row.classList.toggle('picked', this.picked?.path === entry.path);
    row.classList.toggle('heavy', entry.heavy);
    row.classList.toggle('locked', entry.locked || entry.blocked);
    row.draggable = true;
    const children = el('div', 'tree-children');
    const open = entry.kind === 'dir' && this.expanded.has(entry.path) && !entry.blocked;
    row.append(el('span', 'tree-chev', entry.kind === 'dir' ? (open ? '▾' : '▸') : ''), iconByName(entry.name, entry.kind === 'dir', open), el('span', 'tree-name', entry.name));
    if (entry.link) row.append(el('span', 'chip tree-tag', '링크'));
    this.decorate(row);
    row.title = entry.locked ? '비밀 파일이라 열지 않아요(이름 바꾸기·삭제는 할 수 있어요)' : entry.blocked ? '작업 폴더 밖을 가리켜서 열지 않아요' : entry.path;
    row.addEventListener('click', () => {
      this.pick(this.targetOf(row));
      if (entry.locked || entry.blocked) {
        this.hooks.refused?.(entry.name, entry.locked ? 'secret' : 'outside');
        return;
      }
      if (entry.kind === 'file') return this.hooks.open(entry.path);
      void this.toggle(entry, row, children);
    });
    row.addEventListener('dragstart', (e) => {
      this.dragging = { path: entry.path, kind: entry.kind };
      e.dataTransfer?.setData(DRAG_TYPE, entry.path);
      e.dataTransfer?.setData('text/plain', entry.name);
      if (e.dataTransfer !== null) e.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragend', () => {
      this.dragging = null;
      this.clearDrop();
    });
    const dest = entry.kind === 'dir' ? entry.path : parentOf(entry.path);
    row.addEventListener('dragover', (e) => {
      e.stopPropagation();
      this.dragOver(e, dest, row);
    });
    row.addEventListener('drop', (e) => {
      e.stopPropagation();
      this.dropOn(e, dest);
    });
    return { row, children };
  }

  // ── 끌어서 옮기기 ──
  private dragOver(e: DragEvent, destDir: string, row?: HTMLElement): void {
    const src = this.dragging;
    if (src === null) return;
    const plan = planMove({ path: src.path, kind: src.kind, destDir, destNames: this.namesIn(destDir), caseInsensitive: this.hooks.caseInsensitive });
    this.clearDrop();
    if (!plan.ok) {
      if (e.dataTransfer !== null) e.dataTransfer.dropEffect = 'none';
      return;
    }
    e.preventDefault();
    if (e.dataTransfer !== null) e.dataTransfer.dropEffect = 'move';
    (row ?? this.root).classList.add('drop');
  }

  private dropOn(e: DragEvent, destDir: string): void {
    const src = this.dragging;
    this.clearDrop();
    if (src === null) return;
    e.preventDefault();
    this.dragging = null;
    this.hooks.drop(src.path, destDir);
  }

  private clearDrop(): void {
    this.root.classList.remove('drop');
    for (const r of this.root.querySelectorAll('.tree-row.drop')) r.classList.remove('drop');
  }

  private async toggle(entry: TreeEntry, row: HTMLElement, children: HTMLElement): Promise<void> {
    const chev = row.querySelector('.tree-chev');
    if (this.expanded.has(entry.path)) {
      this.expanded.delete(entry.path);
      children.replaceChildren();
      if (chev !== null) chev.textContent = '▸';
      row.querySelector('.fi')?.replaceWith(iconByName(entry.name, true, false));
      return;
    }
    this.expanded.add(entry.path);
    if (chev !== null) chev.textContent = '▾';
    row.querySelector('.fi')?.replaceWith(iconByName(entry.name, true, true));
    const depth = Math.round((Number.parseInt(row.style.paddingLeft, 10) - 8) / 12) + 1;
    await this.fill(children, entry.path, depth, this.generation, this.listing, this.containers);
  }

  // ── 이름 바꾸기·새로 만들기 입력 ──
  /** 그 줄을 이름 입력칸으로 바꾼다. 확장자를 뺀 이름만 골라 두고, 잘못된 이름은 바로 이유를 보인다. Enter로 확정, Esc로 취소. */
  startRename(path: string, onCommit: (name: string) => void): void {
    const row = this.root.querySelector<HTMLElement>(`.tree-row[data-path="${CSS.escape(path)}"]`);
    if (row === null) return;
    const kind = row.dataset['kind'] === 'dir' ? 'dir' : 'file';
    const depth = Math.round((Number.parseInt(row.style.paddingLeft, 10) - 8) / 12);
    const old = nameOf(path);
    row.hidden = true;
    const detail = row.nextElementSibling;
    if (detail?.classList.contains('repo-line')) (detail as HTMLElement).hidden = true;
    this.openEditor({
      anchor: row,
      where: 'after',
      depth,
      kind,
      initial: old,
      selectEnd: kind === 'dir' ? old.length : stemEnd(old),
      siblings: this.namesIn(parentOf(path)),
      self: old,
      onCommit,
      onClose: () => {
        row.hidden = false;
        const line = row.nextElementSibling;
        if (line?.classList.contains('repo-line')) (line as HTMLElement).hidden = false;
      },
    });
  }

  /** 폴더 맨 위에 새 파일·새 폴더 이름 입력칸을 연다 */
  async startCreate(parentDir: string, kind: NodeKind, onCommit: (name: string) => void): Promise<void> {
    await this.expand(parentDir);
    const box = this.containers.get(parentDir);
    if (box === undefined) return;
    const depth = parentDir === '' ? 0 : parentDir.split('/').length;
    this.openEditor({ anchor: box, where: 'top', depth, kind, initial: '', selectEnd: 0, siblings: this.namesIn(parentDir), onCommit, onClose: () => undefined });
  }

  private openEditor(o: { anchor: HTMLElement; where: 'after' | 'top'; depth: number; kind: NodeKind; initial: string; selectEnd: number; siblings: string[]; self?: string; onCommit: (name: string) => void; onClose: () => void }): void {
    this.editor?.close();
    const wrap = el('div', 'tree-edit');
    wrap.style.paddingLeft = `${8 + o.depth * 12}px`;
    const input = el('input', 'sm');
    input.value = o.initial;
    input.spellcheck = false;
    input.setAttribute('aria-label', o.kind === 'dir' ? '폴더 이름' : '파일 이름');
    const msg = el('div', 'tree-edit-msg err');
    wrap.append(el('span', 'tree-chev', ''), iconByName(o.initial === '' ? (o.kind === 'dir' ? 'folder' : 'file.txt') : o.initial, o.kind === 'dir', false), input);
    const box = el('div', 'tree-edit-box');
    box.append(wrap, msg);
    let closed = false;
    const close = (): void => {
      if (closed) return;
      closed = true;
      box.remove();
      if (this.editor?.close === close) this.editor = null;
      o.onClose();
    };
    this.editor = { close };
    const check = (): boolean => {
      if (input.value === '' && o.self === undefined) {
        msg.textContent = '';
        return false;
      }
      const r = checkName(input.value, { siblings: o.siblings, ...(o.self === undefined ? {} : { self: o.self }), caseInsensitive: this.hooks.caseInsensitive });
      msg.textContent = r.ok ? '' : r.text;
      input.classList.toggle('bad', !r.ok);
      return r.ok;
    };
    input.addEventListener('input', () => void check());
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      } else if (isEnterKey(e)) {
        e.preventDefault();
        if (!check()) return;
        const name = input.value;
        close();
        o.onCommit(name);
      }
    });
    input.addEventListener('blur', () => window.setTimeout(close, 120));
    if (o.where === 'after') o.anchor.after(box);
    else o.anchor.prepend(box);
    input.focus();
    input.setSelectionRange(0, o.selectEnd);
    box.scrollIntoView({ block: 'nearest' });
  }

  /** 열려 있는 입력칸을 닫는다 */
  cancelEdit(): void {
    this.editor?.close();
  }

  /** 새로 만든 파일·폴더, 바뀐 이름을 찾아 고르고 보이게 한다 */
  focusPath(path: string): void {
    const row = this.root.querySelector<HTMLElement>(`.tree-row[data-path="${CSS.escape(path)}"]`);
    if (row === null) return;
    this.pick(this.targetOf(row));
    row.scrollIntoView({ block: 'nearest' });
  }
}
