import { describe, expect, it } from 'vitest';
import { CHARACTER_ROLES, spriteFor } from './characters.js';

describe('spriteFor', () => {
  it.each(CHARACTER_ROLES)('%s: 모든 프레임의 줄 길이가 같다', (role) => {
    const { frames } = spriteFor(role);
    const width = frames[0]![0]!.length;
    for (const frame of frames) {
      expect(frame.length).toBe(frames[0]!.length);
      for (const row of frame) expect(row.length).toBe(width);
    }
  });

  it.each(CHARACTER_ROLES)('%s: 팔레트에 없는 글자를 쓰지 않는다', (role) => {
    const { palette, frames } = spriteFor(role);
    for (const frame of frames) for (const row of frame) for (const ch of row) if (ch !== '.') expect(palette[ch], `${role} '${ch}'`).toBeDefined();
  });

  it('Delfi는 깜빡임 프레임이 있다', () => {
    expect(spriteFor('delfi').frames.length).toBeGreaterThanOrEqual(2);
  });
});
