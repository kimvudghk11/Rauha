import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { linesWithin, READ_CHAR_CAP } from './tool-guard.js';

describe('긴 문서 읽기 한도(글자 수)', () => {
  it('한도보다 짧으면 자르지 않는다', () => {
    expect(linesWithin('a\nb\n', READ_CHAR_CAP)).toBeNull();
  });

  it('줄이 긴 문서는 글자 한도에 닿는 줄까지만 읽게 한다', () => {
    const doc = Array.from({ length: 140 }, (_, i) => `- 규칙 ${i}: ${'긴 설명 '.repeat(20)}`).join('\n');
    const n = linesWithin(doc, READ_CHAR_CAP)!;
    expect(n).toBeLessThan(140);
    expect(doc.split('\n').slice(0, n).join('\n').length).toBeLessThanOrEqual(READ_CHAR_CAP);
  });

  it('너무 적게 자르지는 않는다(최소 20줄)', () => {
    expect(linesWithin('x'.repeat(20_000) + '\nshort', 100)).toBe(20);
  });

  it('실제 파일로도 같은 값을 낸다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cap-'));
    const p = join(dir, 'SPEC.md');
    const doc = Array.from({ length: 140 }, (_, i) => `- 규칙 ${i}: ${'긴 설명 '.repeat(20)}`).join('\n');
    writeFileSync(p, doc);
    expect(linesWithin(doc, READ_CHAR_CAP)).toBeGreaterThan(20);
  });
});
