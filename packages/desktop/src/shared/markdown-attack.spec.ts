import { describe, expect, it } from 'vitest';
import { parseMarkdown, safeHref, type Block, type Inline } from './markdown.js';
import { workImagePath } from './preview-kind.js';

/** 구조 안의 모든 글 속 노드를 모은다 */
function inlinesOf(blocks: readonly Block[]): Inline[] {
  const out: Inline[] = [];
  const walkInline = (nodes: readonly Inline[]): void => {
    for (const n of nodes) {
      out.push(n);
      if (n.t === 'strong' || n.t === 'em' || n.t === 'del' || n.t === 'link') walkInline(n.c);
    }
  };
  const walk = (list: readonly Block[]): void => {
    for (const b of list) {
      if (b.t === 'h' || b.t === 'p') walkInline(b.c);
      else if (b.t === 'quote') walk(b.c);
      else if (b.t === 'ul' || b.t === 'ol') for (const item of b.items) walk(item.c);
      else if (b.t === 'table') {
        for (const c of b.head) walkInline(c);
        for (const r of b.rows) for (const c of r) walkInline(c);
      }
    }
  };
  walk(blocks);
  return out;
}

const HOSTILE_LINKS = [
  '[x](javascript:alert(1))',
  '[x](JaVaScRiPt:alert(1))',
  '[x](java\tscript:alert(1))',
  '[x]( javascript:alert(1))',
  '[x](&#106;avascript:alert(1))',
  '[x](data:text/html;base64,PHNjcmlwdD4=)',
  '[x](vbscript:msgbox(1))',
  '[x](file:///etc/passwd)',
  '[x](//evil.example/x)',
  '[x](/relative)',
  '[x](<javascript:alert(1)>)',
  '[x](javascript:alert(1) "title")',
  '[x](https://user:pw@evil.example/)',
  '[x](\\x6Aavascript:alert(1))',
  '<javascript:alert(1)>',
  '<a href="javascript:alert(1)">x</a>',
  '[x][ref]\n\n[ref]: javascript:alert(1)',
  '![x](javascript:alert(1))',
];

describe('마크다운 해석 공격 입력', () => {
  it.each(HOSTILE_LINKS)('위험한 주소는 링크가 되지 않는다: %s', (src) => {
    for (const n of inlinesOf(parseMarkdown(src))) {
      if (n.t === 'link') expect(n.href).toMatch(/^https?:\/\//);
    }
  });

  it('HTML 태그·이벤트 속성은 글자 그대로 남고 구조 노드가 되지 않는다', () => {
    const blocks = parseMarkdown('<img src=x onerror=alert(1)>\n\n<script>alert(1)</script>\n\n<svg onload=alert(1)>');
    for (const b of blocks) expect(b.t).toBe('p');
    const types = new Set(inlinesOf(blocks).map((n) => n.t));
    expect([...types]).toEqual(['text']);
  });

  it('safeHref는 http·https 외에는 모두 거절한다', () => {
    for (const bad of ['javascript:1', 'data:text/html,x', 'file:///x', 'ftp://x', 'blob:https://x', '//x', 'https://a:b@x', 'https:///']) {
      expect(safeHref(bad), bad).toBeNull();
    }
    expect(safeHref('https://example.com/a?b=1#c')).toBe('https://example.com/a?b=1#c');
  });

  it('이미지 주소는 구조에 그대로 두되(그리는 쪽이 거른다) 링크로 바뀌지 않는다', () => {
    const [p] = parseMarkdown('![a](../../etc/passwd.png)');
    expect(p?.t).toBe('p');
    expect(inlinesOf([p!]).map((n) => n.t)).toEqual(['image']);
  });

  const slow: readonly [string, string][] = [
    ['대괄호 반복', '['.repeat(200_000)],
    ['대괄호+괄호 반복', '[a](b'.repeat(60_000)],
    ['별표 반복', '*a '.repeat(100_000)],
    ['밑줄 반복', '_a'.repeat(100_000)],
    ['백틱 반복', '`a'.repeat(100_000)],
    ['인용 줄 반복', '> '.repeat(5000) + 'x\n'.repeat(2000)],
    ['중첩 목록', Array.from({ length: 3000 }, (_, i) => `${' '.repeat(Math.min(i, 40))}- x`).join('\n')],
    ['표 머리', '|a'.repeat(20_000) + '|\n' + '|-'.repeat(20_000) + '|\n' + '|1'.repeat(20_000)],
    ['이미지 반복', '![a](b.png)'.repeat(30_000)],
    ['긴 주소', `[a](https://x/${'a'.repeat(1_000_000)})`],
    ['꺾쇠 반복', '<http://'.repeat(100_000)],
    ['펜스 반복', '```\n'.repeat(100_000)],
    ['줄바꿈 반복', '\n'.repeat(500_000)],
  ];
  it.each(slow)('멈추지 않는다(1초 안): %s', (_name, text) => {
    const t0 = Date.now();
    parseMarkdown(text);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

describe('마크다운 이미지 주소 공격', () => {
  const at = 'docs/guide/readme.md';
  const bad = [
    '../../../etc/passwd.png',
    '..\\..\\..\\x.png',
    '%2e%2e/%2e%2e/%2e%2e/x.png',
    '/etc/x.png',
    '\\\\server\\share\\x.png',
    'C:\\x.png',
    'c:/x.png',
    'file:///x.png',
    'http://evil.example/x.png',
    'data:image/png;base64,AAAA',
    'x.png\0.txt',
    '..%00/x.png',
    'a/../../../../x.png',
    './../../../x.png',
    'a.txt',
    'x.png:stream.txt',
  ];
  it.each(bad)('작업 폴더 밖이거나 그림이 아니면 거절한다: %s', (src) => {
    expect(workImagePath(at, src)).toBeNull();
  });
  it('안쪽 경로는 푼다(인코딩된 ..도 작업 폴더 안이면 허락)', () => {
    expect(workImagePath(at, '%2E%2E%5C..%5Cx.png')).toBe('x.png');
    expect(workImagePath(at, '....//....//x.png')).toBe('docs/guide/..../..../x.png');
    expect(workImagePath(at, 'a/../img/x.png?raw=1#f')).toBe('docs/guide/img/x.png');
    expect(workImagePath('readme.md', 'x.PNG')).toBe('x.PNG');
  });
  it('인코딩된 구분자가 든 이름은 실제 폴더 이동이 되지 않는다', () => {
    const r = workImagePath('readme.md', 'a%2f..%2f..%2fx.png');
    expect(r === null || !r.split('/').includes('..')).toBe(true);
  });
});
