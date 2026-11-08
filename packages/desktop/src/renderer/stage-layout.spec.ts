import { describe, expect, it } from 'vitest';
import { layoutRow } from './stage-layout.js';

describe('캐릭터 줄 배치', () => {
  const overlaps = (xs: readonly number[], widths: readonly number[]) => xs.some((x, i) => i > 0 && x < xs[i - 1]! + widths[i - 1]!);
  it('칸 수를 아직 모르는 0이어도 서로 겹치지 않는다(첫 작업 배정 때 몰려 있던 문제)', () => {
    const widths = [14, 14, 14, 14];
    const r = layoutRow(0, widths);
    expect(overlaps(r.xs, widths)).toBe(false);
    expect(r.cols).toBeGreaterThanOrEqual(80);
  });
  it('넓으면 고르게 선다', () => {
    const r = layoutRow(100, [10, 10]);
    expect(r.cols).toBe(100);
    expect(r.xs[1]! - r.xs[0]!).toBeGreaterThanOrEqual(33);
  });
  it('NaN도 안전하다', () => {
    expect(layoutRow(Number.NaN, [10]).xs).toHaveLength(1);
  });
});
