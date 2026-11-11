/** 충돌 파일을 읽은 조각: 그냥 줄들 또는 충돌 한 덩어리(base 는 diff3 형식일 때만 있다) */
export type ConflictPart =
  | { readonly kind: 'plain'; readonly lines: readonly string[] }
  | { readonly kind: 'conflict'; readonly ours: readonly string[]; readonly theirs: readonly string[]; readonly base?: readonly string[]; readonly oursLabel: string; readonly theirsLabel: string };

/** 한 구역을 어떻게 풀지: 내 것 · 상대 것 · 둘 다(내 것 다음에 상대 것) · 공통 조상 */
export type ConflictChoice = 'mine' | 'theirs' | 'both' | 'base';

type ConflictBlock = Extract<ConflictPart, { kind: 'conflict' }>;

const bare = (line: string): string => line.replace(/\r$/, '');

/**
 * git이 파일에 남긴 충돌 표시(<<<<<<< ======= >>>>>>>)를 조각으로 나눈다. 화면은 이걸로 "내 쪽"·"공통 조상"·"상대 쪽"을 나란히 보여 주고,
 * 구역마다 어느 쪽을 받을지 골라 글로 되돌린다(`resolve` → `toText`).
 * diff3 형식의 공통 조상(||||||| 부분)은 base 로 읽는다. 끝 표시가 없는 덩어리는 충돌로 보지 않고 그냥 줄로 둔다.
 * 충돌 구역 안 줄(ours·theirs·base)에는 줄 끝 CR 을 떼어 두고(화면에 \r 이 보이지 않게), 글로 되돌릴 때 파일의 줄 끝(CRLF 면 CR)을 다시 붙인다. 파일 끝 줄 바꿈도 지킨다.
 */
export class ConflictText {
  private constructor(
    readonly parts: readonly ConflictPart[],
    private readonly endsWithNewline: boolean,
    /** CRLF 파일이면 '\r'. 우리가 새로 쓰는 표시 줄에 붙인다. */
    private readonly cr: string,
  ) {}

