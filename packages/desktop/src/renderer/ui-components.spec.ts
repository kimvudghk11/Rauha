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

const otherCss = readdirSync(dir).filter((f) => f.endsWith('.css') && f !== 'ui.css' && f !== 'styles.css');

/** 아직 공통 부품으로 옮기지 못한 CSS 파일. 화면을 하나씩 옮길 때마다 여기서 뺀다(끝나면 비어야 한다). */
const NOT_MIGRATED: readonly string[] = ['chat.css', 'commands.css', 'data-tabs.css', 'code.css'];

describe('공통 토큰', () => {
  const root = rule(':root');
  it('조작 부품 높이는 24 · 28 · 32 세 단계다', () => {
    expect([root['--h-sm'], root['--h-md'], root['--h-lg']]).toEqual(['24px', '28px', '32px']);
  });
  it('간격 단계는 4 · 8 · 12 · 16 · 24다', () => {
    expect([root['--s1'], root['--s2'], root['--s3'], root['--s4'], root['--s5']]).toEqual(['4px', '8px', '12px', '16px', '24px']);
  });
  it('글자 크기 단계는 11 · 12 · 13 · 15다', () => {
    expect([root['--fs-xs'], root['--fs-sm'], root['--fs-md'], root['--fs-lg']]).toEqual(['11px', '12px', '13px', '15px']);
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
  it('강조·위험·테두리 없음은 색만 바꾸고 크기는 건드리지 않는다', () => {
    for (const s of ['.btn.primary', '.btn.danger', '.btn.ghost']) {
      const d = rule(s);
      for (const k of ['height', 'padding', 'font-size', 'line-height']) expect(d[k], `${s}의 ${k}`).toBeUndefined();
    }
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
    const NAMES = ['.dim', '.faint', '.hint', '.err', '.mono', '.lbl', '.btns', '.pad'];
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

describe('버튼 클래스 이름', () => {
  const ALLOWED = new Set(['btn', 'primary', 'danger', 'ghost', 'sm', 'lg', 'icon', 'block']);
  const ts = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'));
  it('btn 뒤에는 공통 변형(primary danger ghost sm lg icon block)과 위치용 이름만 온다', () => {
    const unknownModifiers: string[] = [];
    for (const file of ts) {
      for (const m of read(file).matchAll(/['`"]btn((?: [a-z][\w-]*)*)['`"]/g)) {
        const words = (m[1] ?? '').trim().split(/\s+/).filter((w) => w !== '');
        if (words.includes('sec')) unknownModifiers.push(`${file}: btn sec (보조는 기본 모양이라 sec를 붙이지 않는다)`);
        const kinds = words.filter((w) => ALLOWED.has(w));
        if (kinds.filter((w) => ['primary', 'danger', 'ghost'].includes(w)).length > 1) unknownModifiers.push(`${file}: ${m[0]}`);
      }
    }
    expect(unknownModifiers).toEqual([]);
  });
});
