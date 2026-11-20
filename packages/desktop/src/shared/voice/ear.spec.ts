import { describe, expect, it } from 'vitest';
import { Ear } from './ear.js';

const hit = { hit: true, score: 0.5, endMs: 600, rest: false };
const hitWithRest = { ...hit, rest: true };
const maybe = { hit: false, score: 1.4, endMs: 600, rest: false };
const far = { hit: false, score: 3, endMs: 600, rest: false };

describe('델피의 귀(들은 말을 어떻게 할지)', () => {
  it('이름만 부르면 깨어나고, 이름 뒤에 말이 이어지면 그 말을 바로 명령으로 받는다', () => {
    expect(Ear.idle().hear(0, hit, 700)).toBe('wake');
    expect(Ear.idle().hear(0, hitWithRest, 3000)).toBe('wake-with-command');
  });

  it('이름과 애매하게 비슷하면 받아써서 한 번 더 확인하고, 전혀 다르면 무시한다', () => {
    expect(Ear.idle().hear(0, maybe, 900)).toBe('confirm');
    expect(Ear.idle().hear(0, far, 900)).toBe('ignore');
  });

  it('내 목소리 녹음이 없으면 짧은 말은 받아써서 이름을 찾고, 긴 말은 무시한다', () => {
    expect(Ear.idle().hear(0, null, 2000)).toBe('confirm');
    expect(Ear.idle().hear(0, null, 9000)).toBe('ignore');
  });

  it('깨어난 뒤 정한 시간 안에 들린 말은 무엇이든 명령으로 받는다', () => {
    const ear = Ear.idle().awaitCommand(1000);
    expect(ear.hear(5000, far, 2000)).toBe('command');
    expect(ear.hear(1000 + 9000, far, 2000)).toBe('ignore');
    expect(ear.done().hear(2000, far, 2000)).toBe('ignore');
  });

  it('이름을 녹음하는 동안 들린 소리는 모두 녹음으로 쓴다', () => {
    const ear = Ear.idle().train();
    expect(ear.training).toBe(true);
    expect(ear.hear(0, far, 700)).toBe('sample');
    expect(ear.done().training).toBe(false);
  });
});
