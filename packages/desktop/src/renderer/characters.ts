import { EXTRA_CHARACTER_IDS } from '../shared/character-ids.js';
import { PIXEL_CHARACTERS, type PixelCharacter } from './characters-data.js';
import { EXTRA_CHARACTERS } from './characters-extra.js';

/**
 * 캐릭터 그림. 화면은 "역할 → 그림"을 이 파일의 spriteFor 한 곳에서만 얻는다.
 * 지금은 픽셀 격자 데이터이고, 나중에 수채화 PNG로 바꿀 때는 pixel-art.ts 대신 같은 CharacterArt를 구현한 공급자를 끼운다.
 * 역할 id는 core의 MemberRole과 같다(intake = 팀장, 메인 칸의 얼굴. 지금은 돌고래 Delfi).
 */
export const CHARACTER_ROLES = [
  'intake', 'tester', 'implementer', 'reviewer', 'router', 'answerer', 'surveyor', 'writer', 'designer', 'operator',
  'debugger', 'riskchecker', 'planner', 'chief', 'bm', 'marketer', 'growth', 'uxdesigner', 'brand', 'securitychecker', 'releaser', 'splitter',
] as const;
export type CharacterRole = (typeof CHARACTER_ROLES)[number];

/** 프레임 번호: 0 기본, 1 눈 감음, 2 기쁨, 3 걱정, 4 잠 */
export const FRAME = { idle: 0, blink: 1, happy: 2, worry: 3, sleep: 4 } as const;

export interface Sprite {
  readonly name: string;
  readonly animal: string;
  readonly palette: Readonly<Record<string, string>>;
  readonly frames: readonly (readonly string[])[];
}

/** 메인(팀장) 캐릭터의 이름. 화면의 안내 글은 이름을 직접 쓰지 않고 여기서 읽는다. */
export function leadName(): string {
  return spriteFor('intake').name;
}

/** 팀 설정에서 사용자가 바꾼 이름·그림(역할 → 이름, 역할 → 쓸 캐릭터). 비어 있으면 기본 그대로다. */
export interface Looks {
  readonly names: Readonly<Partial<Record<string, string>>>;
  readonly characters: Readonly<Partial<Record<string, string>>>;
}
let looks: Looks = { names: {}, characters: {} };
export function useLooks(next: Looks): void {
  looks = next;
}

/** 캐릭터 고르기 목록: base는 기본 22마리(역할 id), extra는 역할에 배정되지 않고 고를 수만 있는 새 캐릭터 */
export const CHARACTER_CHOICES = { base: [...CHARACTER_ROLES] as readonly string[], extra: [...EXTRA_CHARACTER_IDS] as readonly string[] };

const toSprite = (c: PixelCharacter): Sprite => ({ name: c.name, animal: c.animal, palette: c.colors, frames: c.frames });
const own = (table: Readonly<Record<string, PixelCharacter>>, id: string): PixelCharacter | undefined => (Object.hasOwn(table, id) ? table[id] : undefined);

/** 알려진 캐릭터 id(기본 22마리의 역할 id 또는 새 캐릭터 id)인지 */
export const isCharacterId = (id: string): boolean => own(PIXEL_CHARACTERS, id) !== undefined || own(EXTRA_CHARACTERS, id) !== undefined;

/** id로 캐릭터를 얻는다. 모르는 id면 오류(먼저 isCharacterId로 확인). */
export function characterSprite(id: string): Sprite {
  const c = own(PIXEL_CHARACTERS, id) ?? own(EXTRA_CHARACTERS, id);
  if (c === undefined) throw new Error(`없는 캐릭터: ${id}`);
  return toSprite(c);
}

/** 바꾸기 전 원래 캐릭터(역할 id 그대로) */
export function defaultSprite(role: CharacterRole): Sprite {
  return toSprite(PIXEL_CHARACTERS[role]!);
}

export function spriteFor(role: CharacterRole): Sprite {
  const picked = looks.characters[role];
  const art = picked !== undefined && isCharacterId(picked) ? characterSprite(picked) : defaultSprite(role);
  const name = looks.names[role];
  return name === undefined ? art : { ...art, name };
}

/** 캐릭터가 보이는 상태: 일함·생각·허락 기다림·끝·멈춤·쉼·걷기, 그 밖엔 가만히(idle) */
export type CharacterState = 'idle' | 'work' | 'think' | 'wait' | 'done' | 'stuck' | 'rest' | 'walk';

export interface DrawOptions {
  readonly x: number;
  readonly y: number;
  /** 한 칸의 화면 픽셀 수. 흐려지지 않게 정수만. */
  readonly scale: number;
  readonly flip?: boolean;
  /** 캐릭터마다 움직임이 어긋나게 하는 값 */
  readonly seed?: number;
  /** 말풍선·물음표 같은 덧그림 */
  readonly effects?: boolean;
}

/** 그림 공급자. 픽셀이든 PNG든 이 모양만 지키면 바꿔 끼울 수 있다. 좌표는 모두 "칸" 단위다. */
export interface CharacterArt {
  size(role: CharacterRole): { readonly w: number; readonly h: number };
  draw(ctx: CanvasRenderingContext2D, role: CharacterRole, state: CharacterState, tick: number, options: DrawOptions): void;
}
