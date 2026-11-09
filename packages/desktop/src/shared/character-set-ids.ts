/**
 * 캐릭터 테마(세트)의 id. 그림 데이터는 renderer/character-sets에 있고,
 * 저장된 설정의 검증(parseSettings)이 이 목록으로 알려진 id를 알아본다.
 */
export const CHARACTER_SET_IDS = ['ocean', 'forest'] as const;
export type CharacterSetId = (typeof CHARACTER_SET_IDS)[number];
/** 기본 세트: 바다 친구들(팀장 Delfi) */
export const DEFAULT_CHARACTER_SET: CharacterSetId = 'ocean';

/** 저장된 값에서 알려진 세트 id를 고른다. 모르는 값(prototype 이름 포함)은 기본 세트다. */
export const toCharacterSetId = (v: unknown): CharacterSetId => (CHARACTER_SET_IDS as readonly unknown[]).includes(v) ? (v as CharacterSetId) : DEFAULT_CHARACTER_SET;
