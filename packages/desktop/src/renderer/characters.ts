import { PIXEL_CHARACTERS } from './characters-data.js';

/**
 * 캐릭터 그림. 화면은 "역할 → 그림"을 이 파일의 spriteFor 한 곳에서만 얻는다.
 * 지금은 픽셀 격자 데이터이고, 나중에 수채화 PNG로 바꿀 때는 pixel-art.ts 대신 같은 CharacterArt를 구현한 공급자를 끼운다.
 * 역할 id는 core의 MemberRole과 같다(intake = Delfi, 팀장).
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

export function spriteFor(role: CharacterRole): Sprite {
  const c = PIXEL_CHARACTERS[role]!;
  return { name: c.name, animal: c.animal, palette: c.colors, frames: c.frames };
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
