import { describe, expect, it } from 'vitest';
import { characterStateOf, elapsedText } from './room.js';

describe('characterStateOf', () => {
  it('대기는 쉼, 기다림은 손 흔들기, 끝은 점프, 멈춤은 땀방울이다', () => {
    expect(characterStateOf({ status: 'queued', role: null })).toBe('rest');
    expect(characterStateOf({ status: 'waiting', role: 'implementer' })).toBe('wait');
    expect(characterStateOf({ status: 'done', role: null })).toBe('done');
    expect(characterStateOf({ status: 'stopped', role: null })).toBe('stuck');
  });

  it('손으로 만드는 팀원은 일함, 조사·설계하는 팀원은 생각이다', () => {
    expect(characterStateOf({ status: 'running', role: 'implementer' })).toBe('work');
    expect(characterStateOf({ status: 'running', role: 'debugger' })).toBe('think');
    expect(characterStateOf({ status: 'running', role: null })).toBe('work');
  });
});

describe('elapsedText', () => {
  const start = '2026-11-08T00:00:00.000Z';
  const at = (s: number) => Date.parse(start) + s * 1000;
  it('1분 미만은 초로, 넘으면 분과 초로 쓴다', () => {
    expect(elapsedText(start, null, at(40))).toBe('40s');
    expect(elapsedText(start, null, at(252))).toBe('4m 12s');
    expect(elapsedText(start, null, at(3900))).toBe('1h 5m');
  });

  it('끝난 일은 끝난 시각까지만 센다', () => {
    expect(elapsedText(start, new Date(at(65)).toISOString(), at(9999))).toBe('1m 05s');
  });
});
