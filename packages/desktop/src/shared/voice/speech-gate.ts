/**
 * 마이크 소리에서 "말 한 덩어리"만 잘라 낸다(소리 크기로 가르는 단순한 VAD).
 * 주변 소음 크기(바닥)를 조용할 때마다 따라가서, 바닥보다 확실히 큰 소리가 이어지면 말로 본다.
 * 조용할 때는 계산이 거의 없어서 계속 켜 둬도 가볍다.
 */
const PRE_ROLL_MS = 300;
const MIN_SPEECH_MS = 250;
const END_SILENCE_MS = 700;
const MAX_MS = 15_000;
/** 말로 보는 가장 작은 소리 크기(RMS). 바닥이 아주 낮아도 이것보다는 커야 한다 */
const MIN_LEVEL = 0.012;

export class SpeechGate {
  private floor = 0.004;
  private pre: Float32Array[] = [];
  private preLen = 0;
  private chunks: Float32Array[] = [];
  private len = 0;
  private voiced = 0;
  private silent = 0;
  private speaking = false;

  private constructor(private readonly rate: number) {}

  static start(sampleRate: number): SpeechGate {
    return new SpeechGate(sampleRate);
  }

  /** 지금 소리 크기가 말로 보이는지(화면의 마이크 표시용) */
  get inSpeech(): boolean {
    return this.speaking;
  }

  /** 소리 한 조각을 넣는다. 말 한 덩어리가 끝났으면 그 소리를 돌려준다(아니면 null) */
  push(frame: Float32Array): Float32Array | null {
    const level = rms(frame);
    const loud = level > Math.max(this.floor * 4, MIN_LEVEL);
    if (!this.speaking) {
      if (!loud) this.floor = this.floor * 0.95 + level * 0.05;
      this.keepPreRoll(frame);
      if (!loud) {
        this.voiced = 0;
        return null;
      }
      this.voiced += frame.length;
      if (this.voiced < this.ms(60)) return null;
      this.speaking = true;
      this.chunks = [...this.pre];
      this.len = this.preLen;
      this.silent = 0;
      return null;
    }
    this.chunks.push(frame);
    this.len += frame.length;
    if (loud) {
      this.voiced += frame.length;
      this.silent = 0;
    } else this.silent += frame.length;
    if (this.silent >= this.ms(END_SILENCE_MS) || this.len >= this.ms(MAX_MS)) return this.finish();
    return null;
  }

  private finish(): Float32Array | null {
    const enough = this.voiced >= this.ms(MIN_SPEECH_MS);
    const out = enough ? concat(this.chunks, this.len) : null;
    this.speaking = false;
    this.chunks = [];
    this.len = 0;
    this.voiced = 0;
    this.silent = 0;
    this.pre = [];
    this.preLen = 0;
    return out;
  }

  private keepPreRoll(frame: Float32Array): void {
    this.pre.push(frame);
    this.preLen += frame.length;
    while (this.pre.length > 1 && this.preLen - this.pre[0]!.length >= this.ms(PRE_ROLL_MS)) this.preLen -= this.pre.shift()!.length;
  }

  private ms(n: number): number {
    return (this.rate * n) / 1000;
  }
}

/** 소리를 16kHz(받아쓰기 모델이 받는 빠르기)로 줄인다. 구간 평균이라 높은 소리가 접히지 않는다 */
export function toSixteenK(samples: Float32Array, rate: number): Float32Array {
  if (rate === 16000) return samples;
  const ratio = rate / 16000;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i += 1) {
    const a = Math.floor(i * ratio);
    const b = Math.min(samples.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = a; j < b; j += 1) sum += samples[j]!;
    out[i] = b > a ? sum / (b - a) : 0;
  }
  return out;
}

function rms(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i += 1) sum += frame[i]! * frame[i]!;
  return Math.sqrt(sum / Math.max(1, frame.length));
}

function concat(parts: readonly Float32Array[], len: number): Float32Array {
  const out = new Float32Array(len);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
