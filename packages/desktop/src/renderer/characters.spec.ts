import { MEMBER_ROLES } from '@rauha/core';
import { describe, expect, it } from 'vitest';
import { CHARACTER_ROLES, spriteFor } from './characters.js';

describe('spriteFor', () => {
  it('팀원 역할마다 캐릭터가 하나씩 있다(22종)', () => {
    expect([...CHARACTER_ROLES].sort()).toEqual([...MEMBER_ROLES].sort());
    expect(CHARACTER_ROLES.length).toBe(22);
  });

  it.each(CHARACTER_ROLES)('%s: 프레임이 다섯(기본·눈감음·기쁨·걱정·잠)이다', (role) => {
    expect(spriteFor(role).frames.length).toBe(5);
  });

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

  it('Delfi(팀장)는 하늘색 돌고래다', () => {
    const delfi = spriteFor('intake');
    expect(delfi.name).toBe('Delfi');
    expect(delfi.palette['B']).toBe('#6FBDEB');
  });
});
