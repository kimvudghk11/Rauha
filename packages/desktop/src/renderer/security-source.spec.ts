import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = __dirname;
const sources = readdirSync(dir)
  .filter((n) => n.endsWith('.ts') && !n.endsWith('.spec.ts'))
  .map((n) => ({ name: n, text: readFileSync(join(dir, n), 'utf8') }));

describe('화면 코드 보안 점검(소스 검사)', () => {
  it('HTML 문자열을 만드는 API는 따옴표로 닫힌 고정 글에만 쓴다(값을 이어붙이지 않는다)', () => {
    const bad: string[] = [];
    for (const { name, text } of sources) {
      for (const m of text.matchAll(/\b(innerHTML|outerHTML|insertAdjacentHTML|srcdoc)\b[^\n]*/g)) {
        const rest = m[0];
        const fixed = /^(innerHTML|outerHTML)\s*=\s*'[^'$]*';/.test(rest) && !rest.includes('${');
        const comment = /^\S+\s+[(·는을가이]/.test(rest) || /\*|\/\//.test(text.slice(Math.max(0, (m.index ?? 0) - 3), m.index));
        if (!fixed && !comment) bad.push(`${name}: ${rest.slice(0, 80)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('eval·new Function·document.write·문자열 setTimeout을 쓰지 않는다', () => {
    const bad: string[] = [];
    for (const { name, text } of sources) {
      for (const re of [/\beval\s*\(/, /new\s+Function\s*\(/, /document\.write(ln)?\s*\(/, /set(Timeout|Interval)\s*\(\s*['"`]/]) if (re.test(text)) bad.push(`${name}: ${re}`);
    }
    expect(bad).toEqual([]);
  });

  it('마크다운 그리기는 원문을 마크업으로 넣지 않는다', () => {
    const md = sources.find((s) => s.name === 'markdown-view.ts')!.text;
    expect(md).not.toMatch(/\.innerHTML\s*=|insertAdjacentHTML|outerHTML\s*=/);
    expect(md).not.toMatch(/setAttribute\(\s*['"]style/);
    // 링크는 새 창 열기를 막는 rel을 단다
    expect(md).toContain("a.rel = 'noopener noreferrer'");
  });

  it('on* 이벤트 속성을 문자열로 달지 않는다', () => {
    const bad = sources.filter((s) => /setAttribute\(\s*['"`]on[a-z]+/i.test(s.text)).map((s) => s.name);
    expect(bad).toEqual([]);
  });
});

describe('화면 CSP', () => {
  const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(readFileSync(join(dir, 'index.html'), 'utf8'))?.[1] ?? '';
  const directive = (name: string): string | undefined => csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `) || d === name);

  it('스크립트는 앱 파일만, 외부 연결·프레임·플러그인·base·폼 전송은 막는다', () => {
    expect(directive('default-src')).toBe("default-src 'self'");
    expect(directive('script-src')).toBe("script-src 'self'");
    expect(directive('object-src')).toBe("object-src 'none'");
    expect(directive('base-uri')).toBe("base-uri 'none'");
    expect(directive('form-action')).toBe("form-action 'none'");
    expect(directive('frame-src')).toBe("frame-src 'none'");
  });

  it('스크립트에 unsafe-inline·unsafe-eval·원격 주소를 허용하지 않는다', () => {
    expect(directive('script-src') ?? '').not.toMatch(/unsafe|https?:|\*/);
    expect(csp).not.toMatch(/unsafe-eval|https?:\/\/|\*/);
  });

  it('그림은 앱 파일과 data: 주소만 허용한다(이미지 뷰어가 data: URL을 쓴다)', () => {
    expect(directive('img-src')).toBe("img-src 'self' data:");
  });
});
