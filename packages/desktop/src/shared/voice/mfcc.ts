/**
 * 16kHz 소리를 10ms 칸마다 MFCC(소리 모양 숫자 12개)로 바꾼다. 앞뒤 조용한 칸은 잘라 낸다.
 * 호출어(델피)를 내 목소리 녹음과 비교할 때 쓴다(평균 빼기는 비교하는 쪽에서 centered 로).
 */
const RATE = 16000;
const WIN = 400; // 25ms
const HOP = 160; // 10ms
const NFFT = 512;
const MELS = 26;
const CEPS = 12;
/** 가장 큰 칸보다 이만큼(log10 에너지) 작은 앞뒤 칸은 조용한 것으로 보고 잘라 낸다(약 25dB) */
const TRIM = 2.5;

export const MFCC_HOP_MS = (HOP / RATE) * 1000;

const hamming = Float64Array.from({ length: WIN }, (_, i) => 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (WIN - 1)));
const melOf = (hz: number) => 2595 * Math.log10(1 + hz / 700);
const hzOf = (mel: number) => 700 * (10 ** (mel / 2595) - 1);
const filters: Float64Array[] = (() => {
  const lo = melOf(60);
  const hi = melOf(7600);
  const bins = Array.from({ length: MELS + 2 }, (_, i) => Math.floor(((NFFT + 1) * hzOf(lo + ((hi - lo) * i) / (MELS + 1))) / RATE));
  return Array.from({ length: MELS }, (_, m) => {
    const f = new Float64Array(NFFT / 2 + 1);
    const [a, b, c] = [bins[m]!, bins[m + 1]!, bins[m + 2]!];
    for (let k = a; k < b; k += 1) f[k] = (k - a) / Math.max(1, b - a);
    for (let k = b; k <= c; k += 1) f[k] = (c - k) / Math.max(1, c - b);
    return f;
  });
})();

/** 소리 모양: MFCC 칸들(칸마다 숫자 12개)과, 앞에서 잘라 낸 조용한 부분의 길이(ms) */
export interface Voiceprint {
  readonly frames: readonly (readonly number[])[];
  readonly startMs: number;
}

/** 앞뒤 조용한 칸을 뺀 MFCC. 소리가 너무 짧으면 칸이 비어 있다 */
export function mfcc(samples: Float32Array): Voiceprint {
  const frames: number[][] = [];
  const energies: number[] = [];
  const re = new Float64Array(NFFT);
  const im = new Float64Array(NFFT);
  for (let start = 0; start + WIN <= samples.length; start += HOP) {
    re.fill(0);
    im.fill(0);
    let e = 0;
    for (let i = 0; i < WIN; i += 1) {
      // 앞 강조(고음을 조금 키운다)
      const s = samples[start + i]! - 0.97 * (start + i > 0 ? samples[start + i - 1]! : 0);
      re[i] = s * hamming[i]!;
      e += s * s;
    }
    fft(re, im);
    const power = new Float64Array(NFFT / 2 + 1);
    for (let k = 0; k <= NFFT / 2; k += 1) power[k] = re[k]! * re[k]! + im[k]! * im[k]!;
    const logMel = filters.map((f) => {
      let sum = 0;
      for (let k = 0; k < f.length; k += 1) sum += f[k]! * power[k]!;
      return Math.log(sum + 1e-10);
    });
    const ceps: number[] = [];
    for (let c = 1; c <= CEPS; c += 1) {
      let sum = 0;
      for (let m = 0; m < MELS; m += 1) sum += logMel[m]! * Math.cos((Math.PI * c * (m + 0.5)) / MELS);
      ceps.push(sum);
    }
    frames.push(ceps);
    energies.push(Math.log10(e + 1e-10));
  }
  if (frames.length === 0) return { frames: [], startMs: 0 };
  const top = Math.max(...energies);
  let a = 0;
  let b = frames.length - 1;
  while (a < b && energies[a]! < top - TRIM) a += 1;
  while (b > a && energies[b]! < top - TRIM) b -= 1;
  return { frames: frames.slice(a, b + 1).map((f) => f.map((v) => Math.round(v * 1000) / 1000)), startMs: a * MFCC_HOP_MS };
}

/** 칸들의 평균을 빼서 마이크·방 울림 차이를 줄인다(앞 count 칸의 평균으로) */
export function centered(frames: readonly (readonly number[])[], count = frames.length): number[][] {
  const head = frames.slice(0, Math.max(1, Math.min(count, frames.length)));
  const dims = frames[0]?.length ?? 0;
  const mean = Array.from({ length: dims }, (_, c) => head.reduce((s, f) => s + f[c]!, 0) / head.length);
  return frames.map((f) => f.map((v, c) => v - mean[c]!));
}

/** 제자리 FFT(길이는 2의 거듭제곱) */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k += 1) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b]! * cr - im[b]! * ci;
        const ti = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}
