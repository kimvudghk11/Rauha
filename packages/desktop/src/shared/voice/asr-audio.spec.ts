import { describe, expect, it } from 'vitest';
import { audioForAsr, MIN_ASR_SAMPLES } from './asr-audio.js';

describe('audioForAsr', () => {
  it('큰 소리 배열의 중간을 가리키는 창(subarray)도 처음부터 시작하는 새 배열로 넘긴다(받아쓰기 엔진의 invalid buffer size 를 막는다)', () => {
    const whole = new Float32Array(16000 * 2).map((_, i) => i);
    const view = whole.subarray(16000);
    expect(view.byteOffset).toBeGreaterThan(0);
    const audio = audioForAsr(view)!;
    expect(audio.byteOffset).toBe(0);
    expect(audio.buffer.byteLength).toBe(audio.length * 4);
    expect(audio.length).toBe(16000);
    expect(audio[0]).toBe(16000);
  });

  it('0.1초보다 짧은 조각은 받아쓰지 않는다(이름 바로 뒤가 비었을 때)', () => {
    expect(audioForAsr(new Float32Array(MIN_ASR_SAMPLES - 1))).toBeNull();
    expect(audioForAsr(new Float32Array(0))).toBeNull();
    expect(audioForAsr(new Float32Array(MIN_ASR_SAMPLES))).not.toBeNull();
  });

  it('숫자가 아닌 값(NaN·무한대)은 0으로 바꾼다', () => {
    const raw = new Float32Array(MIN_ASR_SAMPLES).fill(0.5);
    raw[3] = Number.NaN;
    raw[4] = Number.POSITIVE_INFINITY;
    const audio = audioForAsr(raw)!;
    expect([audio[3], audio[4], audio[5]]).toEqual([0, 0, 0.5]);
  });
});
