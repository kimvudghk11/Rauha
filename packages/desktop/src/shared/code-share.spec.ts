import { describe, expect, it } from 'vitest';
import { CodeSelection, MAX_SHARE_CHARS, MAX_SHARE_LINES } from './code-share.js';

describe('CodeSelection', () => {
  it('파일 경로와 줄 범위를 머리말로 달고 코드를 울타리로 감싼다', () => {
    const s = CodeSelection.of('src/a.ts', 10, 11, 'const a = 1;\nconst b = 2;')!;
    expect(s.toChatText()).toBe('`src/a.ts` 줄 10-11:\n```ts\nconst a = 1;\nconst b = 2;\n```\n');
  });
  it('선택 끝의 빈 줄바꿈은 떼고 보낸다', () => {
    expect(CodeSelection.of('a.ts', 1, 2, 'a\nb\n\n')!.toChatText()).toBe('`a.ts` 줄 1-2:\n```ts\na\nb\n```\n');
  });
  it('한 줄만 골랐으면 줄 번호 하나만 쓴다', () => {
    expect(CodeSelection.of('a.py', 3, 3, 'x = 1')!.toChatText()).toContain('줄 3:');
  });
  it('선택한 글이 비었거나 공백뿐이면 보낼 것이 없다', () => {
    expect(CodeSelection.of('a.ts', 1, 1, '')).toBeNull();
    expect(CodeSelection.of('a.ts', 1, 2, '  \n\t ')).toBeNull();
  });
  it('끝 줄이 시작 줄보다 앞서면 받지 않는다', () => {
    expect(CodeSelection.of('a.ts', 5, 2, 'x')).toBeNull();
    expect(CodeSelection.of('a.ts', 0, 2, 'x')).toBeNull();
  });
  it('비밀 파일 이름이면 보내지 않는다', () => {
    expect(CodeSelection.of('.env', 1, 1, 'KEY=abc')).toBeNull();
    expect(CodeSelection.of('cfg/server.pem', 1, 1, 'x')).toBeNull();
  });
  it('코드 안에 울타리가 있으면 더 긴 울타리로 감싼다', () => {
    const text = CodeSelection.of('a.md', 1, 3, '```js\nx\n```')!.toChatText();
    expect(text).toContain('````md');
  });
  it('너무 길면 앞부분만 보내고 얼마나 잘랐는지 적는다', () => {
    const long = Array.from({ length: MAX_SHARE_LINES + 50 }, (_, i) => `l${i}`).join('\n');
    const out = CodeSelection.of('a.ts', 1, MAX_SHARE_LINES + 50, long)!.toChatText();
    expect(out).toContain(`l${MAX_SHARE_LINES - 1}`);
    expect(out).not.toContain(`l${MAX_SHARE_LINES}\n`);
    expect(out).toContain('50줄 생략');
  });
  it('글자 수가 너무 많아도 잘라서 보낸다', () => {
    const out = CodeSelection.of('a.ts', 1, 1, 'x'.repeat(MAX_SHARE_CHARS + 100))!.toChatText();
    expect(out.length).toBeLessThan(MAX_SHARE_CHARS + 200);
    expect(out).toContain('생략');
  });
  it('확장자를 모르는 파일은 언어 이름 없이 울타리만 쓴다', () => {
    expect(CodeSelection.of('Makefile', 1, 1, 'all:')!.toChatText()).toContain('\n```\nall:');
  });
});
