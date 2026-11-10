import { describe, expect, it } from 'vitest';
import { parseMarkdown, safeHref, type Block, type Inline } from './markdown.js';

const para = (text: string): readonly Inline[] => {
  const b = parseMarkdown(text)[0];
  if (b === undefined || b.t !== 'p') throw new Error(`문단이 아니에요: ${JSON.stringify(b)}`);
  return b.c;
};
const plain = (inline: readonly Inline[]): string =>
  inline.map((n) => (n.t === 'text' || n.t === 'code' ? n.v : n.t === 'br' ? '\n' : n.t === 'image' ? n.alt : plain(n.c))).join('');

describe('마크다운 블록', () => {
  it('제목은 # 개수가 단계다', () => {
    const b = parseMarkdown('# 하나\n\n### 셋 ##');
    expect(b.map((x) => (x.t === 'h' ? x.level : 0))).toEqual([1, 3]);
    expect(b[1]?.t === 'h' && plain(b[1].c)).toBe('셋');
  });
  it('#뒤에 공백이 없으면 제목이 아니다', () => {
    expect(parseMarkdown('#해시태그')[0]?.t).toBe('p');
  });
  it('빈 줄로 문단을 나누고 줄바꿈은 공백이다', () => {
    const b = parseMarkdown('첫 줄\n둘째 줄\n\n새 문단');
    expect(b).toHaveLength(2);
    expect(plain((b[0] as Extract<Block, { t: 'p' }>).c)).toBe('첫 줄 둘째 줄');
  });
  it('줄 끝 공백 둘이나 역슬래시는 줄바꿈이다', () => {
    expect(para('a  \nb').some((n) => n.t === 'br')).toBe(true);
    expect(para('a\\\nb').some((n) => n.t === 'br')).toBe(true);
  });
  it('코드 블록은 안을 해석하지 않고 언어를 기억한다', () => {
    const b = parseMarkdown('```ts\nconst a = **1**;\n# x\n```\n\n뒤');
    expect(b[0]).toEqual({ t: 'code', lang: 'ts', text: 'const a = **1**;\n# x' });
    expect(b[1]?.t).toBe('p');
  });
  it('닫지 않은 코드 블록은 끝까지 코드다', () => {
    expect(parseMarkdown('```\nabc')[0]).toEqual({ t: 'code', lang: '', text: 'abc' });
  });
  it('가로줄', () => {
    for (const s of ['---', '***', '___', '- - -']) expect(parseMarkdown(s)[0]?.t, s).toBe('hr');
  });
  it('인용은 안쪽을 다시 해석한다', () => {
    const b = parseMarkdown('> # 제목\n> 글');
    expect(b[0]?.t).toBe('quote');
    expect(b[0]?.t === 'quote' && b[0].c.map((x) => x.t)).toEqual(['h', 'p']);
  });
  it('목록: 순서 없는 것, 순서 있는 것, 시작 번호', () => {
    const b = parseMarkdown('- a\n- b\n\n3. c\n4. d');
    expect(b[0]).toMatchObject({ t: 'ul' });
    expect(b[1]).toMatchObject({ t: 'ol', start: 3 });
    expect(b[0]?.t === 'ul' && b[0].items).toHaveLength(2);
  });
  it('목록 안 목록(들여쓰기)', () => {
    const b = parseMarkdown('- a\n  - b\n  - c\n- d');
    const list = b[0];
    expect(list?.t === 'ul' && list.items).toHaveLength(2);
    const first = list?.t === 'ul' ? list.items[0] : undefined;
    expect(first?.c.some((x) => x.t === 'ul')).toBe(true);
  });
  it('할 일 목록은 체크 상태를 가진다', () => {
    const b = parseMarkdown('- [ ] 안 함\n- [x] 함');
    const items = b[0]?.t === 'ul' ? b[0].items : [];
    expect(items.map((i) => i.checked)).toEqual([false, true]);
  });
  it('표는 머리·정렬·몸통을 가진다', () => {
    const b = parseMarkdown('| 이름 | 값 |\n|:--|--:|\n| a | 1 |\n| b | 2 |');
    expect(b[0]?.t).toBe('table');
    if (b[0]?.t !== 'table') return;
    expect(b[0].head).toHaveLength(2);
    expect(b[0].align).toEqual(['left', 'right']);
    expect(b[0].rows).toHaveLength(2);
    expect(plain(b[0].rows[1]![1]!)).toBe('2');
  });
  it('구분선이 없는 | 줄은 표가 아니다', () => {
    expect(parseMarkdown('a | b\nc | d')[0]?.t).toBe('p');
  });
  it('HTML 태그는 해석하지 않고 글자 그대로 둔다', () => {
    const b = parseMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>');
    expect(b.every((x) => x.t === 'p')).toBe(true);
    expect(plain((b[0] as Extract<Block, { t: 'p' }>).c)).toBe('<script>alert(1)</script>');
  });
});

