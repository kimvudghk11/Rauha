import type { PetMode } from './desk-pet.js';

/** 바탕화면 델피 창이 쓰는 통로. 이 창은 'pet:' 로 시작하는 통로만 쓸 수 있다(ipc-guard) */
export const PET_IPC = {
  /** 창 → main: 말 한 덩어리(16kHz Float32Array) */
  segment: 'pet:segment',
  /** 창 → main: 마우스가 델피 위에 있는지(그 밖은 클릭이 뒤로 지나간다) */
  hover: 'pet:hover',
  click: 'pet:click',
  menu: 'pet:menu',
  /** 창 → main: 마이크를 못 열었을 때 */
  micFailed: 'pet:mic-failed',
  /** main → 창: 보일 모습 */
  view: 'pet:view',
  /** main → 창: 소리 내어 말하기 */
  speak: 'pet:speak',
} as const;

export type MicState = 'off' | 'loading' | 'on' | 'training';

export interface PetView {
  readonly mode: PetMode;
  readonly facing: 'left' | 'right';
  readonly bubble: string | null;
  /** 받아쓰는 중(생각하는 모습) */
  readonly thinking: boolean;
  readonly mic: MicState;
}

export interface PetBridge {
  sendSegment(samples: Float32Array): void;
  hover(on: boolean): void;
  click(): void;
  menu(): void;
  micFailed(reason: string): void;
  onView(listener: (view: PetView) => void): void;
  onSpeak(listener: (text: string) => void): void;
}
