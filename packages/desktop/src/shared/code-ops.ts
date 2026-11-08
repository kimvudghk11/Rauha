// 코드 탭 파일 조작(새로 만들기·이름 바꾸기·복제·옮기기·삭제)의 순수 규칙. 파일 시스템을 만지지 않는다.
// main(실제 조작)과 화면(입력 즉시 검사)이 같은 규칙을 쓰도록 shared에 둔다.

export type NameProblem = 'empty' | 'too-long' | 'bad-char' | 'dots' | 'reserved' | 'trailing' | 'git' | 'exists' | 'same';

export type NameCheck = { readonly ok: true; readonly name: string } | { readonly ok: false; readonly problem: NameProblem; readonly text: string };

export interface NameContext {
  /** 같은 폴더에 있는 이름들 */
  readonly siblings: readonly string[];
  /** 이름을 바꾸는 중이면 지금 이름(자기 자신과 겹친다고 보지 않는다) */
  readonly self?: string;
  /** Windows·macOS는 대소문자를 구분하지 않는다 */
  readonly caseInsensitive: boolean;
}

/** 이름 하나의 최대 바이트(대부분의 파일 시스템 한도) */
export const MAX_NAME_BYTES = 255;
/** 작업 폴더 기준 경로 길이 상한(절대 경로까지 합쳐도 Windows 한도 안에 들도록) */
export const MAX_REL_PATH = 240;

