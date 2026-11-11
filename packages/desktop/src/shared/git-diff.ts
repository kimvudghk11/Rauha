export type LineKind = 'ctx' | 'add' | 'del';

export interface DiffLine {
  readonly kind: LineKind;
  /** 줄끝 \r은 빼고 담는다(패치를 만들 때만 다시 쓴다) */
  readonly text: string;
  readonly oldNo: number | null;
  readonly newNo: number | null;
  /** 줄끝이 CRLF였는지 */
  readonly cr: boolean;
  /** 이 줄 바로 뒤의 "\ No newline at end of file" 표시 */
  readonly noEol: boolean;
}

export interface Hunk {
  readonly header: string;
  readonly oldStart: number;
  readonly newStart: number;
  readonly section: string;
  readonly lines: readonly DiffLine[];
}

/** 어떤 것을 고를지: hunk 번호들, 또는 hunk 번호 → 줄 번호(그 hunk 안의 위치)들 */
export interface Selection {
  readonly hunks?: readonly number[];
  readonly lines?: Readonly<Record<number, readonly number[]>>;
}

export type PatchMode = 'stage' | 'unstage';

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

interface MutableHunk {
  header: string;
  oldStart: number;
  newStart: number;
  section: string;
  lines: DiffLine[];
}

/** `git diff`가 만든 파일 하나의 diff. hunk·줄을 읽고, 고른 것만 담은 `git apply`용 패치를 만든다. */
export class FileDiff {
  private constructor(
    private readonly head: readonly string[],
    readonly hunks: readonly Hunk[],
    private readonly binary: boolean,
  ) {}

  static parse(text: string): FileDiff {
    const raw = text.split('\n');
    if (raw[raw.length - 1] === '') raw.pop();
    const head: string[] = [];
    const hunks: MutableHunk[] = [];
    let binary = false;
    let cur: MutableHunk | null = null;
    let o = 0;
    let n = 0;
    for (const line of raw) {
      const m = line.startsWith('@@') ? HUNK.exec(line.replace(/\r$/, '')) : null;
      if (m !== null) {
        cur = { header: line, oldStart: Number(m[1]), newStart: Number(m[3]), section: m[5] ?? '', lines: [] };
        hunks.push(cur);
        o = cur.oldStart;
        n = cur.newStart;
        continue;
      }
      if (cur === null) {
        if (line.startsWith('Binary files') || line.startsWith('GIT binary patch')) binary = true;
        head.push(line);
        continue;
      }
      const cr = line.endsWith('\r');
      const body = cr ? line.slice(0, -1) : line;
      if (line.startsWith('\\')) {
        const last = cur.lines[cur.lines.length - 1];
        if (last !== undefined) cur.lines[cur.lines.length - 1] = { ...last, noEol: true };
        continue;
      }
      const c = line[0];
      if (c === '+') cur.lines.push({ kind: 'add', text: body.slice(1), oldNo: null, newNo: n++, cr, noEol: false });
      else if (c === '-') cur.lines.push({ kind: 'del', text: body.slice(1), oldNo: o++, newNo: null, cr, noEol: false });
      else cur.lines.push({ kind: 'ctx', text: body.slice(1), oldNo: o++, newNo: n++, cr, noEol: false });
    }
    return new FileDiff(head, hunks, binary);
  }

  /** 여러 파일이 이어진 diff(`git show`·`git diff`)를 파일별로 나눈다 */
  static parseAll(text: string): { path: string; diff: FileDiff }[] {
    return text
      .split(/^(?=diff --git )/m)
      .filter((c) => c.startsWith('diff --git '))
      .map((chunk) => {
        const plus = /^\+\+\+ b\/(.+?)\r?$/m.exec(chunk)?.[1];
        const minus = /^--- a\/(.+?)\r?$/m.exec(chunk)?.[1];
        const header = /^diff --git a\/(.+) b\/\1\r?$/m.exec(chunk)?.[1] ?? /^diff --git a\/.+ b\/(.+?)\r?$/m.exec(chunk)?.[1];
        return { path: plus ?? minus ?? header ?? '?', diff: FileDiff.parse(chunk) };
      });
  }

  isBinary(): boolean {
    return this.binary;
  }
  isEmpty(): boolean {
    return this.hunks.length === 0 && !this.binary;
  }
  added(): number {
    return this.count('add');
  }
  deleted(): number {
    return this.count('del');
  }
  private count(kind: LineKind): number {
    return this.hunks.reduce((s, h) => s + h.lines.filter((l) => l.kind === kind).length, 0);
  }

  /**
   * hunk 하나를 그 diff 에 적힌 원래 줄 번호 그대로 담은 패치(작업 전→후 방향). `git apply --reverse` 에 넣으면 그 hunk 만 되돌린다.
   * 머리말의 index·mode 줄은 뺀다(되돌려도 파일 권한은 건드리지 않는다). 번호가 없으면 빈 문자열.
   */
  hunkPatch(index: number): string {
    const h = this.hunks[index];
    if (h === undefined) return '';
    const head = this.head.filter((l) => !/^(index |old mode |new mode )/.test(l));
    const rows = h.lines.map((l) => `${l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '}${l.text}${l.cr ? '\r' : ''}${l.noEol ? '\n\\ No newline at end of file' : ''}`);
    return [...head, h.header, ...rows].join('\n') + '\n';
  }

  /**
   * 고른 hunk·줄만 담은 패치. stage는 `git apply --cached`, unstage는 `git apply --cached --reverse`에 넣는다.
   * 고르지 않은 변경 줄은 stage에서는 (추가는 빼고, 삭제는 문맥으로), unstage에서는 (추가는 문맥으로, 삭제는 뺀다).
   * 고른 변경이 하나도 없으면 빈 문자열.
   */
  patchFor(selection: Selection, mode: PatchMode): string {
    const out: string[] = [];
    let delta = 0;
    this.hunks.forEach((h, hi) => {
      const lineSel = selection.lines?.[hi];
      const wholeHunk = selection.hunks?.includes(hi) === true;
      if (!wholeHunk && lineSel === undefined) return;
      const picked = (li: number) => wholeHunk || lineSel?.includes(li) === true;
      const rows: string[] = [];
      let oldCount = 0;
      let newCount = 0;
      let changes = 0;
      h.lines.forEach((l, li) => {
        let kind: LineKind | null = l.kind;
        if (l.kind !== 'ctx' && !picked(li)) {
          if (l.kind === 'add') kind = mode === 'stage' ? null : 'ctx';
          else kind = mode === 'stage' ? 'ctx' : null;
        } else if (l.kind !== 'ctx') changes++;
        if (kind === null) return;
        const tail = l.noEol ? '\n\\ No newline at end of file' : '';
        rows.push(`${kind === 'add' ? '+' : kind === 'del' ? '-' : ' '}${l.text}${l.cr ? '\r' : ''}${tail}`);
        if (kind !== 'add') oldCount++;
        if (kind !== 'del') newCount++;
      });
      if (changes === 0) return;
      const range = (start: number, count: number) => (count === 1 ? `${start}` : `${start},${count}`);
      out.push(`@@ -${range(h.oldStart, oldCount)} +${range(h.oldStart + delta, newCount)} @@${h.section === '' ? '' : ` ${h.section}`}`, ...rows);
      delta += newCount - oldCount;
    });
    if (out.length === 0) return '';
    return [...this.head, ...out].join('\n') + '\n';
  }
}
