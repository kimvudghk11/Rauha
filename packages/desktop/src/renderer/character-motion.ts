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
/** 가끔 하는 몸짓의 주기(걸음). 팀원마다(seed) 주기와 시작이 달라 같은 때 같은 몸짓을 하지 않는다 */
const quirkPeriod = (seed: number): number => 90 + ((seed * 37) % 70);

export function motionFor(state: CharacterState, tick: number, seed = 0): Motion {
  const t = tick + seed * 3;
  const blink = t % 30 < 2 ? FRAME.blink : FRAME.idle;
  // 주기의 끝 9걸음 동안만 몸짓을 한다(q 가 0~8, 그 밖에는 음수)
  const p = quirkPeriod(seed);
  const q = ((tick + seed * 53) % p) - (p - 9);
  switch (state) {
    case 'walk': {
      const m = Math.floor(t / 3) % 16;
      return { dx: m < 8 ? m - 4 : 12 - m, dy: (t >> 1) & 1 ? -1 : 0, frame: blink, flip: m >= 8 };
    }
    case 'work':
      // 일하다가 가끔 기지개처럼 높이 뛰거나(짝수 팀원), 두리번거린다(홀수 팀원)
      if (q >= 0 && q < 6) return seed % 2 === 0 ? { dx: 0, dy: [-1, -2, -3, -3, -2, -1][q]!, frame: FRAME.happy, flip: null } : { dx: 0, dy: 0, frame: blink, flip: q < 3 };
      if (q >= 6) return { dx: 0, dy: -2, frame: FRAME.happy, flip: q % 2 === 0 };
      return { dx: 0, dy: (t >> 1) & 1 ? -1 : 0, frame: blink, flip: null };
    case 'think':
      // 갸웃거리다 가끔 번뜩(기쁜 얼굴로 폴짝)
      if (q >= 0 && q < 4) return { dx: 0, dy: q < 2 ? -1 : 0, frame: FRAME.happy, flip: null };
      return { dx: [0, 1, 0, -1][(t >> 2) & 3]!, dy: 0, frame: blink, flip: null };
    case 'wait':
      // 기다리다 가끔 발 동동(좌우로 짧게)
      if (q >= 0 && q < 6) return { dx: q & 1, dy: 0, frame: blink, flip: null };
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