  static parse(text: string): ConflictText {
    const lines = text.split('\n');
    const endsWithNewline = lines.length > 0 && lines[lines.length - 1] === '';
    if (endsWithNewline) lines.pop();
    const cr = text.includes('\r\n') ? '\r' : '';
    const parts: ConflictPart[] = [];
    let plain: string[] = [];
    const flush = (): void => {
      if (plain.length > 0) parts.push({ kind: 'plain', lines: plain });
      plain = [];
    };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (!/^<{7}( |$)/.test(bare(line))) {
        plain.push(line);
        continue;
      }
      const ours: string[] = [];
      const base: string[] = [];
      const theirs: string[] = [];
      let side: 'ours' | 'base' | 'theirs' = 'ours';
      let hasBase = false;
      let closed = false;
      let j = i + 1;
      let theirsLabel = '';
      for (; j < lines.length; j++) {
        const l = lines[j]!;
        const b = bare(l);
        if (/^\|{7}( |$)/.test(b) && side === 'ours') {
          side = 'base';
          hasBase = true;
        } else if (/^={7}$/.test(b) && side !== 'theirs') side = 'theirs';
        else if (/^>{7}( |$)/.test(b) && side === 'theirs') {
          theirsLabel = b.slice(8).trim();
          closed = true;
          break;
        } else if (side === 'ours') ours.push(b);
        else if (side === 'base') base.push(b);
        else theirs.push(b);
      }
      if (!closed) {
        plain.push(line);
        continue;
      }
      flush();
      const oursLabel = bare(line).slice(8).trim();
      parts.push(hasBase ? { kind: 'conflict', ours, theirs, base, oursLabel, theirsLabel } : { kind: 'conflict', ours, theirs, oursLabel, theirsLabel });
      i = j;
    }
    flush();
    return new ConflictText(parts, endsWithNewline, cr);
  }

  /** 풀지 않은 충돌 덩어리 수 */
  count(): number {
    return this.parts.filter((p) => p.kind === 'conflict').length;
  }

  /** 공통 조상 줄이 있는 구역이 하나라도 있다 */
  hasBase(): boolean {
    return this.parts.some((p) => p.kind === 'conflict' && p.base !== undefined);
  }

  /**
   * index 번째(0부터, 풀지 않은 구역만 센다) 구역을 고른 쪽 줄로 바꾼 새 글. 다른 구역은 그대로다.
   * 없는 번호이거나, 조상 줄이 없는 구역에서 base 를 고르면 아무것도 바꾸지 않고 자기 자신을 돌려준다.
   */
  resolve(index: number, choice: ConflictChoice): ConflictText {
    let n = -1;
    let changed = false;
    const next: ConflictPart[] = [];
    const push = (picked: readonly string[], fromBlock = false): void => {
      const lines = fromBlock ? picked.map((l) => l + this.cr) : picked;
      if (lines.length === 0) return;
      const last = next[next.length - 1];
      if (last !== undefined && last.kind === 'plain') next[next.length - 1] = { kind: 'plain', lines: [...last.lines, ...lines] };
      else next.push({ kind: 'plain', lines });
    };
    for (const part of this.parts) {
      if (part.kind === 'plain') {
        push(part.lines);
        continue;
      }
      n++;
      const lines = n === index ? ConflictText.pick(part, choice) : null;
      if (lines === null) {
        next.push(part);
        continue;
      }
      changed = true;
      push(lines, true);
    }
    return changed ? new ConflictText(next, this.endsWithNewline, this.cr) : this;
  }

  private static pick(block: ConflictBlock, choice: ConflictChoice): readonly string[] | null {
    if (choice === 'mine') return block.ours;
    if (choice === 'theirs') return block.theirs;
    if (choice === 'both') return [...block.ours, ...block.theirs];
    return block.base ?? null;
  }

  /** 파일에 쓸 글. 풀지 않은 구역은 충돌 표시를 다시 만든다. */
  toText(): string {
    const out: string[] = [];
    for (const part of this.parts) {
      if (part.kind === 'plain') {
        out.push(...part.lines);
        continue;
      }
      const label = (mark: string, name: string): string => `${mark}${name === '' ? '' : ` ${name}`}${this.cr}`;
      const eol = (lines: readonly string[]): string[] => lines.map((l) => l + this.cr);
      out.push(label('<<<<<<<', part.oursLabel), ...eol(part.ours));
      if (part.base !== undefined) out.push(`||||||| base${this.cr}`, ...eol(part.base));
      out.push(`=======${this.cr}`, ...eol(part.theirs), label('>>>>>>>', part.theirsLabel));
    }
    return out.join('\n') + (this.endsWithNewline && out.length > 0 ? '\n' : '');
  }

  /**
   * 작업 파일(git 기본 형식)에 git 이 다시 만든 diff3 글의 공통 조상 줄을 붙인다.
   * 두 글의 구역 모양(그냥 줄·내 쪽·상대 쪽)이 CR 차이를 빼고 같을 때만 붙이고, 사용자가 이미 고쳐서 달라졌거나 diff3 가 없으면 작업 파일 그대로다.
   */
  static withBase(working: string, diff3: string | null): ConflictText {
    const w = ConflictText.parse(working);
    if (diff3 === null || w.hasBase()) return w;
    const d = ConflictText.parse(diff3);
    if (!d.hasBase() || d.parts.length !== w.parts.length) return w;
    const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((l, i) => bare(l) === bare(b[i]!));
    const parts: ConflictPart[] = [];
    for (let i = 0; i < w.parts.length; i++) {
      const wp = w.parts[i]!;
      const dp = d.parts[i]!;
      if (wp.kind === 'plain') {
        if (dp.kind !== 'plain' || !same(wp.lines, dp.lines)) return w;
        parts.push(wp);
        continue;
      }
      if (dp.kind !== 'conflict' || !same(wp.ours, dp.ours) || !same(wp.theirs, dp.theirs)) return w;
      parts.push(dp.base === undefined ? wp : { ...wp, base: dp.base });
    }
    return new ConflictText(parts, w.endsWithNewline, w.cr);
  }
}
