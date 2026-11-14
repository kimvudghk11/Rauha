import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 공통 UI 규칙(ui.css)을 글로 검사한다. jsdom에는 레이아웃이 없어서 높이를 직접 잴 수 없으므로,
 * "같은 종류 부품은 같은 단계 토큰의 높이를 쓰고, 글자는 flex로 세로 가운데에 놓이며, 탭마다 따로 덮어쓰지 않는다"를 CSS 글자로 확인한다.
 * 실제 숫자는 scripts/measure-ui.cjs(숨김 창 측정)로 잰다.
 */
const dir = fileURLToPath(new URL('.', import.meta.url));
const read = (name: string): string => readFileSync(join(dir, name), 'utf8');

interface Rule {
  readonly selector: string;
  readonly decls: Readonly<Record<string, string>>;
}

/** 괄호 밖의 쉼표로만 선택자를 나눈다 */
function splitTop(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** 아주 단순한 CSS 읽기: 주석 제거, @media 안쪽 펼치기, @keyframes 건너뛰기 */
function parseCss(text: string): Rule[] {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Rule[] = [];
  const walk = (s: string): void => {
    let i = 0;
    while (i < s.length) {
      const open = s.indexOf('{', i);
      if (open === -1) return;
      let depth = 1;
      let j = open + 1;
      while (j < s.length && depth > 0) {
        if (s[j] === '{') depth++;
        else if (s[j] === '}') depth--;
        j++;
      }
      const prelude = s.slice(i, open).trim();
      const body = s.slice(open + 1, j - 1);
      if (prelude.startsWith('@')) {
        if (!prelude.startsWith('@keyframes')) walk(body);
      } else {
        const decls: Record<string, string> = {};
        for (const part of body.split(';')) {
          const k = part.indexOf(':');
          if (k > 0) decls[part.slice(0, k).trim()] = part.slice(k + 1).trim();
        }
        for (const sel of splitTop(prelude)) rules.push({ selector: sel.trim().replace(/\s+/g, ' '), decls });
      }
      i = j;
    }
  };
  walk(src);
  return rules;
}

const ui = parseCss(read('ui.css'));
const rule = (selector: string): Readonly<Record<string, string>> => {
  const found = ui.filter((r) => r.selector === selector);
  expect(found.length, `ui.css에 ${selector} 규칙이 있어야 한다`).toBeGreaterThan(0);
  return Object.assign({}, ...found.map((r) => r.decls));
};

const otherCss = readdirSync(dir).filter((f) => f.endsWith('.css') && f !== 'ui.css');

/** 아직 공통 부품으로 옮기지 못한 CSS 파일. 화면을 하나씩 옮길 때마다 여기서 뺀다(끝나면 비어야 한다). */
const NOT_MIGRATED: readonly string[] = [];

describe('공통 토큰', () => {
  const root = rule(':root');
  it('조작 부품 높이는 24 · 28 · 32 세 단계다', () => {
    expect([root['--h-sm'], root['--h-md'], root['--h-lg']]).toEqual(['24px', '28px', '32px']);
  });
  it('간격 단계는 4 · 8 · 12 · 16 · 24다', () => {
    expect([root['--s1'], root['--s2'], root['--s3'], root['--s4'], root['--s5']]).toEqual(['4px', '8px', '12px', '16px', '24px']);
  });
  it('글자 크기 단계는 12 · 13 · 14 · 16이다(작은 글자가 읽기 어렵다는 피드백으로 한 단계씩 키움)', () => {
    expect([root['--fs-xs'], root['--fs-sm'], root['--fs-md'], root['--fs-lg']]).toEqual(['12px', '13px', '14px', '16px']);
  });
});

describe('버튼', () => {
  it('높이는 단계 토큰에서만 온다: 기본 28, 작게 24, 크게 32', () => {
    expect(rule('.btn').height).toBe('var(--h-md)');
    expect(rule('.btn.sm').height).toBe('var(--h-sm)');
    expect(rule('.btn.lg').height).toBe('var(--h-lg)');
  });
  it('글자는 flex로 가운데에 놓이고 위아래 안쪽 여백은 0이라 한쪽으로 쏠리지 않는다', () => {
    const b = rule('.btn');
    expect(b['display']).toBe('inline-flex');
    expect(b['align-items']).toBe('center');
    expect(b['justify-content']).toBe('center');
    expect(b['line-height']).toBe('1');
    expect(b['padding']?.split(' ')[0]).toBe('0');
    expect(rule('.btn.sm')['padding']?.split(' ')[0]).toBe('0');
    expect(rule('.btn.lg')['padding']?.split(' ')[0]).toBe('0');
  });
  it('강조·실행·위험·테두리 없음은 색만 바꾸고 크기는 건드리지 않는다', () => {
    for (const s of ['.btn.primary', '.btn.run', '.btn.danger', '.btn.ghost']) {
      const d = rule(s);
      for (const k of ['height', 'padding', 'font-size', 'line-height']) expect(d[k], `${s}의 ${k}`).toBeUndefined();
    }
  });
});

describe('실행 단추(초록)', () => {
  const root = rule(':root');
  it('실행 색은 --run · --run-hover · --on-run 토큰이고, 저장·확인(파랑)·위험(빨강)과 다른 색이다', () => {
    for (const k of ['--run', '--run-hover', '--on-run']) expect(root[k], k).toMatch(/^#[0-9a-f]{6}$/i);
    const blue = parseCss(read('styles.css')).find((r) => r.selector === ':root')?.decls['--accent'];
    expect(root['--run']).not.toBe(blue);
    expect(root['--run']).not.toBe(root['--danger-border']);
  });
  it('실행 색 위 글자는 대비 4.5 이상이다', () => {
    const lum = (hex: string): number => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    };
    const ratio = (a: string, b: string): number => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (x! + 0.05) / (y! + 0.05);
    };
    expect(ratio(root['--run']!, root['--on-run']!)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(root['--run-hover']!, root['--on-run']!)).toBeGreaterThanOrEqual(4.5);
  });
  it('.btn.run은 실행 토큰만 쓴다', () => {
    const r = rule('.btn.run');
    expect(r['background']).toBe('var(--run)');
    expect(r['color']).toBe('var(--on-run)');
    expect(rule('.btn.run:hover:not(:disabled)')['background']).toBe('var(--run-hover)');
  });
  it('Send · Run · Start · Up 단추는 run이고 primary(파랑)를 쓰지 않는다', () => {
    const ts = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'));
    const bad: string[] = [];
    let seen = 0;
    for (const file of ts) {
      for (const m of read(file).matchAll(/\(\s*'(Send|Run|Start|Up)'\s*,\s*'(btn[^']*)'/g)) {
        seen++;
        const words = m[2]!.split(/\s+/);
        if (!words.includes('run') || words.includes('primary')) bad.push(`${file}: ${m[0]}`);
      }
    }
    expect(seen).toBeGreaterThan(0);
    expect(bad).toEqual([]);
  });
});

