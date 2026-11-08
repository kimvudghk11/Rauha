import { MEMBER_ROLES } from '@rauha/core';
import { describe, expect, it } from 'vitest';
import { CHARACTER_ROLES, defaultSprite, leadName, spriteFor, useLooks } from './characters.js';

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

  it('메인(팀장, intake)은 하늘색 돌고래 Delfi다', () => {
    const delfi = spriteFor('intake');
    expect(delfi).toMatchObject({ name: 'Delfi', animal: '돌고래' });
    expect(delfi.palette['B']).toBe('#6FBDEB');
  });

  it('사업 모델 팀원(bm)은 해달 달이다', () => {
    expect(spriteFor('bm')).toMatchObject({ name: '달이', animal: '해달' });
  });

  it('화면에 쓰는 메인의 이름은 팀장 캐릭터의 이름에서 읽는다', () => {
    expect(leadName()).toBe(spriteFor('intake').name);
  });
});

describe('팀 설정으로 바꾼 이름·캐릭터', () => {
  it('바꾸지 않으면 기본 캐릭터 그대로다', () => {
    useLooks({ names: {}, characters: {} });
    expect(spriteFor('tester')).toEqual(defaultSprite('tester'));
  });

  it('이름만 바꾸면 그림은 그대로 이름만 바뀌고, 캐릭터를 바꾸면 그 그림을 쓴다', () => {
    useLooks({ names: { tester: '깐깐이' }, characters: { reviewer: 'brand' } });
    expect(spriteFor('tester').name).toBe('깐깐이');
    expect(spriteFor('tester').frames).toEqual(defaultSprite('tester').frames);
    expect(spriteFor('reviewer').frames).toEqual(defaultSprite('brand').frames);
    expect(spriteFor('reviewer').name).toBe(defaultSprite('brand').name);
    useLooks({ names: {}, characters: {} });
  });

  it('없는 캐릭터를 가리키면 기본으로 돌아간다', () => {
    useLooks({ names: {}, characters: { tester: 'nobody' } });
    expect(spriteFor('tester')).toEqual(defaultSprite('tester'));
    useLooks({ names: {}, characters: {} });
  });
});
