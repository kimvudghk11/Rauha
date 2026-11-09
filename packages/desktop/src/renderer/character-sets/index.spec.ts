import { describe, expect, it } from 'vitest';
import { CHARACTER_SET_IDS } from '../../shared/character-set-ids.js';
import { CHARACTER_ROLES, spriteFor, leadName, useCharacterSet, useLooks, defaultSprite } from '../characters.js';
import { CHARACTER_SETS, characterSetById, DEFAULT_SET, FOREST_SET, OCEAN_SET } from './index.js';
import { setProblems } from './resolve.js';

describe('캐릭터 테마 레지스트리', () => {
  it('등록된 세트는 id 목록과 같고 이름·소개가 비어 있지 않다', () => {
    expect(CHARACTER_SETS.map((s) => s.id)).toEqual([...CHARACTER_SET_IDS]);
    for (const s of CHARACTER_SETS) {
      expect(s.name.trim()).not.toBe('');
      expect(s.blurb.trim()).not.toBe('');
    }
  });
  it('기본 세트는 바다 친구들이고 22역할을 모두 가진다', () => {
    expect(DEFAULT_SET).toBe(OCEAN_SET);
    for (const r of CHARACTER_ROLES) expect(OCEAN_SET.characters[r], r).toBeDefined();
  });
  it('모르는 id는 기본 세트다', () => {
    for (const bad of ['nope', 'constructor', '__proto__', 3, null]) expect(characterSetById(bad)).toBe(DEFAULT_SET);
  });
  it('세트 id는 역할 id를 키로 쓴 역할만 담는다', () => {
    for (const s of CHARACTER_SETS) for (const k of Object.keys(s.characters)) expect((CHARACTER_ROLES as readonly string[]).includes(k), `${s.id}.${k}`).toBe(true);
  });
});

describe.each(CHARACTER_SETS)('$id 세트 전체 검증(비어 있는 역할은 건너뛴다)', (set) => {
  it('이름·동물이 겹치지 않고 프레임 5개·같은 크기·팔레트 안의 글자만 쓴다', () => {
    expect(setProblems(set.characters)).toEqual([]);
  });
});

describe('숲속 친구들과 바다 친구들 사이', () => {
  it('숲 세트의 이름·동물은 바다 세트와 겹치지 않는다', () => {
    const sea = Object.values(OCEAN_SET.characters).map((c) => c!);
    for (const c of Object.values(FOREST_SET.characters)) {
      expect(sea.some((o) => o.name === c!.name), c!.name).toBe(false);
      expect(sea.some((o) => o.animal === c!.animal), c!.animal).toBe(false);
    }
  });
});

describe('세트를 고르면', () => {
  it('세트에 있는 역할은 세트 그림, 없는 역할은 기본(바다) 그림이다', () => {
    useLooks({ names: {}, characters: {} });
    useCharacterSet('forest');
    for (const r of CHARACTER_ROLES) {
      const own = FOREST_SET.characters[r];
      expect(spriteFor(r).name).toBe(own?.name ?? defaultSprite(r).name);
    }
    useCharacterSet('ocean');
  });
  it('메인의 이름은 세트의 팀장 캐릭터에서 읽는다', () => {
    useLooks({ names: {}, characters: {} });
    useCharacterSet('forest');
    expect(leadName()).toBe((FOREST_SET.characters.intake ?? OCEAN_SET.characters.intake!).name);
    useCharacterSet('ocean');
    expect(leadName()).toBe('Delfi');
  });
  it('사용자가 역할별로 고른 캐릭터와 이름이 세트보다 먼저다', () => {
    useCharacterSet('forest');
    useLooks({ names: { tester: '깐깐이' }, characters: { reviewer: 'penguin' } });
    expect(spriteFor('reviewer').animal).toBe('펭귄');
    expect(spriteFor('tester').name).toBe('깐깐이');
    useLooks({ names: {}, characters: {} });
    useCharacterSet('ocean');
  });
  it('모르는 세트 id를 주면 기본 세트가 된다', () => {
    useCharacterSet('nope');
    expect(spriteFor('intake').name).toBe('Delfi');
  });
});
