import { describe, expect, it } from 'vitest';
import { FRAME } from './characters.js';
import { STAGE_ROLES, stageBob, stageFrame } from './character-theme-picker.js';

describe('캐릭터 컨셉 무대', () => {
  it('대표 5명을 세우고 팀장이 맨 앞이다', () => {
    expect(STAGE_ROLES).toHaveLength(5);
    expect(STAGE_ROLES[0]).toBe('intake');
  });
  it('칸마다 박자가 달라 같은 순간에 모두 같은 표정이 아니다', () => {
    const differs = Array.from({ length: 18 }, (_, t) => new Set(STAGE_ROLES.map((_r, i) => stageFrame(t, i))).size > 1);
    expect(differs.some(Boolean)).toBe(true);
  });
  it('대부분은 기본 표정이고 깜빡·기쁨·걱정·졸음이 섞인다', () => {
    const frames = Array.from({ length: 18 }, (_, t) => stageFrame(t, 0));
    expect(frames.filter((f) => f === FRAME.idle).length).toBeGreaterThan(frames.length / 2);
    for (const f of [FRAME.blink, FRAME.happy, FRAME.worry, FRAME.sleep]) expect(frames).toContain(f);
  });
  it('통통 뛰는 높이는 0~3px', () => {
    for (let t = 0; t < 12; t++) for (let i = 0; i < 5; i++) expect(stageBob(t, i)).toBeGreaterThanOrEqual(0), expect(stageBob(t, i)).toBeLessThanOrEqual(3);
  });
});
