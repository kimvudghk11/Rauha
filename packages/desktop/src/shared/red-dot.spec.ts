import { describe, expect, it } from 'vitest';
import { redDotBitmap, withRedDot } from './red-dot.js';

const px = (b: Uint8Array, w: number, x: number, y: number) => Array.from(b.slice((y * w + x) * 4, (y * w + x) * 4 + 4));

describe('빨간 점 그리기', () => {
  it('오른쪽 위에 빨간 점을 그리고 왼쪽 아래는 그대로 둔다(원본은 바꾸지 않는다)', () => {
    const src = new Uint8Array(16 * 16 * 4).fill(10);
    const out = withRedDot(src, 16, 16);
    expect(px(out, 16, 12, 4)).toEqual([0x35, 0x39, 0xe5, 0xff]);
    expect(px(out, 16, 1, 14)).toEqual([10, 10, 10, 10]);
    expect(px(src, 16, 12, 4)).toEqual([10, 10, 10, 10]);
  });

  it('점만 있는 아이콘은 가운데가 빨갛고 모서리는 투명하다', () => {
    const b = redDotBitmap(16);
    expect(px(b, 16, 8, 8)[2]).toBe(0xe5);
    expect(px(b, 16, 0, 15)[3]).toBe(0);
  });
});
