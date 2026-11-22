import { describe, expect, it } from 'vitest';
import { answerMarkdown } from './answer-markdown.js';
import { parseMarkdown } from './markdown.js';

describe('답 카드 마크다운', () => {
  it('예전 답의 "■ 제목" 줄은 소제목이 되고 바로 아래 목록과 떨어진다', () => {
    const blocks = parseMarkdown(answerMarkdown('결론입니다.\n\n■ 차이\n- 하나\n- 둘'));
    expect(blocks.map((b) => b.t)).toEqual(['p', 'h', 'ul']);
  });

  it('한 줄 바꿈은 문단 안에서도 줄바꿈으로 남는다(멈춤 안내처럼 줄로 쓴 글)', () => {
    const [p] = parseMarkdown(answerMarkdown('첫 줄\n둘째 줄'));
    expect(p?.t === 'p' && p.c.some((n) => n.t === 'br')).toBe(true);
  });

  it('표·코드 블록·목록은 그대로 둔다', () => {
    const text = '| 항목 | 값 |\n| --- | --- |\n| a | 1 |\n\n```ts\nconst a = 1;\n```\n\n- x\n- y';
    expect(parseMarkdown(answerMarkdown(text)).map((b) => b.t)).toEqual(['table', 'code', 'ul']);
    expect(answerMarkdown('```\na\nb\n```')).toBe('```\na\nb\n```');
  });
});
