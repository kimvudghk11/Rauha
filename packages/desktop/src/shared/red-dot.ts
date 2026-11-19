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

/** 5×7 흰 "N" 글꼴(카톡 새 소식 배지) */
const N_GLYPH = ['X...X', 'XX..X', 'XX..X', 'X.X.X', 'X..XX', 'X..XX', 'X...X'];

/**
 * 카톡 메뉴 막대 아이콘처럼 오른쪽 위에 빨간 원 + 흰 N 을 그린 새 BGRA 비트맵. 원본은 바꾸지 않는다.
 * 레티나(@2x, 32~36px) 비트맵에 쓴다: 반지름은 가로의 25%, 글자는 원 가운데 5×7.
 * 원 둘레 1.5픽셀은 투명하게 비워 아이콘과 배지가 떨어져 보이게 한다(카톡·맥 배지처럼).
 */
export function withNewBadge(bitmap: Uint8Array, width: number, height: number): Uint8Array {
  const radius = Math.round(width * 0.25);
  const out = new Uint8Array(bitmap);
  const cx = width - radius - 1;
  const cy = radius + 1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const d = Math.hypot(x - cx, y - cy);
      if (d > radius + 1.5) continue;
      out.set(d >= radius ? [0, 0, 0, 0] : [RED.b, RED.g, RED.r, 0xff], (y * width + x) * 4);
    }
  }
  const left = cx - 2;
  const top = cy - 3;
  N_GLYPH.forEach((row, dy) => {
    [...row].forEach((c, dx) => {
      if (c !== 'X') return;
      const x = left + dx;
      const y = top + dy;
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      out.set([0xff, 0xff, 0xff, 0xff], (y * width + x) * 4);
    });
  });
  return out;
}

/** 흑백(템플릿) 아이콘의 색을 한 가지 회색값(0 검정 ~ 255 흰색)으로 바꾼 새 BGRA 비트맵. 투명도는 그대로 */
export function recolored(bitmap: Uint8Array, gray: number): Uint8Array {
  const out = new Uint8Array(bitmap);
  for (let i = 0; i < out.length; i += 4) out.set([gray, gray, gray], i);
  return out;
}

/** 빨간 점 하나만 있는 정사각 BGRA 비트맵(작업 표시줄 덧씌움 아이콘) */
export function redDotBitmap(size: number): Uint8Array {
  return withRedDot(new Uint8Array(size * size * 4), size, size, Math.floor(size / 2) - 1);
}
