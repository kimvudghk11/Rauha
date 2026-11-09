import { MEMBER_ROLES } from '@rauha/core';
import { describe, expect, it } from 'vitest';
import { CHARACTER_CHOICES, CHARACTER_ROLES, characterSprite, defaultSprite, leadName, spriteFor, useLooks } from './characters.js';
import { PIXEL_CHARACTERS } from './characters-data.js';
import { EXTRA_CHARACTERS } from './characters-extra.js';
import { EXTRA_CHARACTER_IDS } from '../shared/character-ids.js';

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

describe('고를 수 있는 캐릭터(역할에 기본 배정되지 않는 새 캐릭터)', () => {
  const ids = [...EXTRA_CHARACTER_IDS];
  const base = Object.values(PIXEL_CHARACTERS);

  it('새 캐릭터는 열 마리이고 id 목록과 그림 데이터의 키가 같다', () => {
    expect(ids.length).toBe(10);
    expect(Object.keys(EXTRA_CHARACTERS).sort()).toEqual([...ids].sort());
  });

  it('새 캐릭터의 id는 역할 id와 겹치지 않는다', () => {
    for (const id of ids) expect((CHARACTER_ROLES as readonly string[]).includes(id), id).toBe(false);
  });

  it.each(ids)('%s: 이름과 동물이 비어 있지 않다', (id) => {
    const c = EXTRA_CHARACTERS[id]!;
    expect(c.name.trim()).not.toBe('');
    expect(c.animal.trim()).not.toBe('');
  });

  it('새 캐릭터의 이름·동물은 기존 22마리와도 서로와도 겹치지 않는다', () => {
    const all = [...base, ...ids.map((id) => EXTRA_CHARACTERS[id]!)];
    expect(new Set(all.map((c) => c.name)).size).toBe(all.length);
    expect(new Set(all.map((c) => c.animal)).size).toBe(all.length);
  });

  it.each(ids)('%s: 프레임이 다섯이고 모든 프레임의 크기가 기본 캐릭터와 같은 격자 규칙(같은 크기)이다', (id) => {
    const { frames } = EXTRA_CHARACTERS[id]!;
    expect(frames.length).toBe(5);
    const width = frames[0]![0]!.length;
    expect(width).toBeLessThanOrEqual(16);
    for (const frame of frames) {
      expect(frame.length).toBe(frames[0]!.length);
      for (const row of frame) expect(row.length).toBe(width);
    }
  });

  it.each(ids)('%s: 팔레트에 없는 글자를 쓰지 않는다', (id) => {
    const { colors, frames } = EXTRA_CHARACTERS[id]!;
    for (const frame of frames) for (const row of frame) for (const ch of row) if (ch !== '.') expect(colors[ch], `${id} '${ch}'`).toBeDefined();
  });

  it('새 캐릭터를 고르면 그 그림을 쓰고, 이름은 그대로 읽는다', () => {
    useLooks({ names: {}, characters: { tester: 'penguin' } });
    expect(spriteFor('tester')).toMatchObject({ name: EXTRA_CHARACTERS['penguin']!.name, animal: '펭귄' });
    expect(characterSprite('frog').animal).toBe('개구리');
    useLooks({ names: {}, characters: {} });
  });

  it('모르는 id가 저장돼 있으면 기본 캐릭터로 돌아간다(prototype 이름도 포함)', () => {
    for (const bad of ['nobody', 'constructor', 'toString', '__proto__']) {
      useLooks({ names: {}, characters: { tester: bad } });
      expect(spriteFor('tester')).toEqual(defaultSprite('tester'));
    }
    useLooks({ names: {}, characters: {} });
  });

  it('고르기 목록은 기본 22마리와 새 캐릭터를 나눠 보여 준다', () => {
    expect(CHARACTER_CHOICES.base).toEqual([...CHARACTER_ROLES]);
    expect(CHARACTER_CHOICES.extra).toEqual(ids);
  });
});
