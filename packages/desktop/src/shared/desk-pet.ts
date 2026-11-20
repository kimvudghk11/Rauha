/**
 * 바탕화면을 돌아다니는 델피(작은 투명 창)의 움직임 규칙. 화면 그리기·창 옮기기와 상관없는 순수 계산이다.
 * pos 는 창의 왼쪽 위 좌표(화면 픽셀). 상태는 메서드로만 바뀌고, 바뀔 때마다 새 값을 돌려준다.
 */
export type PetMode = 'pause' | 'roam' | 'nap' | 'listen' | 'work' | 'cheer';

export interface PetPoint {
  readonly x: number;
  readonly y: number;
}
export interface PetArea {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
export interface PetSize {
  readonly width: number;
  readonly height: number;
}

/** 걷는 빠르기(초당 픽셀) */
const SPEED = 70;
/** 한 번에 움직이는 시간의 끝(창이 멈췄다 깨어나도 순간 이동하지 않게) */
const MAX_STEP_MS = 200;
const LISTEN_MS = 8000;
const CHEER_MS = 4000;
const NAP_MS = 20_000;
const NAP_CHANCE = 0.15;

interface Bubble {
  readonly text: string;
  readonly until: number;
}

export class DeskPet {
  private constructor(
    readonly area: PetArea,
    readonly size: PetSize,
    readonly pos: PetPoint,
    readonly target: PetPoint | null,
    readonly mode: PetMode,
    readonly facing: 'left' | 'right',
    private readonly until: number,
    private readonly at: number,
    private readonly speech: Bubble | null,
  ) {}

  /** 처음 나타날 때: 오른쪽 아래(작업표시줄 바로 위)에 서서 잠깐 쉰다 */
  static enter(area: PetArea, size: PetSize, now: number): DeskPet {
    const pos = { x: area.x + area.width - size.width - 40, y: area.y + area.height - size.height };
    return new DeskPet(area, size, clampTo(area, size, pos), null, 'pause', 'left', now + 4000, now, null);
  }

  /** 시간이 흐른 만큼 움직인다. rand 는 0~1 사이 값을 주는 함수(시험에서는 고정 값) */
  step(now: number, rand: () => number): DeskPet {
    const dt = Math.max(0, Math.min(MAX_STEP_MS, now - this.at));
    if (this.mode === 'roam' && this.target !== null) return this.walk(now, dt, this.target, rand);
    if (this.timed() && now >= this.until) return this.mode === 'pause' || this.mode === 'nap' ? this.roamTo(now, rand) : this.rest(now, rand);
    return this.with({ at: now });
  }

  /** "델피~" 하고 부르면 그 자리에 멈춰 듣는다(일하는 중이어도 들어 준다) */
  call(now: number): DeskPet {
    return this.with({ mode: 'listen', target: null, until: now + LISTEN_MS, at: now });
  }

  /** 맡은 일이 있으면 그 자리에서 일 모드로 */
  working(now: number): DeskPet {
    if (this.mode === 'work') return this;
    return this.with({ mode: 'work', target: null, until: Number.POSITIVE_INFINITY, at: now });
  }

  /** 맡은 일이 모두 끝났을 때: 일하던 중이었으면 잠깐 기뻐한다 */
  allDone(now: number): DeskPet {
    if (this.mode !== 'work') return this;
    return this.with({ mode: 'cheer', until: now + CHEER_MS, at: now });
  }

  /** 듣기를 그만두고 쉰다(취소·명령을 받은 뒤) */
  dismiss(now: number, rand: () => number): DeskPet {
    return this.mode === 'listen' ? this.rest(now, rand) : this;
  }

  /** 말풍선 띄우기 */
  say(text: string, now: number, ms: number): DeskPet {
    return this.with({ speech: { text, until: now + ms } });
  }

  /** 지금 보일 말풍선 글(없으면 null) */
  bubble(now: number): string | null {
    return this.speech !== null && now <= this.speech.until ? this.speech.text : null;
  }

  /** 화면 크기·모니터가 바뀌면 새 화면 안으로 */
  within(area: PetArea): DeskPet {
    const target = this.target === null ? null : clampTo(area, this.size, this.target);
    return new DeskPet(area, this.size, clampTo(area, this.size, this.pos), target, this.mode, this.facing, this.until, this.at, this.speech);
  }

  get moving(): boolean {
    return this.mode === 'roam';
  }

  private timed(): boolean {
    return this.mode === 'pause' || this.mode === 'nap' || this.mode === 'listen' || this.mode === 'cheer';
  }

  private walk(now: number, dt: number, target: PetPoint, rand: () => number): DeskPet {
    const dx = target.x - this.pos.x;
    const dy = target.y - this.pos.y;
    const dist = Math.hypot(dx, dy);
    const reach = (SPEED * dt) / 1000;
    if (dist <= reach) return this.with({ pos: target, at: now }).rest(now, rand);
    const pos = { x: round2(this.pos.x + (dx / dist) * reach), y: round2(this.pos.y + (dy / dist) * reach) };
    return this.with({ pos: clampTo(this.area, this.size, pos), facing: Math.abs(dx) < 1 ? this.facing : dx < 0 ? 'left' : 'right', at: now });
  }

  private rest(now: number, rand: () => number): DeskPet {
    const r = rand();
    if (r < NAP_CHANCE) return this.with({ mode: 'nap', target: null, until: now + NAP_MS, at: now });
    return this.with({ mode: 'pause', target: null, until: now + 2000 + r * 4000, at: now });
  }

  private roamTo(now: number, rand: () => number): DeskPet {
    const target = clampTo(this.area, this.size, {
      x: Math.round(this.area.x + rand() * (this.area.width - this.size.width)),
      y: Math.round(this.area.y + rand() * (this.area.height - this.size.height)),
    });
    return this.with({ mode: 'roam', target, until: Number.POSITIVE_INFINITY, at: now, facing: target.x < this.pos.x ? 'left' : 'right' });
  }

  private with(p: Partial<{ pos: PetPoint; target: PetPoint | null; mode: PetMode; facing: 'left' | 'right'; until: number; at: number; speech: Bubble | null }>): DeskPet {
    return new DeskPet(
      this.area,
      this.size,
      p.pos ?? this.pos,
      p.target !== undefined ? p.target : this.target,
      p.mode ?? this.mode,
      p.facing ?? this.facing,
      p.until ?? this.until,
      p.at ?? this.at,
      p.speech !== undefined ? p.speech : this.speech,
    );
  }
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

function clampTo(area: PetArea, size: PetSize, p: PetPoint): PetPoint {
  return {
    x: Math.min(Math.max(p.x, area.x), area.x + Math.max(0, area.width - size.width)),
    y: Math.min(Math.max(p.y, area.y), area.y + Math.max(0, area.height - size.height)),
  };
}
