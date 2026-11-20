import type { WakeMatch } from './wake-match.js';

/** 말 한 덩어리를 들었을 때 할 일 */
export type EarAction = 'ignore' | 'sample' | 'wake' | 'wake-with-command' | 'confirm' | 'command';

/** 이름이 깨어난 뒤 명령을 기다리는 시간 */
export const AWAIT_MS = 8000;
/** 이 값보다 덜 비슷하면 받아써 볼 것도 없이 무시한다 */
const MAYBE_SCORE = 1.8;
/** 녹음이 없을 때 받아써서 이름을 찾아보는 가장 긴 말 */
const CONFIRM_MAX_MS = 8000;

/** 델피의 귀: 지금 무엇을 기다리는지(평소·이름 녹음 중·명령 기다림)에 따라 들은 말을 가른다 */
export class Ear {
  private constructor(
    readonly training: boolean,
    private readonly awaitUntil: number,
  ) {}

  static idle(): Ear {
    return new Ear(false, 0);
  }

  /** match 는 녹음과 견준 결과(녹음이 없으면 null), ms 는 말 길이 */
  hear(now: number, match: WakeMatch | null, ms: number): EarAction {
    if (this.training) return 'sample';
    if (now < this.awaitUntil) return 'command';
    if (match === null) return ms <= CONFIRM_MAX_MS ? 'confirm' : 'ignore';
    if (match.hit) return match.rest ? 'wake-with-command' : 'wake';
    return match.score < MAYBE_SCORE ? 'confirm' : 'ignore';
  }

  isAwaiting(now: number): boolean {
    return now < this.awaitUntil;
  }

  /** 이름을 내 목소리로 녹음하기 시작 */
  train(): Ear {
    return new Ear(true, 0);
  }

  /** 깨어나서 명령을 기다린다 */
  awaitCommand(now: number): Ear {
    return new Ear(false, now + AWAIT_MS);
  }

  /** 기다림·녹음을 마치고 평소로 */
  done(): Ear {
    return Ear.idle();
  }
}
