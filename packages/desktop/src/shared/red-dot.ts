/** 카톡 같은 빨간 점 색(BGRA 순서로 쓴다) */
const RED = { r: 0xe5, g: 0x39, b: 0x35 };

/**
 * BGRA 비트맵(가로 width) 오른쪽 위에 빨간 점을 그린 새 비트맵. 원본은 바꾸지 않는다.
 * radius 는 점 반지름(픽셀). 점 둘레 1픽셀은 흰 테두리로 그려 어두운·밝은 바탕 모두에서 보이게 한다.
 */
export function withRedDot(bitmap: Uint8Array, width: number, height: number, radius = Math.max(2, Math.round(width * 0.22))): Uint8Array {
  const out = new Uint8Array(bitmap);
  const cx = width - radius - 1;
  const cy = radius + 1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const d = Math.hypot(x + 0.5 - (cx + 0.5), y + 0.5 - (cy + 0.5));
      if (d > radius + 1) continue;
      const i = (y * width + x) * 4;
      const ring = d > radius;
      out[i] = ring ? 0xff : RED.b;
      out[i + 1] = ring ? 0xff : RED.g;
      out[i + 2] = ring ? 0xff : RED.r;
      out[i + 3] = 0xff;
    }
  }
  return out;
}

/** 빨간 점 하나만 있는 정사각 BGRA 비트맵(작업 표시줄 덧씌움 아이콘) */
export function redDotBitmap(size: number): Uint8Array {
  return withRedDot(new Uint8Array(size * size * 4), size, size, Math.floor(size / 2) - 1);
}