describe('마크다운 글 속', () => {
  it('굵게·기울임·취소선·코드', () => {
    expect(para('**굵게** *기울임* ~~취소~~ `코드`').map((n) => n.t)).toEqual(['strong', 'text', 'em', 'text', 'del', 'text', 'code']);
  });
  it('단어 안의 밑줄은 기울임이 아니다', () => {
    expect(plain(para('snake_case_name'))).toBe('snake_case_name');
    expect(para('snake_case_name').every((n) => n.t === 'text')).toBe(true);
  });
  it('코드 안은 해석하지 않는다', () => {
    expect(para('`**a**`')).toEqual([{ t: 'code', v: '**a**' }]);
  });
  it('역슬래시로 기호를 글자로 만든다', () => {
    expect(plain(para('\\*별\\*'))).toBe('*별*');
  });
  it('닫히지 않은 기호는 글자 그대로다', () => {
    expect(plain(para('2 * 3 와 **열림'))).toBe('2 * 3 와 **열림');
  });
  it('링크는 http·https만 만들고 글은 남긴다', () => {
    const ok = para('[여기](https://example.com/a?b=1)')[0];
    expect(ok).toMatchObject({ t: 'link', href: 'https://example.com/a?b=1' });
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'vbscript:x', '/rel/path', '#anchor', 'mailto:a@b.c', ' javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java\tscript:alert(1)']) {
      const nodes = para(`[누르세요](${bad})`);
      expect(nodes.some((n) => n.t === 'link'), bad).toBe(false);
      expect(plain(nodes), bad).toBe('누르세요');
    }
  });
  it('링크 글 안에 서식이 있어도 된다', () => {
    const l = para('[**굵은** 링크](http://a.com)')[0];
    expect(l?.t === 'link' && l.c.map((n) => n.t)).toEqual(['strong', 'text']);
  });
  it('이미지는 주소를 그대로 들고 있다(허락은 그리는 쪽이 정한다)', () => {
    expect(para('![로고](assets/a.png "제목")')[0]).toEqual({ t: 'image', src: 'assets/a.png', alt: '로고' });
  });
  it('이미지를 감싼 링크(배지)도 읽는다', () => {
    const n = para('[![빌드](b.svg)](https://ci.example.com)')[0];
    expect(n?.t === 'link' && n.c[0]?.t).toBe('image');
  });
  it('<주소> 와 맨 주소는 링크가 된다', () => {
    expect(para('<https://a.com>')[0]).toMatchObject({ t: 'link', href: 'https://a.com/' });
    expect(para('보세요 https://a.com/x 끝').some((n) => n.t === 'link')).toBe(true);
  });
  it('HTML은 글자다', () => {
    expect(plain(para('<b onclick=x>굵게</b>'))).toBe('<b onclick=x>굵게</b>');
  });
});

describe('안전한 링크', () => {
  it('http·https 주소만 돌려준다', () => {
    expect(safeHref('https://example.com')).toBe('https://example.com/');
    expect(safeHref('http://example.com/a b')).toBe('http://example.com/a%20b');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('//example.com')).toBeNull();
    expect(safeHref('')).toBeNull();
    expect(safeHref('https://user:pw@example.com')).toBeNull();
  });
});

describe('큰 글', () => {
  it('아주 깊은 인용·목록도 멈추지 않는다', () => {
    const deep = `${'> '.repeat(200)}끝`;
    expect(() => parseMarkdown(deep)).not.toThrow();
    const nested = Array.from({ length: 200 }, (_, i) => `${' '.repeat(i * 2)}- x`).join('\n');
    expect(() => parseMarkdown(nested)).not.toThrow();
  });
  it('줄이 많아도 빠르다', () => {
    const text = Array.from({ length: 20000 }, (_, i) => `줄 ${i} **굵게** [a](https://a.com) \`c\``).join('\n\n');
    const start = Date.now();
    parseMarkdown(text);
    expect(Date.now() - start).toBeLessThan(3000);
  });
});
