import { describe, expect, it } from 'vitest';
import { SpeechGate, toSixteenK } from './speech-gate.js';

const RATE = 16000;
const FRAME = 512;
const quiet = () => new Float32Array(FRAME).map(() => (Math.random() - 0.5) * 0.002);
const loud = () => new Float32Array(FRAME).map((_, i) => Math.sin(i / 3) * 0.3);

function feed(gate: SpeechGate, frames: Float32Array[]): Float32Array[] {
  const out: Float32Array[] = [];
  for (const f of frames) {
    const seg = gate.push(f);
    if (seg !== null) out.push(seg);
  }
  return out;
}
const many = (n: number, make: () => Float32Array) => Array.from({ length: n }, make);

describe('말소리 잘라내기', () => {
  it('조용한 소리만 들어오면 아무것도 내놓지 않는다', () => {
    expect(feed(SpeechGate.start(RATE), many(200, quiet))).toHaveLength(0);
  });

  it('말소리가 났다가 조용해지면 그 말 한 덩어리를 내놓는다', () => {
    const gate = SpeechGate.start(RATE);
    const out = feed(gate, [...many(40, quiet), ...many(30, loud), ...many(40, quiet)]);
    expect(out).toHaveLength(1);
    // 말 앞뒤를 조금 붙여서 첫소리가 잘리지 않는다
    expect(out[0]!.length).toBeGreaterThan(30 * FRAME);
  });

  it('아주 짧은 딸깍 소리는 말로 치지 않는다', () => {
    const gate = SpeechGate.start(RATE);
    expect(feed(gate, [...many(40, quiet), ...many(2, loud), ...many(40, quiet)])).toHaveLength(0);
  });

  it('너무 길게 이어지는 소리는 최대 길이에서 끊어 내놓는다', () => {
    const gate = SpeechGate.start(RATE);
    const out = feed(gate, [...many(40, quiet), ...many(700, loud)]);
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out[0]!.length).toBeLessThanOrEqual(RATE * 15 + FRAME * 12);
  });

  it('48kHz 소리를 16kHz 로 줄이면 길이가 3분의 1이 된다', () => {
    expect(toSixteenK(new Float32Array(4800), 48000).length).toBe(1600);
    const same = new Float32Array([0.1, 0.2]);
    expect(toSixteenK(same, 16000)).toEqual(same);
  });
});