describe('탭 머리·빈 상태', () => {
  it('탭 머리(.rhead)는 기본 높이(28)·간격 12·제목 15 한 가지다', () => {
    const h = rule('.rhead');
    expect(h['min-height']).toBe('var(--h-md)');
    expect(h['display']).toBe('flex');
    expect(h['align-items']).toBe('center');
    expect(rule('.rhead > b')['font-size']).toBe('var(--fs-lg)');
  });
  it('빈 상태·확인 중·문제는 .empty-state 한 부품이다(제목 15, 실패면 빨강)', () => {
    expect(rule('.empty-state')['display']).toBe('flex');
    expect(rule('.empty-state > b')['font-size']).toBe('var(--fs-lg)');
    expect(rule('.empty-state.failed > b')['color']).toBe('var(--red)');
  });
  it('키보드 포커스 링은 --focus 토큰 하나다', () => {
    expect(rule(':root')['--focus']).toBe('var(--accentfg)');
    expect(rule('.btn:focus-visible')['outline']).toContain('var(--focus)');
    expect(rule('.row-item:focus-visible')['outline']).toContain('var(--focus)');
  });
});

describe('입력칸·탭·칩은 같은 높이 단계를 쓴다', () => {
  it('한 줄 입력칸과 select는 버튼과 같은 기본 높이다', () => {
    expect(ui.some((r) => r.selector.startsWith(':where(input') && r.decls['height'] === 'var(--h-md)')).toBe(true);
  });
  it('작은 입력칸은 작은 버튼과 같은 높이다', () => {
    expect(rule('input.sm').height).toBe('var(--h-sm)');
  });
  it('탭은 크게(32) 단계이고 글자는 가운데다', () => {
    const t = rule('.tab');
    expect(t['height']).toBe('var(--h-lg)');
    expect(t['display']).toBe('inline-flex');
    expect(t['align-items']).toBe('center');
  });
  it('칩 높이는 한 가지다', () => {
    expect(rule('.chip').height).toBe('20px');
  });
});

