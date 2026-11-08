/** 터미널 입력줄 한 줄이 뜻하는 것 */
export type TerminalInput =
  | { readonly kind: 'empty' }
  | { readonly kind: 'clear' }
  /** 폴더 이동. target이 null이면 홈으로 */
  | { readonly kind: 'cd'; readonly target: string | null }
  | { readonly kind: 'cd-back' }
  | { readonly kind: 'run'; readonly command: string };

const CD = /^(?:cd|chdir|set-location|sl)(?:\s+(?:\/d\s+)?(.*))?$/i;
const CLEAR = /^(?:clear|cls)$/i;
/** 여러 명령을 이은 줄(cd가 그 줄 안에서만 쓰인다)은 폴더 이동으로 보지 않고 그대로 실행한다 */
const COMPOUND = /&&|\|\||[|;&<>`]/;

/**
 * 입력줄을 읽는다. 명령마다 새 셸을 띄우기 때문에 cd는 셸이 아니라 터미널이 기억한다(다음 명령부터 그 폴더에서 돈다).
 * "cd 폴더", "cd /d 폴더", "cd -", "cd"(홈), "clear"/"cls"만 따로 다루고 나머지는 모두 실행할 명령이다.
 */
export function parseInput(line: string): TerminalInput {
  const text = line.trim();
  if (text === '') return { kind: 'empty' };
  if (CLEAR.test(text)) return { kind: 'clear' };
  const m = CD.exec(text);
  if (m !== null) {
    const rest = (m[1] ?? '').trim();
    if (rest === '') return { kind: 'cd', target: null };
    if (rest === '-') return { kind: 'cd-back' };
    if (!COMPOUND.test(rest)) return { kind: 'cd', target: unquote(rest) };
  }
  return { kind: 'run', command: text };
}

function unquote(s: string): string {
  const first = s.charAt(0);
  return s.length >= 2 && (first === '"' || first === "'") && s.endsWith(first) ? s.slice(1, -1) : s;
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[()][0-9A-B]|\u001b[=>]/g;

/** 색·커서 이동 같은 터미널 제어 글자를 지운다 */
export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

/** 화면에 남기는 줄 수 상한(넘치면 오래된 줄부터 버린다) */
export const SCREEN_MAX_LINES = 2000;

/**
 * 출력 화면. 줄 바꿈(\n)은 새 줄, 캐리지 리턴(\r)은 같은 줄을 처음부터 덮어쓰기(진행 막대),
 * 백스페이스는 한 칸 지우기다. 제어 글자는 지운다.
 */
export class TerminalScreen {
  private lines: string[] = [''];
  private column = 0;

  constructor(private readonly maxLines: number = SCREEN_MAX_LINES) {}

  write(raw: string): void {
    for (const ch of stripAnsi(raw)) {
      const last = this.lines.length - 1;
      if (ch === '\n') {
        this.lines.push('');
        this.column = 0;
      } else if (ch === '\r') {
        this.column = 0;
      } else if (ch === '\b') {
        this.column = Math.max(0, this.column - 1);
      } else if (ch === '\t' || ch >= ' ') {
        const line = this.lines[last] ?? '';
        this.lines[last] = line.slice(0, this.column) + ch + line.slice(this.column + 1);
        this.column += 1;
      }
    }
    if (this.lines.length > this.maxLines) this.lines = this.lines.slice(this.lines.length - this.maxLines);
  }

  /** 줄 하나를 마무리하고 새 줄에서 시작한다(입력 줄 같은 걸 끼워 넣을 때) */
  endLine(): void {
    if (this.column > 0 || (this.lines[this.lines.length - 1] ?? '') !== '') this.write('\n');
  }

  clear(): void {
    this.lines = [''];
    this.column = 0;
  }

  text(): string {
    return this.lines.join('\n');
  }
}
