import { describe, expect, it } from 'vitest';
import { toDelfiVoice } from './desk-pet-ipc.js';

describe('델피 목소리 고르기', () => {
  it('저장된 값이 없거나 모르는 값이면 지배인 모습에 맞는 남자 목소리(M3)다', () => {
    expect(toDelfiVoice(undefined)).toBe('M3');
    expect(toDelfiVoice('Heami')).toBe('M3');
  });
  it('고른 목소리(여자 F5·끄기)는 그대로 읽는다', () => {
    expect(toDelfiVoice('F5')).toBe('F5');
    expect(toDelfiVoice('off')).toBe('off');
  });
});
