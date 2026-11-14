import { CHARACTER_SET_IDS, DEFAULT_CHARACTER_SET, toCharacterSetId, type CharacterSetId } from '../../shared/character-set-ids.js';
import type { CharacterRole } from '../characters.js';
import { PIXEL_CHARACTERS, type PixelCharacter } from '../characters-data.js';
import { FARM_CHARACTERS } from './farm.js';
import { FOREST_CHARACTERS } from './forest.js';
import { SPACE_CHARACTERS } from './space.js';
import { CAFE_CHARACTERS } from './cafe.js';
import { FANTASY_CHARACTERS } from './fantasy.js';
import { OFFICE_CHARACTERS } from './office.js';
import { SCHOOL_CHARACTERS } from './school.js';

/** 캐릭터 테마. 세트에 없는 역할은 기본(바다) 세트의 그 역할로 되돌아간다. */
export interface CharacterSet {
  readonly id: CharacterSetId;
  readonly name: string;
  readonly blurb: string;
  readonly characters: Partial<Record<CharacterRole, PixelCharacter>>;
}

export const OCEAN_SET: CharacterSet = { id: 'ocean', name: '바다 친구들', blurb: '돌고래 Delfi가 이끄는 바다 친구들이에요.', characters: PIXEL_CHARACTERS };
export const FOREST_SET: CharacterSet = { id: 'forest', name: '숲속 친구들', blurb: '숲에 사는 동물 친구들이 팀을 꾸려요.', characters: FOREST_CHARACTERS };
export const FARM_SET: CharacterSet = { id: 'farm', name: '농장 친구들', blurb: '젖소 음메가 이끄는 외양간과 들판의 친구들이에요.', characters: FARM_CHARACTERS };
export const SPACE_SET: CharacterSet = { id: 'space', name: '우주 친구들', blurb: '우주 고양이 코스모와 별 사이를 여행하는 친구들이에요.', characters: SPACE_CHARACTERS };

// 사람 캐릭터 컨셉
export const OFFICE_SET: CharacterSet = { id: 'office', name: '사무실 사람들', blurb: '한결 팀장과 개발자·QA·디자이너가 한 사무실에서 일해요.', characters: OFFICE_CHARACTERS };
export const FANTASY_SET: CharacterSet = { id: 'fantasy', name: '판타지 길드', blurb: '길드마스터 아서와 궁수·마법사·기사가 퀘스트를 나눠 맡아요.', characters: FANTASY_CHARACTERS };
export const SCHOOL_SET: CharacterSet = { id: 'school', name: '학교 동아리', blurb: '반장과 방송부·미술부·과학부 친구들이 함께해요.', characters: SCHOOL_CHARACTERS };
export const CAFE_SET: CharacterSet = { id: 'cafe', name: '카페·주방 사람들', blurb: '지배인과 바리스타·셰프·파티시에가 주문을 처리해요.', characters: CAFE_CHARACTERS };

const SETS: Readonly<Record<CharacterSetId, CharacterSet>> = { ocean: OCEAN_SET, forest: FOREST_SET, farm: FARM_SET, space: SPACE_SET, office: OFFICE_SET, fantasy: FANTASY_SET, school: SCHOOL_SET, cafe: CAFE_SET };

/** 레지스트리: 설정 화면에 보이는 순서 */
export const CHARACTER_SETS: readonly CharacterSet[] = CHARACTER_SET_IDS.map((id) => SETS[id]);
export const DEFAULT_SET: CharacterSet = SETS[DEFAULT_CHARACTER_SET];

/** id로 세트를 얻는다. 모르는 id면 기본 세트. */
export const characterSetById = (id: unknown): CharacterSet => SETS[toCharacterSetId(id)];
