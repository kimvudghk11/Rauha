/** 충돌 파일을 읽은 조각: 그냥 줄들 또는 충돌 한 덩어리 */
export type ConflictPart = { readonly kind: 'plain'; readonly lines: readonly string[] } | { readonly kind: 'conflict'; readonly ours: readonly string[]; readonly theirs: readonly string[]; readonly oursLabel: string; readonly theirsLabel: string };

/**
 * git이 파일에 남긴 충돌 표시(<<<<<<< ======= >>>>>>>)를 조각으로 나눈다. 화면은 이걸로 "내 쪽"과 "상대 쪽"을 다른 색으로 보여 준다.
 * diff3 형식의 공통 조상(||||||| 부분)은 보여 주지 않고 건너뛴다. 끝 표시가 없는 덩어리는 충돌로 보지 않고 그냥 줄로 둔다.
 */
export class ConflictText {
  private constructor(readonly parts: readonly ConflictPart[]) {}

  static parse(text: string): ConflictText {
    const lines = text.split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    const parts: ConflictPart[] = [];
    let plain: string[] = [];
    const flush = (): void => {
      if (plain.length > 0) parts.push({ kind: 'plain', lines: plain });
      plain = [];
    };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (!/^<{7}( |$)/.test(line)) {
        plain.push(line);
        continue;
      }
      const ours: string[] = [];
      const theirs: string[] = [];
      let side: 'ours' | 'base' | 'theirs' = 'ours';
      let closed = false;
      let j = i + 1;
      let theirsLabel = '';
      for (; j < lines.length; j++) {
        const l = lines[j]!;
        if (/^\|{7}( |$)/.test(l) && side === 'ours') side = 'base';
        else if (/^={7}$/.test(l) && side !== 'theirs') side = 'theirs';
        else if (/^>{7}( |$)/.test(l) && side === 'theirs') {
          theirsLabel = l.slice(8).trim();
          closed = true;
          break;
        } else if (side === 'ours') ours.push(l);
        else if (side === 'theirs') theirs.push(l);
      }
      if (!closed) {
        plain.push(line);
        continue;
      }
      flush();
      parts.push({ kind: 'conflict', ours, theirs, oursLabel: line.slice(8).trim(), theirsLabel });
      i = j;
    }
    flush();
    return new ConflictText(parts);
  }

  /** 풀지 않은 충돌 덩어리 수 */
  count(): number {
    return this.parts.filter((p) => p.kind === 'conflict').length;
  }
}
