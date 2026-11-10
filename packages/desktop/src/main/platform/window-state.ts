export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SavedWindow extends Rect {
  readonly maximized: boolean;
}

/** 창이 그만큼은 보여야 "보이는 위치"로 본다(픽셀). 귀퉁이만 걸친 창은 못 잡는다. */
export const MIN_VISIBLE = 120;

/** 연결된 모니터 구성의 이름표. 모니터를 뺐다 꽂으면 구성이 바뀌므로 위치를 따로 기억한다. */
export function displayKey(displays: readonly Rect[]): string {
  return displays
    .map((d) => `${d.x},${d.y},${d.width}x${d.height}`)
    .sort()
    .join('|');
}

const overlap = (a: Rect, b: Rect): { w: number; h: number } => ({
  w: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
  h: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
});

/** 어느 모니터 작업 영역에든 창이 MIN_VISIBLE 이상 걸쳐 있으면 보이는 위치다 */
export function isVisible(bounds: Rect, workAreas: readonly Rect[]): boolean {
  return workAreas.some((area) => {
    const o = overlap(bounds, area);
    return o.w >= Math.min(MIN_VISIBLE, bounds.width) && o.h >= Math.min(MIN_VISIBLE, bounds.height);
  });
}

/**
 * 저장된 창 위치를 지금 모니터 구성에 맞춘다. 보이면 그대로 쓰고, 모니터가 빠져 화면 밖이면
 * 보이는 첫 모니터(주 모니터 먼저)의 가운데로 옮기며 모니터보다 큰 창은 모니터 크기로 줄인다.
 * 저장된 값이 없으면 기본 크기를 주 모니터 가운데에 둔다. workAreas[0]은 주 모니터다.
 */
export function restoreBounds(saved: SavedWindow | null, workAreas: readonly Rect[], fallback: { width: number; height: number }): Rect & { maximized: boolean } {
  const primary = workAreas[0] ?? { x: 0, y: 0, width: fallback.width, height: fallback.height };
  const want = saved ?? { x: 0, y: 0, width: fallback.width, height: fallback.height, maximized: false };
  if (saved !== null && isVisible(saved, workAreas)) return { x: saved.x, y: saved.y, width: saved.width, height: saved.height, maximized: saved.maximized };
  const width = Math.min(want.width, primary.width);
  const height = Math.min(want.height, primary.height);
  return { x: primary.x + Math.round((primary.width - width) / 2), y: primary.y + Math.round((primary.height - height) / 2), width, height, maximized: saved?.maximized ?? false };
}

/** 저장 파일의 내용(구성 이름표 → 창). 틀린 값은 버린다. */
export function parseWindowFile(input: unknown): Readonly<Record<string, SavedWindow>> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return {};
  const out: Record<string, SavedWindow> = {};
  for (const [key, v] of Object.entries(input)) {
    if (typeof v !== 'object' || v === null) continue;
    const o = v as Record<string, unknown>;
    const nums = [o['x'], o['y'], o['width'], o['height']];
    if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n)) || (o['width'] as number) < 200 || (o['height'] as number) < 150) continue;
    out[key] = { x: o['x'] as number, y: o['y'] as number, width: o['width'] as number, height: o['height'] as number, maximized: o['maximized'] === true };
  }
  return out;
}

/**
 * 확인용 실행에서 창을 N번째 모니터(1이 주 모니터, 나머지는 그다음 순서)의 가운데에 놓는다.
 * N번째 모니터가 없거나 값이 이상하면 null(원래 위치 규칙을 그대로 쓴다).
 */
export function placeOnDisplay(n: string | undefined, workAreas: readonly Rect[], size: { width: number; height: number }): SavedWindow | null {
  const index = Number(n);
  if (!Number.isInteger(index) || index < 1) return null;
  const area = workAreas[index - 1];
  if (area === undefined) return null;
  const width = Math.min(size.width, area.width);
  const height = Math.min(size.height, area.height);
  return { x: area.x + Math.round((area.width - width) / 2), y: area.y + Math.round((area.height - height) / 2), width, height, maximized: false };
}
