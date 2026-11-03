const WIDE: readonly [number, number][] = [
  [0x1100, 0x115f], [0x2e80, 0xa4cf], [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe30, 0xfe4f], [0xff00, 0xff60], [0xffe0, 0xffe6],
];

/** 터미널에서 차지하는 칸 수. 한글·한자 같은 넓은 글자는 두 칸. 색 코드는 세지 않는다. */
export function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text.replace(/\x1b\[[0-9;]*m/g, '')) {
    const code = ch.codePointAt(0)!;
    width += WIDE.some(([from, to]) => code >= from && code <= to) ? 2 : 1;
  }
  return width;
}

/**
 * 색 코드가 섞인 글을 터미널 줄 단위로 접는다. 띄어쓰기에서 줄을 바꾸고, 줄보다 긴 단어만 글자 단위로 자른다.
 * 색 코드는 칸을 차지하지 않고 쪼개지 않는다(색 코드에는 띄어쓰기가 없다).
 * 목록 줄("- ", "■ ", "1. ")이 접히면 다음 줄을 글머리 뒤에 맞춘다.
 */
export function fitLines(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const source of text.split('\n')) {
    const marker = BULLET.exec(source.replace(/\x1b\[[0-9;]*m/g, ''))?.[0] ?? '';
    const hang = displayWidth(marker) < width ? displayWidth(marker) : 0;
    let current = '';
    let used = 0;
    /** 이 줄에서 글이 시작하는 칸. 접힌 줄은 들여쓰기만큼 차 있다. */
    let start = 0;
    const breakLine = () => {
      lines.push(current.replace(/ +$/, ''));
      current = ' '.repeat(hang);
      used = hang;
      start = hang;
    };
    for (const piece of source.split(/( +)/)) {
      if (piece === '') continue;
      const w = displayWidth(piece);
      if (used + w <= width) {
        current += piece;
        used += w;
        continue;
      }
      // 줄 끝에 걸린 띄어쓰기는 줄바꿈으로 바꾼다.
      if (piece.startsWith(' ')) {
        if (used > start) breakLine();
        continue;
      }
      if (used > start) breakLine();
      if (used + w <= width) {
        current += piece;
        used += w;
        continue;
      }
      for (const token of piece.split(/(\x1b\[[0-9;]*m)/)) {
        if (token.startsWith('\x1b[')) {
          current += token;
          continue;
        }
        for (const ch of token) {
          const cw = displayWidth(ch);
          if (used + cw > width && used > start) breakLine();
          current += ch;
          used += cw;
        }
      }
    }
    lines.push(current);
  }
  return lines;
}

/**
 * 줄 앞 들여쓰기와 글머리. 접힌 줄을 이만큼 들여 쓴다.
 * 글머리: 목록("- ", "1. "), 제목("■ "), 표시("⚠ ", "✓ ", "✗ ", "· "), 그리고 "이름  설명" 표의 이름 칸(두 칸 이상 띄운 짧은 이름).
 */
const BULLET = /^ *(?:[-•*] |■ |▍ |[⚠✓✗·] |\d+\. |[^\s]{1,16} {2,})?/;

/** 너비를 넘는 줄을 접는다. 위험한 명령은 줄이지 않고 전부 보여 줘야 해서 '...' 대신 접는다. */
export function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const ch of text) {
    if (displayWidth(current + ch) > width) {
      lines.push(current);
      current = '';
    }
    current += ch;
  }
  lines.push(current);
  return lines;
}

/** 너비를 넘으면 끝을 '…'로 줄여 한 줄에 맞춘다. 줄이 접히면 Ink가 다시 그릴 때 지울 줄 수가 틀어진다. */
export function truncateWidth(text: string, width: number): string {
  if (displayWidth(text) <= width) return text;
  let out = '';
  for (const ch of text) {
    if (displayWidth(out + ch) > width - 1) break;
    out += ch;
  }
  return `${out}…`;
}
