import { centered, MFCC_HOP_MS, type Voiceprint } from './mfcc.js';

/**
 * 내 목소리로 녹음해 둔 "델피" 몇 번과 들어온 소리를 견주어(DTW) 이름을 불렀는지 가른다.
 * 소리 자체는 저장하지 않고 소리 모양 숫자(MFCC)만 둔다. 받아쓰기 모델보다 훨씬 빠르고, 짧은 이름도 잘 잡는다.
 */
export const WAKE_SAMPLES_NEEDED = 3;
const KEEP = 5;
/** 너무 짧은 녹음(0.15초 미만)은 받지 않는다 */
const MIN_FRAMES = 15;
/** 녹음끼리의 차이보다 이만큼까지 더 달라도 같은 이름으로 본다 */
const SLACK = 1.6;

export interface WakeMatch {
  readonly hit: boolean;
  /** 1 보다 작으면 이름으로 본다(작을수록 비슷) */
  readonly score: number;
  /** 이름이 끝난 지점(소리 처음부터 ms) */
  readonly endMs: number;
  /** 이름 뒤에 말이 더 이어지는지(예: "델피, 로그인 고쳐 줘") */
  readonly rest: boolean;
}

const MISS: WakeMatch = { hit: false, score: Number.POSITIVE_INFINITY, endMs: 0, rest: false };

export class WakeTemplates {
  private constructor(private readonly templates: readonly (readonly (readonly number[])[])[]) {}

  static empty(): WakeTemplates {
    return new WakeTemplates([]);
  }

  static of(templates: readonly (readonly (readonly number[])[])[]): WakeTemplates {
    return new WakeTemplates(templates.filter((t) => t.length >= MIN_FRAMES).slice(-KEEP));
  }

  get count(): number {
    return this.templates.length;
  }

  get ready(): boolean {
    return this.templates.length >= WAKE_SAMPLES_NEEDED;
  }

  /** 녹음 한 번을 더한다. 너무 짧은 소리는 버린다 */
  add(print: Voiceprint): WakeTemplates {
    if (print.frames.length < MIN_FRAMES) return this;
    return new WakeTemplates([...this.templates, print.frames].slice(-KEEP));
  }

  /** 다시 녹음할 때 */
  reset(): WakeTemplates {
    return WakeTemplates.empty();
  }

  /** 들어온 소리의 앞부분이 이름인지 */
  match(print: Voiceprint): WakeMatch {
    if (!this.ready || print.frames.length < MIN_FRAMES) return MISS;
    const limit = this.threshold();
    let best: { score: number; end: number } | null = null;
    for (const t of this.templates) {
      const tpl = centered(t);
      // 평균은 이름 부분으로만 빼야 뒤에 이어진 말에 끌려가지 않는다: 한 번 맞춰 본 끝 지점까지로 다시 맞춘다
      const first = prefixDtw(tpl, centered(print.frames, t.length));
      const r = first === null ? null : prefixDtw(tpl, centered(print.frames, first.end + 1));
      if (r !== null && (best === null || r.cost < best.score)) best = { score: r.cost, end: r.end };
    }
    if (best === null) return MISS;
    const score = best.score / limit;
    const restFrames = print.frames.length - 1 - best.end;
    return { hit: score < 1, score, endMs: Math.round(print.startMs + (best.end + 1) * MFCC_HOP_MS), rest: restFrames > 30 };
  }

  /** 녹음끼리 서로 얼마나 다른지로 문턱을 정한다(사람·마이크마다 저절로 맞춰진다) */
  private threshold(): number {
    const costs: number[] = [];
    for (let i = 0; i < this.templates.length; i += 1)
      for (let j = 0; j < this.templates.length; j += 1) {
        if (i === j) continue;
        const r = prefixDtw(centered(this.templates[i]!), centered(this.templates[j]!), true);
        if (r !== null) costs.push(r.cost);
      }
    const sorted = [...costs].sort((a, b) => a - b);
    const max = sorted[sorted.length - 1] ?? 1;
    const median = sorted[Math.floor(sorted.length / 2)] ?? 1;
    return Math.max(max * SLACK, median * 2);
  }

  toJSON(): { templates: readonly (readonly (readonly number[])[])[] } {
    return { templates: this.templates };
  }
}

/**
 * 견본(tpl) 전체가 입력(input)의 앞부분과 얼마나 다른지. 입력은 처음부터 시작하고 아무 데서나 끝날 수 있다.
 * whole 이면 입력 끝까지 맞춘다. 값은 길이로 나눈 평균 거리.
 */
function prefixDtw(tpl: readonly (readonly number[])[], input: readonly (readonly number[])[], whole = false): { cost: number; end: number } | null {
  const n = tpl.length;
  const m = Math.min(input.length, n * 2);
  if (n === 0 || m === 0) return null;
  let prev = new Float64Array(m).fill(Number.POSITIVE_INFINITY);
  let cur = new Float64Array(m);
  for (let i = 0; i < n; i += 1) {
    cur.fill(Number.POSITIVE_INFINITY);
    for (let j = 0; j < m; j += 1) {
      const d = dist(tpl[i]!, input[j]!);
      const before = i === 0 && j === 0 ? 0 : Math.min(i > 0 ? prev[j]! : Number.POSITIVE_INFINITY, j > 0 ? cur[j - 1]! : Number.POSITIVE_INFINITY, i > 0 && j > 0 ? prev[j - 1]! : Number.POSITIVE_INFINITY);
      cur[j] = d + before;
    }
    [prev, cur] = [cur, prev];
  }
  if (whole) return input.length > m ? null : { cost: prev[m - 1]! / (n + m), end: m - 1 };
  let best: { cost: number; end: number } | null = null;
  for (let j = Math.floor(n * 0.6); j < m; j += 1) {
    const cost = prev[j]! / (n + j + 1);
    if (best === null || cost < best.cost) best = { cost, end: j };
  }
  return best;
}

function dist(a: readonly number[], b: readonly number[]): number {
  let s = 0;
  for (let k = 0; k < a.length; k += 1) {
    const d = a[k]! - b[k]!;
    s += d * d;
  }
  return Math.sqrt(s);
}

/** 저장 파일 ↔ 견본. 이상한 값은 버리고 빈 상태로 읽는다 */
export class WakeTemplatesDto {
  private constructor(readonly templates: readonly (readonly (readonly number[])[])[]) {}

  static from(json: unknown): WakeTemplatesDto {
    const raw = (json as { templates?: unknown } | null)?.templates;
    if (!Array.isArray(raw)) return new WakeTemplatesDto([]);
    const ok = raw.filter((t): t is number[][] => Array.isArray(t) && t.length > 0 && t.length < 1000 && t.every((f) => Array.isArray(f) && f.length === 12 && f.every((v) => typeof v === 'number' && Number.isFinite(v))));
    return new WakeTemplatesDto(ok);
  }

  static fromEntity(t: WakeTemplates): { templates: readonly (readonly (readonly number[])[])[] } {
    return t.toJSON();
  }

  toEntity(): WakeTemplates {
    return WakeTemplates.of(this.templates);
  }
}
