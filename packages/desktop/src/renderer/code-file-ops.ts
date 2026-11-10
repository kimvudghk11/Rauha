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

  const nameFor = (path: string): string => (path === '' ? '작업 폴더' : nameOf(path));
  /** 이름 바꾸기·삭제·옮기기를 처음부터 막는 대상(main이 한 번 더 막는다) */
  const lockedLocal = (t: TreeTarget): string | null => {
    if (t.kind === 'root') return '작업 폴더 자체는 바꾸거나 지울 수 없어요.';
    if (t.repo !== null) return '레포·문서 폴더 자체는 바꾸거나 지울 수 없어요. 안의 파일은 조작할 수 있어요.';
    if (inProtectedZone(t.path)) return 'node_modules 같은 생성물 안은 조작하지 않아요.';
    return null;
  };

  /** 팀이 일하는 레포의 파일이면 한 번 알린다. 계속하면 true. */
  async function guardWorking(path: string): Promise<boolean> {
    const repo = workingRepoFor(path, host.repos());
    if (repo === null || warned.has(repo.relative)) return true;
    const answer = await ask('작업 중인 레포예요', `@${repo.name}에서 팀이 지금 일하고 있어요. 여기서 파일을 바꾸면 팀 작업과 충돌할 수 있어요.`, [
      { id: 'go', label: '그래도 계속', kind: 'primary' },
      { id: 'cancel', label: '취소' },
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
        if (!r.ok) return fail(r, kind === 'dir' ? '폴더를 만들지 못했어요' : '파일을 만들지 못했어요');
        await done(r.path, kind === 'file' ? () => host.open(r.path) : undefined);
      })();
    });
  }

  async function rename(target: TreeTarget | null = host.tree.selection()): Promise<void> {
    if (target === null) return host.say('이름을 바꿀 파일이나 폴더를 먼저 골라 주세요.');
    const why = lockedLocal(target);
    if (why !== null) return host.say(why);
    if (!(await guardWorking(target.path))) return;
    host.tree.startRename(target.path, (name) => {
      void (async () => {
        const r = await host.api.rename({ path: target.path, name });
        if (!r.ok) return fail(r, `‘${nameOf(target.path)}’ 이름을 바꾸지 못했어요`);
        host.tabsMoved(target.path, r.path);
        if (r.kind === 'dir') host.tree.moveExpanded(target.path, r.path);
        await done(r.path);
      })();
    });
  }

  async function duplicate(target: TreeTarget | null = host.tree.selection(), destDir?: string): Promise<void> {
    if (target === null || target.kind === 'root') return host.say('복제할 파일이나 폴더를 먼저 골라 주세요.');
    if (!(await guardWorking(destDir ?? parentOf(target.path)))) return;
    const r = await host.api.duplicate({ path: target.path, ...(destDir === undefined ? {} : { destDir }) });
    if (!r.ok) return fail(r, `‘${nameOf(target.path)}’을(를) 복제하지 못했어요`);
    host.say(`복제했어요: ${r.path}`);
    await done(r.path);
  }

  async function move(path: string, destDir?: string): Promise<void> {
    const kind = host.tree.kindOf(path);
    if (kind === null) return host.say('옮길 파일이나 폴더를 찾지 못했어요. 목록을 새로 고쳐 주세요.');
    const target: TreeTarget = { path, kind, blocked: false, repo: host.repos().find((r) => r.relative.replace(/\\/g, '/') === path) ?? null };
    const why = lockedLocal(target);
    if (why !== null) return host.say(why);
    const dest = destDir ?? (await chooseFolder(nameOf(path), path, kind, host.tree.knownDirs()));
    if (dest === null) return;
    if (!(await guardWorking(path)) || !(await guardWorking(dest))) return;
    const r = await host.api.move({ path, destDir: dest });
    if (!r.ok) return fail(r, `‘${nameOf(path)}’을(를) 옮기지 못했어요`);
    host.tabsMoved(path, r.path);
    if (r.kind === 'dir') host.tree.moveExpanded(path, r.path);
    host.say(`옮겼어요: ${r.path}`);
    await done(r.path);
  }

  /** 삭제 = 휴지통. 확인 창에 폴더 안 파일 수와 수정 중인 탭을 알린다. */
  async function remove(target: TreeTarget | null = host.tree.selection()): Promise<void> {
    if (target === null) return host.say('지울 파일이나 폴더를 먼저 골라 주세요.');
    const why = lockedLocal(target);
    if (why !== null) return host.say(why);
    const info = await host.api.inspect({ path: target.path });
    if (!info.ok) return host.say(`지울 수 없어요: ${codeFailText(info.reason)}`);
    if (info.locked) return host.say('이 항목은 바꾸거나 지울 수 없어요.');
    if (!(await guardWorking(target.path))) return;
    const name = nameOf(target.path);
    const impact = deleteImpact(host.openPaths(), host.dirtyPaths(), target.path);
    const notes: string[] = ['영구 삭제가 아니라 휴지통으로 가요. 휴지통에서 되돌릴 수 있어요.'];
    if (info.link) notes.push('바로가기(링크)만 지워지고, 가리키는 파일은 그대로예요.');
    if (impact.closing.length > 0) notes.push(`열려 있는 탭 ${impact.closing.length}개는 닫혀요.`);
    if (impact.unsaved.length > 0) notes.push(`저장하지 않은 수정이 있는 탭: ${impact.unsaved.map(nameOf).join(', ')}. 지우면 그 수정은 사라져요(탭을 남기면 "삭제됨"으로 남아 다시 저장할 수 있어요).`);
    const body = info.kind === 'dir' ? `‘${name}’ 폴더를 휴지통으로 보낼까요? 안의 파일 ${info.capped ? `${info.files.toLocaleString('ko-KR')}개 이상` : `${info.files}개`}가 함께 가요.` : `‘${name}’을(를) 휴지통으로 보낼까요?`;
    const answer = await ask(`${name} 삭제`, body, [
      { id: 'trash', label: '휴지통으로 보내기', kind: 'danger' },
      ...(impact.unsaved.length > 0 ? [{ id: 'keep', label: '보내고 수정 중인 탭은 남기기', kind: 'danger' as const }] : []),
      { id: 'cancel', label: '취소' },
    ], notes);
    if (answer !== 'trash' && answer !== 'keep') return;
    const r = await host.api.trash({ path: target.path });
    if (!r.ok) return fail(r, `‘${name}’을(를) 지우지 못했어요`);
    host.tabsDeleted(target.path, answer === 'keep');
    if (info.kind === 'dir') host.tree.forgetExpanded(target.path);
    host.tree.pick(null);
    host.say(`휴지통으로 보냈어요: ${target.path}`);
    await host.refresh();
  }

  async function copyToClipboard(text: string, what: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      host.say(`${what}을 복사했어요.`);
    } catch {
      host.say('클립보드에 복사하지 못했어요.');
    }
  }

  function copyPath(target: TreeTarget | null, absolute: boolean): Promise<void> {
    const rel = target?.path ?? '';
    if (!absolute) return copyToClipboard(rel === '' ? '.' : rel, '상대 경로');
    const root = host.workFolder();
    if (root === null) {
      host.say(codeFailText('no-folder'));
      return Promise.resolve();
    }
    return copyToClipboard(absolutePath(root, rel, host.platform === 'win32' ? '\\' : '/'), '절대 경로');
  }

  async function reveal(target: TreeTarget | null): Promise<void> {
    const r = await host.api.reveal({ path: target?.path ?? '' });
    if (!r.ok) host.say('파일 관리자에서 열지 못했어요.');
  }

  function copy(target: TreeTarget | null = host.tree.selection()): void {
    if (target === null || target.kind === 'root') return host.say('복사할 파일이나 폴더를 먼저 골라 주세요.');
    clipboard = { path: target.path, kind: target.kind };
    host.say(`복사했어요: ${nameOf(target.path)} — 붙여넣을 폴더를 골라 Ctrl/Cmd+V`);
  }

  async function paste(target: TreeTarget | null = host.tree.selection()): Promise<void> {
    if (clipboard === null) return host.say('복사해 둔 파일이 없어요.');
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
      { label: '새 파일', run: () => void create('file', target) },
      { label: '새 폴더', run: () => void create('dir', target) },
      'sep',
      { label: '이름 바꾸기', hint: 'F2', disabled: why !== null, ...(why === null ? {} : { why }), run: () => void rename(target) },
      { label: '복제', disabled: isRoot, run: () => void duplicate(target) },
      { label: '복사', hint: `${mod}C`, disabled: isRoot, run: () => copy(target) },
      { label: '붙여넣기', hint: `${mod}V`, disabled: clipboard === null, run: () => void paste(target) },
      { label: '다른 폴더로 옮기기…', disabled: why !== null, ...(why === null ? {} : { why }), run: () => void move(target.path) },
      'sep',
      { label: '경로 복사', run: () => void copyPath(target, true) },
      { label: '상대 경로 복사', run: () => void copyPath(target, false) },
      { label: host.platform === 'darwin' ? 'Finder에서 보기' : host.platform === 'win32' ? '탐색기에서 보기' : '파일 관리자에서 보기', run: () => void reveal(target) },
    ];
    if (target.repo !== null && target.repo.kind === 'repo') entries.push('sep', { label: 'Git 탭에서 보기', run: () => host.openGit(target.repo!.root) }, { label: '레포 다시 읽기', run: () => host.reloadRepos() });
    entries.push('sep', { label: '휴지통으로 보내기', hint: 'Del', danger: true, disabled: why !== null, ...(why === null ? {} : { why }), run: () => void remove(target) });
    openMenu(entries, x, y);
  }

  return { create, rename, duplicate, move, remove, copy, paste, copyPath, reveal, key, menuFor, caseInsensitive, nameFor, hasClipboard: (): boolean => clipboard !== null };
}

export type FileOpsController = ReturnType<typeof createFileOps>;
