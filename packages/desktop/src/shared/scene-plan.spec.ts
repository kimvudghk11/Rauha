import { describe, expect, it } from 'vitest';
import { CHARACTER_SET_IDS } from './character-set-ids.js';
import { actorX, hasStations, sceneOf, stationsFor } from './scene-plan.js';

describe('컨셉마다 장면(소품 자리)', () => {
  it('8개 컨셉 모두 가운데 자리와 소품 다섯 곳이 있다', () => {
    for (const id of CHARACTER_SET_IDS) {
      const s = sceneOf(id);
      expect(s.stations).toHaveLength(5);
      expect(s.stations.every((st) => st.x > 0 && st.x < 1)).toBe(true);
      expect(s.center.x).toBeCloseTo(0.5, 1);
    }
  });
  it('카페는 커피머신 ↔ 설거지대, 왕국은 훈련장이 있다', () => {
    expect(stationsFor('cafe', 'implementer').map((s) => s.label)).toEqual(['coffee machine', 'sink']);
    expect(sceneOf('fantasy').stations.map((s) => s.label)).toContain('training dummy');
  });
});

describe('걸어 다니기', () => {
  const cols = 200;
  it('팀장(intake)은 가운데 자리를 지킨다', () => {
    const xs = [0, 25, 50, 75].map((t) => actorX('cafe', 'intake', 0, t, cols, 16));
    expect(new Set(xs).size).toBe(1);
    expect(Math.abs(xs[0]! + 8 - cols / 2)).toBeLessThanOrEqual(1);
  });
  it('다른 팀원은 두 소품 사이를 오가고, 그 사이에는 걸어서 지나간다(순간이동 없음)', () => {
    const xs = Array.from({ length: 80 }, (_, t) => actorX('cafe', 'implementer', 1, t, cols, 16));
    expect(Math.min(...xs)).toBeLessThan(Math.max(...xs));
    for (let t = 1; t < xs.length; t++) expect(Math.abs(xs[t]! - xs[t - 1]!)).toBeLessThanOrEqual(Math.ceil(cols / 10));
  });
  it('팀원마다 박자가 달라서 같은 소품 쌍이어도 똑같이 움직이지 않는다', () => {
    const a = Array.from({ length: 200 }, (_, t) => actorX('office', 'implementer', 1, t, cols, 16));
    const b = Array.from({ length: 200 }, (_, t) => actorX('office', 'debugger', 2, t, cols, 16));
    const shifted = a.map((_, t) => a[(t + 23) % a.length]);
    expect(b).not.toEqual(shifted);
  });
  it('가끔 가운데(팀장 자리)로 모였다가 돌아가고, 그때도 걸어서 간다', () => {
    const xs = Array.from({ length: 600 }, (_, t) => actorX('cafe', 'tester', 0, t, cols, 16));
    const mid = cols / 2 - 8;
    expect(xs.some((x) => Math.abs(x - mid) <= 1)).toBe(true);
    for (let t = 1; t < xs.length; t++) expect(Math.abs(xs[t]! - xs[t - 1]!)).toBeLessThanOrEqual(Math.ceil(cols / 10));
  });
  it('모든 팀원 역할(새 부서 포함)은 일에 맞는 소품 쌍이 있다', () => {
    for (const role of ['copywriter', 'video', 'productdesigner', 'graphic', 'md', 'ecommerce', 'logistics', 'pm', 'qa', 'frontend', 'accountant']) expect(hasStations(role), role).toBe(true);
  });
  it('캔버스 밖으로 나가지 않는다', () => {
    for (let t = 0; t < 200; t += 7) {
      const x = actorX('fantasy', 'tester', 3, t, 60, 16);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x + 16).toBeLessThanOrEqual(60);
    }
  });
});
