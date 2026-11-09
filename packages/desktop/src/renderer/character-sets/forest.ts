import type { CharacterRole } from '../characters.js';
import type { PixelCharacter } from '../characters-data.js';
import { FOREST_A } from './forest-a.js';
import { FOREST_B } from './forest-b.js';
import { FOREST_C } from './forest-c.js';

/** 숲속 친구들: 세 조각(a·b·c)으로 나눠 그린 데이터를 한 세트로 합친다. 역할이 겹치면 뒤 조각이 이긴다. */
export const FOREST_CHARACTERS: Partial<Record<CharacterRole, PixelCharacter>> = { ...FOREST_A, ...FOREST_B, ...FOREST_C };
