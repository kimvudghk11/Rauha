import { codeFailText, type CodeApi, type NodeKind, type OpResult } from '../shared/code-api.js';
import { absolutePath, deleteImpact, inProtectedZone, nameOf, parentOf, workingRepoFor } from '../shared/code-ops.js';
import type { RepoRow } from '../shared/ipc.js';
import { ask, chooseFolder } from './code-dialog.js';
import { openMenu, type MenuEntry } from './code-menu.js';
import type { CodeTreeView, TreeTarget } from './code-tree-view.js';

export interface FileOpsHost {
  readonly api: CodeApi;
  readonly tree: CodeTreeView;
  readonly platform: string;
  /** 지금 작업 폴더의 절대 경로(경로 복사용) */
  readonly workFolder: () => string | null;
  /** 마지막으로 읽은 레포 정보(작업 중 경고용) */
  readonly repos: () => readonly RepoRow[];
  readonly openPaths: () => string[];
  readonly dirtyPaths: () => string[];
  /** 열린 탭이 새 경로로 이어진다 */
  readonly tabsMoved: (from: string, to: string) => void;
  /** 지워진 경로 안의 탭: 닫거나(keepUnsaved=false) 수정 중인 것만 "삭제됨"으로 남긴다 */
  readonly tabsDeleted: (path: string, keepUnsaved: boolean) => void;
  readonly say: (text: string) => void;
  /** 목록·git 표시·빠른 열기 목록을 새로 읽는다 */
  readonly refresh: () => Promise<void>;
  readonly open: (path: string) => void;
  readonly openGit: (repoRoot: string) => void;
  readonly reloadRepos: () => void;
}

const isMac = (platform: string): boolean => platform === 'darwin';

/** 실패한 조작을 사용자에게 보일 한 문장으로 */
export function opFailText(r: Extract<OpResult, { ok: false }>): string {
  if (r.reason === 'bad-name' && r.detail !== undefined) return r.detail;
  const detail = r.detail === undefined || r.reason === 'bad-name' ? '' : ` (${r.detail})`;
  return `${codeFailText(r.reason)}${detail}`;
}

/**
 * 탐색기의 파일 조작을 화면 쪽에서 이끈다: 입력·확인 창·열린 탭 이어 주기. 실제 파일 조작과 안전 검사는 전부 main(api)이 한다.
 * 삭제는 휴지통으로 가고 영구 삭제하지 않는다. 팀이 일하는 레포의 파일을 바꿀 때는 한 번 경고한다.
 */
