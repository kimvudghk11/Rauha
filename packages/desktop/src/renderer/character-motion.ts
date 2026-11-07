import { FRAME, type CharacterState } from './characters.js';

export interface Motion {
  readonly dx: number;
  readonly dy: number;
  readonly frame: number;
  /** 걷기에서 방향이 뒤집혔는지(null이면 그대로) */
  readonly flip: boolean | null;
}

/**
 * 상태마다 한 걸음(tick)에 몸이 어디로 얼마나 움직이고 어떤 프레임인지. 그림과 상관없는 순수 계산이다.
 * 일함 통통, 생각 좌우로 갸웃, 기다림 가끔 폴짝, 끝 점프, 멈춤 떨림, 쉼 잠, 걷기 왕복.
 */
export function motionFor(state: CharacterState, tick: number, seed = 0): Motion {
  const t = tick + seed * 3;
  const blink = t % 30 < 2 ? FRAME.blink : FRAME.idle;
  switch (state) {
    case 'walk': {
      const m = Math.floor(t / 3) % 16;
      return { dx: m < 8 ? m - 4 : 12 - m, dy: (t >> 1) & 1 ? -1 : 0, frame: blink, flip: m >= 8 };
    }
    case 'work':
      return { dx: 0, dy: (t >> 1) & 1 ? -1 : 0, frame: blink, flip: null };
    case 'think':
      return { dx: [0, 1, 0, -1][(t >> 2) & 3]!, dy: 0, frame: blink, flip: null };
    case 'wait':
      return { dx: 0, dy: t % 12 < 2 ? -1 : 0, frame: blink, flip: null };
    case 'done':
      return { dx: 0, dy: [0, -1, -2, -3, -3, -2, -1, 0, 0, 0, 0, 0][t % 12]!, frame: FRAME.happy, flip: null };
    case 'stuck':
      return { dx: t & 1, dy: 0, frame: FRAME.worry, flip: null };
    case 'rest':
      return { dx: 0, dy: 0, frame: FRAME.sleep, flip: null };
    default:
      return { dx: 0, dy: 0, frame: blink, flip: null };
  }
}
