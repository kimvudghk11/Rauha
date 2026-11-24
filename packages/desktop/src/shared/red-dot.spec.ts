import { describe, expect, it } from 'vitest';
import { bitmapPixels, recolored, redDotBitmap, withNewBadge, withRedDot } from './red-dot.js';

const px = (b: Uint8Array, w: number, x: number, y: number) => Array.from(b.slice((y * w + x) * 4, (y * w + x) * 4 + 4));

describe('빨간 점 그리기', () => {
  it('오른쪽 위에 빨간 점을 그리고 왼쪽 아래는 그대로 둔다(원본은 바꾸지 않는다)', () => {
    const src = new Uint8Array(16 * 16 * 4).fill(10);
    const out = withRedDot(src, 16, 16);
    expect(px(out, 16, 12, 4)).toEqual([0x35, 0x39, 0xe5, 0xff]);
    expect(px(out, 16, 1, 14)).toEqual([10, 10, 10, 10]);
    expect(px(src, 16, 12, 4)).toEqual([10, 10, 10, 10]);
  });

  it('카톡처럼 오른쪽 위 빨간 원 안에 흰 N 을 그린다', () => {
    const src = new Uint8Array(32 * 32 * 4).fill(0x80);
    const out = withNewBadge(src, 32, 32);
    const r = Math.round(32 * 0.25);
    const cx = 32 - r - 1;
    const cy = r + 1;
    // N 의 왼쪽 세로획 맨 위는 흰색, 가운데 빈칸은 빨강
    expect(px(out, 32, cx - 2, cy - 3)).toEqual([0xff, 0xff, 0xff, 0xff]);
    expect(px(out, 32, cx + 1, cy - 3)).toEqual([0x35, 0x39, 0xe5, 0xff]);
    // 원 바로 바깥은 비워 아이콘과 떨어지고, 왼쪽 아래(돌고래 자리)는 그대로
    expect(px(out, 32, cx - r - 1, cy)).toEqual([0, 0, 0, 0]);
    expect(px(out, 32, 2, 30)).toEqual([0x80, 0x80, 0x80, 0x80]);
  });

  it('흑백 아이콘을 메뉴 막대 밝기에 맞는 색으로 바꾸고 투명도는 그대로 둔다', () => {
    const src = new Uint8Array([0, 0, 0, 200, 0, 0, 0, 0]);
    expect(Array.from(recolored(src, 0xff))).toEqual([0xff, 0xff, 0xff, 200, 0xff, 0xff, 0xff, 0]);
    expect(Array.from(src)).toEqual([0, 0, 0, 200, 0, 0, 0, 0]);
  });

  it('레티나 그림은 논리 크기가 아니라 바이트 수로 실제 픽셀 크기를 구한다', () => {
    // trayTemplate@2x.png: getSize() 는 18x18, toBitmap() 은 36x36 픽셀
    expect(bitmapPixels(36 * 36 * 4, { width: 18, height: 18 })).toEqual({ width: 36, height: 36, scaleFactor: 2 });
    expect(bitmapPixels(16 * 16 * 4, { width: 16, height: 16 })).toEqual({ width: 16, height: 16, scaleFactor: 1 });
    expect(bitmapPixels(0, { width: 0, height: 0 })).toBeNull();
    expect(bitmapPixels(100, { width: 16, height: 16 })).toBeNull();
  });

  it('점만 있는 아이콘은 가운데가 빨갛고 모서리는 투명하다', () => {
    const b = redDotBitmap(16);
    expect(px(b, 16, 8, 8)[2]).toBe(0xe5);
    expect(px(b, 16, 0, 15)[3]).toBe(0);
  });
});
