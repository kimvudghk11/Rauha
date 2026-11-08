import { describe, expect, it } from 'vitest';
import { isEnterKey } from './dom.js';

const key = (init: Partial<KeyboardEvent>): KeyboardEvent => ({ key: 'Enter', isComposing: false, keyCode: 13, ...init }) as KeyboardEvent;

describe('isEnterKey: 한글 입력 중 Enter가 두 번 인식되지 않게', () => {
  it('보통 Enter는 확정으로 본다', () => {
    expect(isEnterKey(key({}))).toBe(true);
  });

  it('글자를 조합하는 중(isComposing)의 Enter는 무시한다', () => {
    expect(isEnterKey(key({ isComposing: true }))).toBe(false);
  });

  it('일부 환경이 조합 중 Enter에 주는 keyCode 229도 무시한다', () => {
    expect(isEnterKey(key({ keyCode: 229 }))).toBe(false);
  });

  it('Enter가 아닌 키는 아니다', () => {
    expect(isEnterKey(key({ key: 'a' }))).toBe(false);
    expect(isEnterKey(key({ key: 'Process', keyCode: 229 }))).toBe(false);
  });
});

describe('Enter로 확정하는 모든 입력칸은 같은 판정을 쓴다', () => {
  it("렌더러 소스에 e.key === 'Enter' 직접 비교가 남아 있지 않다", async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const dir = dirname(fileURLToPath(import.meta.url));
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts') && f !== 'dom.ts')
      .filter((f) => /\.key\s*(===|!==)\s*'Enter'/.test(readFileSync(join(dir, f), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
