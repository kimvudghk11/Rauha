import { looksSecretName } from './file-mention.js';

/** 채팅으로 보낼 선택 영역의 상한 */
export const MAX_SHARE_LINES = 300;
export const MAX_SHARE_CHARS = 20_000;

const FENCE_LANG: Readonly<Record<string, string>> = {
  ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx', mjs: 'js', cjs: 'js', json: 'json', css: 'css', html: 'html', md: 'md', py: 'python', java: 'java', kt: 'kotlin',
  yml: 'yaml', yaml: 'yaml', xml: 'xml', sql: 'sql', rs: 'rust', go: 'go', sh: 'sh', toml: 'toml', c: 'c', cpp: 'cpp', h: 'c',
};

/**
 * 편집기에서 고른 코드 한 덩어리. 채팅 입력칸에 붙여 넣을 글(파일 경로·줄 범위·울타리 코드)로 바꾼다.
 * 비밀 파일 이름이거나 비었거나 줄 범위가 말이 안 되면 만들지 않는다. 너무 길면 앞부분만 담고 얼마나 잘랐는지 적는다.
 */
export class CodeSelection {
  private constructor(
    readonly path: string,
    readonly fromLine: number,
    readonly toLine: number,
    readonly text: string,
  ) {}

  static of(path: string, fromLine: number, toLine: number, text: string): CodeSelection | null {
    if (!Number.isInteger(fromLine) || !Number.isInteger(toLine) || fromLine < 1 || toLine < fromLine) return null;
    if (text.trim() === '' || looksSecretName(path)) return null;
    return new CodeSelection(path, fromLine, toLine, text.replace(/(\r?\n)+$/, ''));
  }

  toChatText(): string {
    const lines = this.text.split('\n');
    let shown = lines.slice(0, MAX_SHARE_LINES).join('\n');
    let omittedLines = Math.max(0, lines.length - MAX_SHARE_LINES);
    if (shown.length > MAX_SHARE_CHARS) {
      shown = shown.slice(0, MAX_SHARE_CHARS);
      omittedLines = Math.max(omittedLines, 1);
    }
    const range = this.fromLine === this.toLine ? `${this.fromLine}` : `${this.fromLine}-${this.toLine}`;
    const longest = Math.max(2, ...[...shown.matchAll(/`+/g)].map((m) => m[0].length));
    const fence = '`'.repeat(longest + 1);
    const ext = this.path.includes('.') ? this.path.slice(this.path.lastIndexOf('.') + 1).toLowerCase() : '';
    const note = omittedLines > 0 ? `\n… ${omittedLines > 1 || lines.length > MAX_SHARE_LINES ? `${omittedLines}줄 ` : ''}생략(너무 길어서 앞부분만 보냈어요)` : '';
    return `\`${this.path}\` 줄 ${range}:\n${fence}${FENCE_LANG[ext] ?? ''}\n${shown}${note}\n${fence}\n`;
  }
}