describe('탭마다 공통 부품을 덮어쓰지 않는다', () => {
  const SHARED = ['btn', 'chip', 'tab', 'tabs', 'seg', 'link', 'item', 'row-item', 'notice'];
  const LOOK = /^(height|min-height|max-height|padding(-.+)?|font-size|line-height|font-weight|background(-.+)?|border(-.+)?|color)$/;

  for (const file of otherCss.filter((f) => !NOT_MIGRATED.includes(f))) {
    it(`${file}는 공통 부품의 겉모양(크기·여백·색)을 다시 정하지 않는다`, () => {
      const bad = parseCss(read(file)).filter((r) => {
        const last = r.selector.split(/[\s>+~]+/).pop() ?? '';
        const classes = last.match(/\.[a-z][\w-]*/g)?.map((c) => c.slice(1)) ?? [];
        return classes.some((c) => SHARED.includes(c)) && Object.keys(r.decls).some((k) => LOOK.test(k));
      });
      expect(bad.map((r) => r.selector)).toEqual([]);
    });
  }

  it('.dim .hint .err .mono .lbl .btns 같은 공통 이름은 ui.css에서만 정의한다(다른 파일에서는 앞에 부모를 붙인 변형만)', () => {
    const NAMES = ['.dim', '.faint', '.hint', '.err', '.mono', '.lbl', '.btns', '.pad', '.rhead', '.rhead b', '.empty-state'];
    const bad: string[] = [];
    for (const file of otherCss.filter((f) => !NOT_MIGRATED.includes(f))) for (const r of parseCss(read(file))) if (NAMES.includes(r.selector)) bad.push(`${file} ${r.selector}`);
    expect(bad).toEqual([]);
  });

  it('.sec처럼 부품 이름과 겹치는 한 글자 선택자를 따로 쓰지 않는다(.btn.sec 충돌 재발 방지)', () => {
    const bad: string[] = [];
    for (const file of otherCss) for (const r of parseCss(read(file))) if (/(^|[\s>])\.sec($|[\s.:>])/.test(r.selector)) bad.push(`${file} ${r.selector}`);
    expect(bad).toEqual([]);
  });
});

