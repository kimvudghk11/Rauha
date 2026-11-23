/** 이보다 긴 문서만 발췌한다 */
const EXCERPT_OVER = 4000;
/** 발췌에 넣는 절 본문의 상한 */
const SECTION_BUDGET = 3500;
const DOC_FILE = /\.(md|mdx|markdown|txt|rst|adoc)$/i;

interface Section {
  readonly start: number;
  readonly end: number;
  readonly level: number;
  readonly title: string;
}

const STOP = new Set(['추가', '해줘', '해주세요', '규칙', '대로', '에서', '으로', '하고', '그리고', 'docs', 'spec', 'design', 'readme', 'src', 'the', 'and']);

/** 요청에서 절 번호(3.2, 4-1)와 찾을 낱말(식별자·두 글자 이상 한글 낱말)을 뽑는다 */
function focusOf(request: string): { readonly numbers: readonly string[]; readonly words: readonly string[] } {
  const numbers = [...request.matchAll(/(?<![\d.])(\d+(?:[.-]\d+)+)(?![\d.])/g)].map((m) => m[1]!.replace(/-/g, '.'));
  const words = [...new Set([...request.matchAll(/[A-Za-z_][A-Za-z0-9_]{3,}|[가-힣]{2,}/g)].map((m) => m[0].replace(/(을|를|이|가|은|는|에|의|로|와|과|도)$/, '')).filter((w) => w.length >= 2 && !STOP.has(w.toLowerCase())))];
  return { numbers, words };
}

/**
 * 팀원에게 붙여 줄 긴 문서(SPEC·DESIGN 같은 .md)를 "목차 + 이번 일에 맞는 절"로 줄인다.
 * 줄 번호는 원래 파일과 같아서(Read 와 같다) 다른 절이 필요하면 그 줄부터 열 수 있다.
 * 코드 파일·짧은 문서·제목이 없는 문서는 그대로 둔다.
 */
export class DocExcerpt {
  private constructor(
    private readonly path: string,
    private readonly lines: readonly string[],
    private readonly picked: readonly Section[] | null,
    private readonly outline: readonly Section[],
  ) {}

  static of(path: string, content: string, request: string): DocExcerpt {
    const lines = content.replace(/\n$/, '').split('\n');
    if (!DOC_FILE.test(path) || content.length <= EXCERPT_OVER) return new DocExcerpt(path, lines, null, []);
    const heads: { line: number; level: number; title: string }[] = [];
    let fence = false;
    lines.forEach((l, i) => {
      if (/^\s*(```|~~~)/.test(l)) fence = !fence;
      const m = fence ? null : /^(#{1,6})\s+(.*)$/.exec(l);
      if (m !== null) heads.push({ line: i, level: m[1]!.length, title: m[2]!.trim() });
    });
    if (heads.length < 2) return new DocExcerpt(path, lines, null, []);
    const sections: Section[] = heads.map((h, k) => {
      const next = heads.slice(k + 1).find((x) => x.level <= h.level);
      return { start: h.line, end: next === undefined ? lines.length : next.line, level: h.level, title: h.title };
    });
    const { numbers, words } = focusOf(request);
    const body = (s: Section): string => lines.slice(s.start, s.end).join('\n');
    // 1) 요청이 말한 절 번호 — 가장 좁은(깊은) 절
    let chosen = sections.filter((s) => numbers.some((n) => new RegExp(`^${n.replace(/\./g, '\\.')}(?![\\d])`).test(s.title.replace(/^[^\d]*/, ''))));
    // 2) 없으면 낱말이 가장 많이 나오는 절(가장 깊은 절 기준, 동점이면 짧은 것)
    if (chosen.length === 0 && words.length > 0) {
      const leaves = sections.filter((s) => !sections.some((o) => o !== s && o.start > s.start && o.end <= s.end));
      const scored = leaves
        .map((s) => {
          const t = body(s);
          return { s, score: words.reduce((acc, w) => acc + (t.includes(w) ? 1 + (s.title.includes(w) ? 2 : 0) : 0), 0) };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || a.s.end - a.s.start - (b.s.end - b.s.start));
      const best = scored[0]?.score ?? 0;
      chosen = scored.filter((x) => x.score >= Math.max(1, best - 1)).map((x) => x.s);
    }
    // 3) 그래도 없으면 맨 앞 절(개요)
    // (문서 전체를 감싸는 맨 위 제목은 빼고)
    if (chosen.length === 0) chosen = sections.filter((s) => s.end - s.start < lines.length / 2).slice(0, 2);
    // 겹치는 절은 바깥 것만, 예산 안에서
    const kept: Section[] = [];
    let used = 0;
    for (const s of chosen.sort((a, b) => a.start - b.start)) {
      if (kept.some((k) => s.start >= k.start && s.end <= k.end)) continue;
      const size = body(s).length;
      if (used + size > SECTION_BUDGET && kept.length > 0) continue;
      kept.push(s);
      used += size;
    }
    return new DocExcerpt(path, lines, kept, sections);
  }

  isWhole(): boolean {
    return this.picked === null;
  }

  /** 붙일 글(줄 번호 + 탭 + 줄). 발췌면 목차와 넣은 절 */
  text(): string {
    const num = (i: number): string => `${i + 1}\t${this.lines[i]}`;
    if (this.picked === null) return this.lines.map((_, i) => num(i)).join('\n');
    const out: string[] = [`(긴 문서라 목차와 이번 일에 맞는 절만 넣었습니다. 줄 번호는 파일과 같으니 다른 절이 필요하면 Read 로 그 줄부터 여세요. 전체 ${this.lines.length}줄)`, '목차:'];
    for (const s of this.outline) out.push(num(s.start));
    for (const s of this.picked) {
      out.push(`--- ${s.start + 1}~${s.end}행 ---`);
      let end = s.end;
      while (end > s.start && this.lines[end - 1]!.trim() === '') end--;
      for (let i = s.start; i < end; i++) out.push(num(i));
    }
    return out.join('\n');
  }
}