const BAD_CHARS = /[\\/:*?"<>|\u0000-\u001f]/;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

const fold = (s: string, ci: boolean): string => (ci ? s.toLowerCase() : s);

/** 화면에서 친 이름이 쓸 수 있는 이름인지. 안 되면 이유를 한 문장으로 돌려준다. */
export function checkName(input: string, ctx: NameContext): NameCheck {
  const fail = (problem: NameProblem, text: string): NameCheck => ({ ok: false, problem, text });
  if (input === '') return fail('empty', '이름을 입력해 주세요.');
  if (input === '.' || input === '..') return fail('dots', '"." 와 ".." 는 이름으로 쓸 수 없어요.');
  const bad = input.match(BAD_CHARS);
  if (bad !== null) return fail('bad-char', bad[0] <= '\u001f' ? '제어 문자는 이름에 쓸 수 없어요.' : `이름에 ${bad[0]} 는 쓸 수 없어요.`);
  if (input !== input.trim() || input.endsWith('.')) return fail('trailing', '이름 앞뒤에 빈칸이나 끝에 점을 둘 수 없어요.');
  if (input.toLowerCase() === '.git') return fail('git', '.git 은 git이 쓰는 이름이라 쓸 수 없어요.');
  if (RESERVED.test(input)) return fail('reserved', `${input.split('.')[0]} 는 Windows 예약 이름이라 쓸 수 없어요.`);
  if (new TextEncoder().encode(input).length > MAX_NAME_BYTES) return fail('too-long', `이름이 너무 길어요(${MAX_NAME_BYTES}바이트까지).`);
  if (ctx.self !== undefined && input === ctx.self) return fail('same', '지금 이름과 같아요.');
  const key = fold(input, ctx.caseInsensitive);
  const selfKey = ctx.self === undefined ? null : fold(ctx.self, ctx.caseInsensitive);
  // 이름 바꾸기에서 대소문자만 바꾸는 것은 자기 자신과 겹치는 게 아니다
  if (ctx.siblings.some((s) => fold(s, ctx.caseInsensitive) === key && !(selfKey !== null && key === selfKey))) return fail('exists', '같은 이름이 이미 있어요.');
  return { ok: true, name: input };
}

/** 이름 바꾸기 입력에서 처음에 골라 둘 범위의 끝(확장자 앞). ".env"처럼 점으로 시작하면 전체. */
export function stemEnd(name: string): number {
  const dot = name.lastIndexOf('.');
  return dot <= 0 || dot === name.length - 1 ? name.length : dot;
}

/** 복제 이름: "이름 복사본.확장자", 있으면 "이름 복사본 2.확장자"… */
export function copyName(name: string, taken: readonly string[], caseInsensitive: boolean): string {
  const end = stemEnd(name);
  const stem = name.slice(0, end);
  const ext = name.slice(end);
  const used = new Set(taken.map((t) => fold(t, caseInsensitive)));
  for (let n = 1; ; n++) {
    const candidate = `${stem} 복사본${n === 1 ? '' : ` ${n}`}${ext}`;
    if (!used.has(fold(candidate, caseInsensitive))) return candidate;
  }
}

export const joinPath = (dir: string, name: string): string => (dir === '' ? name : `${dir}/${name}`);

export const parentOf = (path: string): string => {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
};

export const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/** path가 base 자신이거나 그 안인지 (슬래시로 나눈 조각 단위) */
export const isSameOrUnder = (path: string, base: string): boolean => base === '' || path === base || path.startsWith(`${base}/`);

export const tooLongPath = (rel: string): boolean => rel.length > MAX_REL_PATH;

/** node_modules·.git 안(또는 그 자체)은 조작하지 않는다 */
export function inProtectedZone(path: string): boolean {
  return path.split('/').some((p) => ['node_modules', '.git'].includes(p.toLowerCase()));
}

/** 작업 폴더의 절대 경로와 상대 경로를 그 PC의 구분자로 합친다(복사용) */
export function absolutePath(root: string, rel: string, sep: '/' | '\\'): string {
  const base = root.replace(/[\\/]+$/, '');
  return rel === '' ? base : `${base}${sep}${rel.split('/').join(sep)}`;
}

export type MoveRefusal = 'same-folder' | 'into-self' | 'exists' | 'protected';

export type MovePlan = { readonly ok: true; readonly target: string } | { readonly ok: false; readonly reason: MoveRefusal; readonly text: string };

const MOVE_TEXT: Readonly<Record<MoveRefusal, string>> = {
  'same-folder': '이미 그 폴더에 있어요.',
  'into-self': '폴더를 자기 자신 안으로는 옮길 수 없어요.',
  exists: '그 폴더에 같은 이름이 이미 있어서 옮기지 않아요(덮어쓰지 않아요).',
  protected: 'node_modules 같은 조작 금지 구역으로는 옮길 수 없어요.',
};

/** 옮기면 어디에 놓이는지. 안 되는 까닭이 있으면 거절한다. */
export function planMove(input: { path: string; kind: 'file' | 'dir'; destDir: string; destNames: readonly string[]; caseInsensitive: boolean }): MovePlan {
  const refuse = (reason: MoveRefusal): MovePlan => ({ ok: false, reason, text: MOVE_TEXT[reason] });
  const { path, kind, destDir } = input;
  if (kind === 'dir' && isSameOrUnder(destDir, path)) return refuse('into-self');
  if (inProtectedZone(destDir)) return refuse('protected');
  if (parentOf(path) === destDir) return refuse('same-folder');
  const name = nameOf(path);
  const key = fold(name, input.caseInsensitive);
  if (input.destNames.some((n) => fold(n, input.caseInsensitive) === key)) return refuse('exists');
  return { ok: true, target: joinPath(destDir, name) };
}

/** "이동" 대화상자에 보일 폴더들: 작업 폴더 루트('')와 알려진 폴더 중 갈 수 있는 곳만 */
export function moveChoices(path: string, kind: 'file' | 'dir', dirs: readonly string[]): string[] {
  const all = new Set<string>(['', ...dirs]);
  const parent = parentOf(path);
  return [...all]
    .filter((d) => d !== parent && !inProtectedZone(d) && !(kind === 'dir' && isSameOrUnder(d, path)))
    .sort((a, b) => a.localeCompare(b));
}

/** 이름·위치가 바뀐 뒤의 경로. 이 경로가 from 자신이거나 그 안이 아니면 null. */
export function movedPath(path: string, from: string, to: string): string | null {
  if (path === from) return to;
  return path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : null;
}

/** 열려 있는 탭 중 이름 바꾸기·옮기기로 새 경로가 되는 것들 */
export function remapOpen(openPaths: readonly string[], from: string, to: string): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  for (const p of openPaths) {
    const next = movedPath(p, from, to);
    if (next !== null) out.push({ from: p, to: next });
  }
  return out;
}

/** 삭제하면 닫아야 할 탭과, 그중 저장 안 한 수정이 있는 탭 */
export function deleteImpact(openPaths: readonly string[], dirtyPaths: readonly string[], path: string): { closing: string[]; unsaved: string[] } {
  const closing = openPaths.filter((p) => isSameOrUnder(p, path));
  return { closing, unsaved: closing.filter((p) => dirtyPaths.includes(p)) };
}

export interface RepoWork {
  readonly name: string;
  /** 작업 폴더 기준 경로('.' = 작업 폴더 자신) */
  readonly relative: string;
  readonly working: number;
  readonly worktrees: number;
}

/** 이 경로가 팀이 지금 일하는 레포 안이면 그 레포(가장 깊은 레포 기준) */
export function workingRepoFor<T extends RepoWork>(path: string, repos: readonly T[]): T | null {
  let best: T | null = null;
  for (const r of repos) {
    const base = r.relative === '.' ? '' : r.relative.split('\\').join('/');
    if (!isSameOrUnder(path, base)) continue;
    if (best === null || base.length > (best.relative === '.' ? 0 : best.relative.length)) best = r;
  }
  return best !== null && (best.working > 0 || best.worktrees > 0) ? best : null;
}