export function createFileOps(host: FileOpsHost) {
  const warned = new Set<string>();
  let clipboard: { path: string; kind: NodeKind } | null = null;
  const caseInsensitive = host.platform === 'win32' || host.platform === 'darwin';

  const nameFor = (path: string): string => (path === '' ? 'Work folder' : nameOf(path));
  /** 이름 바꾸기·삭제·옮기기를 처음부터 막는 대상(main이 한 번 더 막는다) */
  const lockedLocal = (t: TreeTarget): string | null => {
    if (t.kind === 'root') return 'The work folder itself cannot be renamed or deleted.';
    if (t.repo !== null) return 'A repo or docs folder itself cannot be renamed or deleted. Files inside can be changed.';
    if (inProtectedZone(t.path)) return 'Generated folders such as node_modules are left alone.';
    return null;
  };

  /** 팀이 일하는 레포의 파일이면 한 번 알린다. 계속하면 true. */
  async function guardWorking(path: string): Promise<boolean> {
    const repo = workingRepoFor(path, host.repos());
    if (repo === null || warned.has(repo.relative)) return true;
    const answer = await ask('Repo in use', `The team is working in @${repo.name}. Changing files here may conflict with its work.`, [
      { id: 'go', label: 'Continue anyway', kind: 'primary' },
      { id: 'cancel', label: 'Cancel' },
    ]);
    if (answer !== 'go') return false;
    warned.add(repo.relative);
    return true;
  }

  async function done(path: string, then?: () => void): Promise<void> {
    await host.refresh();
    host.tree.focusPath(path);
    then?.();
  }

  function fail(r: Extract<OpResult, { ok: false }>, what: string): void {
    host.say(`${what}: ${opFailText(r)}`);
  }

  /** 선택에서 새로 만들 폴더를 정한다: 폴더면 그 안, 파일이면 같은 폴더, 없으면 작업 폴더 */
  function baseDir(t: TreeTarget | null): string {
    if (t === null || t.kind === 'root') return '';
    return t.kind === 'dir' ? t.path : parentOf(t.path);
  }

  async function create(kind: NodeKind, target: TreeTarget | null = host.tree.selection()): Promise<void> {
    const dir = baseDir(target);
    if (!(await guardWorking(dir))) return;
    await host.tree.startCreate(dir, kind, (name) => {
      void (async () => {
        const r = await host.api.create({ parent: dir, name, kind });
        if (!r.ok) return fail(r, kind === 'dir' ? 'Could not create the folder' : 'Could not create the file');
        await done(r.path, kind === 'file' ? () => host.open(r.path) : undefined);
      })();
    });
  }

  async function rename(target: TreeTarget | null = host.tree.selection()): Promise<void> {
    if (target === null) return host.say('Pick a file or folder to rename first.');
    const why = lockedLocal(target);
    if (why !== null) return host.say(why);
    if (!(await guardWorking(target.path))) return;
    host.tree.startRename(target.path, (name) => {
      void (async () => {
        const r = await host.api.rename({ path: target.path, name });
        if (!r.ok) return fail(r, `Could not rename "${nameOf(target.path)}"`);
        host.tabsMoved(target.path, r.path);
        if (r.kind === 'dir') host.tree.moveExpanded(target.path, r.path);
        await done(r.path);
      })();
    });
  }

  async function duplicate(target: TreeTarget | null = host.tree.selection(), destDir?: string): Promise<void> {
    if (target === null || target.kind === 'root') return host.say('Pick a file or folder to duplicate first.');
    if (!(await guardWorking(destDir ?? parentOf(target.path)))) return;
    const r = await host.api.duplicate({ path: target.path, ...(destDir === undefined ? {} : { destDir }) });
    if (!r.ok) return fail(r, `Could not duplicate "${nameOf(target.path)}"`);
    host.say(`Duplicated: ${r.path}`);
    await done(r.path);
  }

  async function move(path: string, destDir?: string): Promise<void> {
    const kind = host.tree.kindOf(path);
    if (kind === null) return host.say('The file or folder to move was not found. Refresh the list.');
    const target: TreeTarget = { path, kind, blocked: false, repo: host.repos().find((r) => r.relative.replace(/\\/g, '/') === path) ?? null };
    const why = lockedLocal(target);
    if (why !== null) return host.say(why);
    const dest = destDir ?? (await chooseFolder(nameOf(path), path, kind, host.tree.knownDirs()));
    if (dest === null) return;
    if (!(await guardWorking(path)) || !(await guardWorking(dest))) return;
    const r = await host.api.move({ path, destDir: dest });
    if (!r.ok) return fail(r, `Could not move "${nameOf(path)}"`);
    host.tabsMoved(path, r.path);
    if (r.kind === 'dir') host.tree.moveExpanded(path, r.path);
    host.say(`Moved: ${r.path}`);
    await done(r.path);
  }

  /** 삭제 = 휴지통. 확인 창에 폴더 안 파일 수와 수정 중인 탭을 알린다. */
  async function remove(target: TreeTarget | null = host.tree.selection()): Promise<void> {
    if (target === null) return host.say('Pick a file or folder to delete first.');
    const why = lockedLocal(target);
    if (why !== null) return host.say(why);
    const info = await host.api.inspect({ path: target.path });
    if (!info.ok) return host.say(`Cannot delete: ${codeFailText(info.reason)}`);
    if (info.locked) return host.say('This item cannot be changed or deleted.');
    if (!(await guardWorking(target.path))) return;
    const name = nameOf(target.path);
    const impact = deleteImpact(host.openPaths(), host.dirtyPaths(), target.path);
    const notes: string[] = ['It goes to the trash, not deleted for good. You can restore it from the trash.'];
    if (info.link) notes.push('Only the link is removed. The file it points to stays.');
    if (impact.closing.length > 0) notes.push(`${impact.closing.length} open tab(s) will close.`);
    if (impact.unsaved.length > 0) notes.push(`Tabs with unsaved changes: ${impact.unsaved.map(nameOf).join(', ')}. Deleting loses those changes (or keep the tab and save it again).`);
    const body = info.kind === 'dir' ? `Move folder "${name}" to the trash? ${info.capped ? `${info.files.toLocaleString('en-US')}+` : `${info.files}`} file(s) inside go with it.` : `Move "${name}" to the trash?`;
    const answer = await ask(`Delete ${name}`, body, [
      { id: 'trash', label: 'Move to trash', kind: 'danger' },
      ...(impact.unsaved.length > 0 ? [{ id: 'keep', label: 'Move to trash, keep edited tab', kind: 'danger' as const }] : []),
      { id: 'cancel', label: 'Cancel' },
    ], notes);
    if (answer !== 'trash' && answer !== 'keep') return;
    const r = await host.api.trash({ path: target.path });
    if (!r.ok) return fail(r, `Could not delete "${name}"`);
    host.tabsDeleted(target.path, answer === 'keep');
    if (info.kind === 'dir') host.tree.forgetExpanded(target.path);
    host.tree.pick(null);
    host.say(`Moved to trash: ${target.path}`);
    await host.refresh();
  }

  async function copyToClipboard(text: string, what: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      host.say(`Copied ${what}.`);
    } catch {
      host.say('Could not copy to the clipboard.');
    }
  }

  function copyPath(target: TreeTarget | null, absolute: boolean): Promise<void> {
    const rel = target?.path ?? '';
    if (!absolute) return copyToClipboard(rel === '' ? '.' : rel, 'the relative path');
    const root = host.workFolder();
    if (root === null) {
      host.say(codeFailText('no-folder'));
      return Promise.resolve();
    }
    return copyToClipboard(absolutePath(root, rel, host.platform === 'win32' ? '\\' : '/'), 'the absolute path');
  }

  async function reveal(target: TreeTarget | null): Promise<void> {
    const r = await host.api.reveal({ path: target?.path ?? '' });
    if (!r.ok) host.say('Could not open the file manager.');
  }

  function copy(target: TreeTarget | null = host.tree.selection()): void {
    if (target === null || target.kind === 'root') return host.say('Pick a file or folder to copy first.');
    clipboard = { path: target.path, kind: target.kind };
    host.say(`Copied: ${nameOf(target.path)} - pick a folder and press Ctrl/Cmd+V`);
  }

  async function paste(target: TreeTarget | null = host.tree.selection()): Promise<void> {
    if (clipboard === null) return host.say('Nothing copied to paste.');
    const src = clipboard;
    await duplicate({ path: src.path, kind: src.kind, blocked: false, repo: null }, baseDir(target));
  }

  /** 키보드: F2 이름 바꾸기, Delete 삭제, Ctrl/Cmd+C·V 복사·붙여넣기. 처리했으면 true. */
  function key(e: KeyboardEvent, target: TreeTarget | null): boolean {
    const mod = isMac(host.platform) ? e.metaKey : e.ctrlKey;
    if (e.key === 'F2' && !mod && !e.altKey) {
      void rename(target);
      return true;
    }
    if ((e.key === 'Delete' || (isMac(host.platform) && e.metaKey && e.key === 'Backspace')) && !e.altKey && !e.shiftKey) {
      void remove(target);
      return true;
    }
    if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'c') {
      copy(target);
      return true;
    }
    if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'v') {
      void paste(target);
      return true;
    }
    return false;
  }

  /** 오른쪽 클릭 메뉴 */
  function menuFor(target: TreeTarget, x: number, y: number): void {
    const mod = isMac(host.platform) ? '⌘' : 'Ctrl+';
    const why = lockedLocal(target);
    const isRoot = target.kind === 'root';
    const entries: MenuEntry[] = [
      { label: 'New file', run: () => void create('file', target) },
      { label: 'New folder', run: () => void create('dir', target) },
      'sep',
      { label: 'Rename', hint: 'F2', disabled: why !== null, ...(why === null ? {} : { why }), run: () => void rename(target) },
      { label: 'Duplicate', disabled: isRoot, run: () => void duplicate(target) },
      { label: 'Copy', hint: `${mod}C`, disabled: isRoot, run: () => copy(target) },
      { label: 'Paste', hint: `${mod}V`, disabled: clipboard === null, run: () => void paste(target) },
      { label: 'Move to another folder…', disabled: why !== null, ...(why === null ? {} : { why }), run: () => void move(target.path) },
      'sep',
      { label: 'Copy path', run: () => void copyPath(target, true) },
      { label: 'Copy relative path', run: () => void copyPath(target, false) },
      { label: host.platform === 'darwin' ? 'Reveal in Finder' : host.platform === 'win32' ? 'Show in Explorer' : 'Show in file manager', run: () => void reveal(target) },
    ];
    if (target.repo !== null && target.repo.kind === 'repo') entries.push('sep', { label: 'Show in Git tab', run: () => host.openGit(target.repo!.root) }, { label: 'Reload repos', run: () => host.reloadRepos() });
    entries.push('sep', { label: 'Move to trash', hint: 'Del', danger: true, disabled: why !== null, ...(why === null ? {} : { why }), run: () => void remove(target) });
    openMenu(entries, x, y);
  }

  return { create, rename, duplicate, move, remove, copy, paste, copyPath, reveal, key, menuFor, caseInsensitive, nameFor, hasClipboard: (): boolean => clipboard !== null };
}

export type FileOpsController = ReturnType<typeof createFileOps>;
