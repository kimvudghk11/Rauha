import { describe, expect, it } from 'vitest';
import { motionFor } from './character-motion.js';
import { FRAME } from './characters.js';

describe('motionFor', () => {
  it('쉬는 캐릭터는 자는 프레임이고 제자리다', () => {
    expect(motionFor('rest', 7)).toEqual({ dx: 0, dy: 0, frame: FRAME.sleep, flip: null });
  });

  it('끝난 캐릭터는 기쁜 얼굴로 뛰어올랐다 내려온다', () => {
    const ys = Array.from({ length: 12 }, (_, t) => motionFor('done', t).dy);
    expect(Math.min(...ys)).toBe(-3);
    expect(ys[0]).toBe(0);
    expect(motionFor('done', 3).frame).toBe(FRAME.happy);
  });

  it('멈춘 캐릭터는 걱정스러운 얼굴로 떤다', () => {
    expect(motionFor('stuck', 0).frame).toBe(FRAME.worry);
    expect(motionFor('stuck', 0).dx).not.toBe(motionFor('stuck', 1).dx);
  });

  it('일하는 캐릭터는 통통 튄다', () => {
    expect(new Set([0, 1, 2, 3].map((t) => motionFor('work', t).dy)).size).toBe(2);
  });

  it('걷는 캐릭터는 왕복하며 돌아올 때 방향이 뒤집힌다', () => {
    expect(motionFor('walk', 0).flip).toBe(false);
    expect(motionFor('walk', 3 * 8).flip).toBe(true);
  });

  it('seed가 다르면 같은 때에도 다른 움직임이다', () => {
    expect(motionFor('think', 4, 0).dx).not.toBe(motionFor('think', 4, 2).dx);
  });

  it('가끔 눈을 깜빡인다', () => {
    expect(motionFor('idle', 0).frame).toBe(FRAME.blink);
    expect(motionFor('idle', 10).frame).toBe(FRAME.idle);
  });
});