describe('색 글자(#rrggbb)', () => {
  /** 토큰이 아닌 색은 그림 같은 곳(diff·무대·말풍선·그림자·계정 줄)에서만 직접 쓴다. 새 색은 토큰으로 먼저 더한다. */
  const ALLOWED = new Set(['#17283a', '#0f1b28', '#2a2620', '#0c2a44', '#0e4f7f', '#1c2a38', '#17301c', '#12261a', '#2a1717', '#2f4a63', '#3fb27f', '#d9a441', '#ea5c0055', '#00000040', '#000a', '#000c', '#0008', '#0009', '#555']);
  for (const file of otherCss.filter((f) => f !== 'styles.css')) {
    it(`${file}는 토큰에 없는 색을 새로 쓰지 않는다`, () => {
      const found = new Set(read(file).replace(/\/\*[\s\S]*?\*\//g, '').match(/#[0-9a-fA-F]{3,8}\b/g) ?? []);
      expect([...found].filter((c) => !ALLOWED.has(c.toLowerCase()) && !ALLOWED.has(c))).toEqual([]);
    });
  }
});

describe('버튼 클래스 이름', () => {
  const ALLOWED = new Set(['btn', 'primary', 'run', 'danger', 'ghost', 'sm', 'lg', 'icon', 'block']);
  const ts = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'));
  it('btn 뒤에는 공통 변형(primary run danger ghost sm lg icon block)과 위치용 이름만 오고, 색 종류는 하나만 붙는다', () => {
    const unknownModifiers: string[] = [];
    for (const file of ts) {
      for (const m of read(file).matchAll(/['`"]btn((?: [a-z][\w-]*)*)['`"]/g)) {
        const words = (m[1] ?? '').trim().split(/\s+/).filter((w) => w !== '');
        if (words.includes('sec')) unknownModifiers.push(`${file}: btn sec (보조는 기본 모양이라 sec를 붙이지 않는다)`);
        const kinds = words.filter((w) => ALLOWED.has(w));
        if (kinds.filter((w) => ['primary', 'run', 'danger', 'ghost'].includes(w)).length > 1) unknownModifiers.push(`${file}: ${m[0]}`);
      }
    }
    expect(unknownModifiers).toEqual([]);
  });
});

describe('CSP(style-src)와 인라인 스타일', () => {
  const ts = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'));
  it('화면 코드는 style 속성 문자열·style 태그를 만들지 않는다(element.style.x = … 와 클래스·CSS 변수만 쓴다)', () => {
    const bad: string[] = [];
    for (const file of ts) {
      const text = read(file);
      if (/setAttribute\(\s*['"`]style['"`]/.test(text)) bad.push(`${file}: setAttribute('style')`);
      if (/style\s*=\s*\?["']/.test(text.replace(/\/\/.*$/gm, ''))) bad.push(`${file}: style="…" 문자열`);
      if (/createElement\(\s*['"`]style['"`]/.test(text)) bad.push(`${file}: <style> 만들기`);
    }
    expect(bad).toEqual([]);
  });
});

describe('hidden 속성', () => {
  it('display를 가진 부품(.btn 등)도 hidden이면 항상 사라진다', () => {
    const rule = parseCss(read('ui.css')).find((r) => r.selector === '[hidden]');
    expect(rule?.decls['display']).toMatch(/^none\s*!important$/);
  });
});

describe('글자 크기와 화면 여백 토큰', () => {
  /** 탭 CSS의 글자 크기는 --fs-* 단계만 쓴다(왼쪽 막대 라벨 9.5·아이콘 9·제목 입력 22·인사말 16은 예외). */
  const OK_PX = new Set(['9px', '9.5px', '16px', '22px']);
  for (const file of otherCss.filter((f) => !NOT_MIGRATED.includes(f))) {
    it(`${file}는 글자 크기를 --fs-* 토큰으로만 정한다`, () => {
      const found = [...read(file).replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/font-size:\s*([0-9.]+px)/g)].map((m) => m[1]!);
      expect(found.filter((v) => !OK_PX.has(v))).toEqual([]);
    });
  }

  it('탭 바깥 여백은 --page-pad 하나로 정한다(탭마다 8·12를 따로 쓰지 않는다)', () => {
    const ui = read('ui.css');
    expect(ui).toMatch(/--page-pad:\s*var\(--s3\)/);
    expect(ui).toMatch(/\.app\[data-tier=xs\]\s*\{\s*--page-pad:\s*var\(--s2\)/);
    for (const file of ['chat.css', 'data-tabs.css', 'commands.css', 'git.css', 'code.css']) expect(read(file), file).toContain('var(--page-pad)');
  });

  it('칸 머리줄은 --h-head(36) 하나를 쓴다', () => {
    expect(read('ui.css')).toMatch(/--h-head:\s*36px/);
    for (const file of ['styles.css', 'code.css', 'git.css']) expect(read(file), file).toContain('var(--h-head)');
  });
});
