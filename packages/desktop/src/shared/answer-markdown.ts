/**
 * 팀 답(마크다운)을 답 카드용으로 다듬는다. 파서(shared/markdown.ts)는 그대로 쓰고 글만 고친다.
 * - 예전 답의 "■ 제목" 줄 → "### 제목"(앞뒤 빈 줄)
 * - 문단 안 한 줄 바꿈은 줄바꿈으로 남긴다(줄 끝 공백 둘). 코드 블록·표·목록·제목 줄은 건드리지 않는다.
 */
const STRUCTURAL = /^\s*(?:[-*+]\s|\d+[.)]\s|#{1,6}\s|>|\||```|~~~|$)/;

export function answerMarkdown(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (fence || /^\s*(```|~~~)/.test(line)) {
      out.push(line);
      continue;
    }
    const title = /^■\s*(.+)$/.exec(line);
    if (title !== null) {
      if (out.length > 0 && out[out.length - 1] !== '') out.push('');
      out.push(`### ${title[1]!.trim()}`, '');
      continue;
    }
    const next = lines[i + 1];
    const hardBreak = !STRUCTURAL.test(line) && next !== undefined && next.trim() !== '' && !STRUCTURAL.test(next) && !/^■/.test(next);
    out.push(hardBreak ? `${line}  ` : line);
  }
  return out.join('\n');
}
