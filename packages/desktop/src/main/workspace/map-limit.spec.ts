import { describe, expect, it } from 'vitest';
import { mapLimit } from './map-limit.js';

describe('mapLimit', () => {
  it('결과는 넣은 순서 그대로이고, 동시에 도는 일은 한도를 넘지 않는다', async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit([5, 1, 4, 2, 3, 6, 7], 3, async (n) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, n));
      running -= 1;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 40, 20, 30, 60, 70]);
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  it('빈 목록은 빈 결과이고, 한 일이 실패하면 그 실패를 그대로 던진다', async () => {
    expect(await mapLimit([], 4, async (x: number) => x)).toEqual([]);
    await expect(mapLimit([1, 2], 2, async (n) => { if (n === 2) throw new Error('깨짐'); return n; })).rejects.toThrow('깨짐');
  });
});
