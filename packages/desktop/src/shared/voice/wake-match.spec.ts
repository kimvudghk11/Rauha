import { describe, expect, it } from 'vitest';
import { mfcc } from './mfcc.js';
import { WakeTemplates, WakeTemplatesDto } from './wake-match.js';

const RATE = 16000;
/** 음 높이가 바뀌는 소리(말 비슷하게). 시작 높이와 끝 높이로 다른 "낱말"을 만든다 */
function chirp(from: number, to: number, ms: number, wobble = 0): Float32Array {
  const n = (RATE * ms) / 1000;
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i += 1) {
    const f = from + ((to - from) * i) / n + wobble * Math.sin(i / 900);
    phase += (2 * Math.PI * f) / RATE;
    out[i] = 0.3 * Math.sin(phase) + 0.1 * Math.sin(phase * 2.7);
  }
  return out;
}
const silence = (ms: number) => new Float32Array((RATE * ms) / 1000);
const join = (...parts: Float32Array[]) => {
  const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

const name = (ms: number, wobble: number) => join(silence(200), chirp(300, 1400, ms * 0.5, wobble), chirp(1400, 500, ms * 0.5, wobble), silence(300));
const trained = () => WakeTemplates.empty().add(mfcc(name(500, 0))).add(mfcc(name(560, 15))).add(mfcc(name(460, 30)));

describe('내 목소리 이름 알아듣기', () => {
  it('세 번 녹음해야 준비가 끝난다', () => {
    expect(WakeTemplates.empty().ready).toBe(false);
    expect(trained().ready).toBe(true);
  });

  it('녹음한 이름과 비슷한 소리(빠르기가 조금 달라도)는 이름으로 알아듣는다', () => {
    expect(trained().match(mfcc(name(530, 10))).hit).toBe(true);
  });

  it('전혀 다른 소리는 이름으로 치지 않는다', () => {
    const other = join(silence(200), chirp(2000, 2200, 600), chirp(200, 250, 400), silence(300));
    expect(trained().match(mfcc(other)).hit).toBe(false);
  });

  it('이름 뒤에 말이 이어지면 이름이 끝난 지점을 알려 준다', () => {
    const said = join(name(500, 5), chirp(2000, 2200, 800), silence(300));
    const m = trained().match(mfcc(said));
    expect(m.hit).toBe(true);
    expect(m.rest).toBe(true);
    // 10ms 한 칸: 이름(앞 침묵 포함 약 0.7초) 뒤
    expect(m.endMs).toBeGreaterThan(400);
    expect(m.endMs).toBeLessThan(1200);
  });

  it('저장한 것을 다시 읽어도 같게 알아듣고, 망가진 파일은 빈 상태로 읽는다', () => {
    const back = WakeTemplatesDto.from(JSON.parse(JSON.stringify(WakeTemplatesDto.fromEntity(trained())))).toEntity();
    expect(back.ready).toBe(true);
    expect(back.match(mfcc(name(530, 10))).hit).toBe(true);
    expect(WakeTemplatesDto.from({ templates: 'x' }).toEntity().ready).toBe(false);
    expect(WakeTemplatesDto.from(null).toEntity().ready).toBe(false);
  });

  it('다시 녹음하면 처음부터 받는다', () => {
    expect(trained().reset().ready).toBe(false);
  });
});
