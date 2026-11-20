import { describe, expect, it } from 'vitest';
import { DeskPet } from './desk-pet.js';

const area = { x: 0, y: 0, width: 1920, height: 1040 };
const size = { width: 200, height: 150 };
const fixed = (v: number) => () => v;

describe('바탕화면 델피', () => {
  it('처음에는 화면 오른쪽 아래에 서서 쉰다', () => {
    const pet = DeskPet.enter(area, size, 0);
    expect(pet.mode).toBe('pause');
    expect(pet.pos.x).toBe(area.width - size.width - 40);
    expect(pet.pos.y).toBe(area.height - size.height);
  });

  it('쉬는 시간이 끝나면 화면 안의 다른 곳으로 걸어간다', () => {
    const pet = DeskPet.enter(area, size, 0).step(60_000, fixed(0.5));
    expect(pet.mode).toBe('roam');
    expect(pet.target).not.toBeNull();
  });

  it('걸을 때는 목적지 쪽으로 조금씩 움직이고 그쪽을 본다', () => {
    let pet = DeskPet.enter(area, size, 0).step(60_000, fixed(0.1));
    const start = pet.pos;
    pet = pet.step(60_100, fixed(0.1));
    expect(pet.pos.x).toBeLessThan(start.x);
    expect(pet.facing).toBe('left');
  });

  it('한 걸음은 짧다: 주 모니터가 아닌 곳(좌표가 0 에서 시작하지 않는 화면)에서도 순간 이동하지 않는다', () => {
    const second = { x: 1920, y: -426, width: 1080, height: 1890 };
    let pet = DeskPet.enter(second, size, 0).step(60_000, fixed(0.1));
    for (let t = 60_050; t < 70_000; t += 50) {
      const before = pet.pos;
      pet = pet.step(t, fixed(0.1));
      expect(Math.hypot(pet.pos.x - before.x, pet.pos.y - before.y)).toBeLessThanOrEqual(70 * 0.05 + 0.01);
    }
  });

  it('어디로 가든 창이 화면 밖으로 나가지 않는다', () => {
    let pet = DeskPet.enter(area, size, 0);
    let now = 0;
    for (let i = 0; i < 5000; i += 1) {
      now += 100;
      pet = pet.step(now, () => (i * 0.137) % 1);
      expect(pet.pos.x).toBeGreaterThanOrEqual(area.x);
      expect(pet.pos.y).toBeGreaterThanOrEqual(area.y);
      expect(pet.pos.x + size.width).toBeLessThanOrEqual(area.x + area.width);
      expect(pet.pos.y + size.height).toBeLessThanOrEqual(area.y + area.height);
    }
  });

  it('부르면 그 자리에 멈춰 귀를 기울이고, 아무 말이 없으면 다시 쉰다', () => {
    let pet = DeskPet.enter(area, size, 0).step(60_000, fixed(0.1)).call(60_000);
    const here = pet.pos;
    pet = pet.step(61_000, fixed(0.1));
    expect(pet.mode).toBe('listen');
    expect(pet.pos).toEqual(here);
    expect(pet.step(70_000, fixed(0.5)).mode).toBe('pause');
  });

  it('일을 맡으면 일하는 동안 돌아다니지 않는다', () => {
    let pet = DeskPet.enter(area, size, 0).working(0);
    const here = pet.pos;
    for (let t = 0; t < 120_000; t += 1000) pet = pet.step(t, fixed(0.3));
    expect(pet.mode).toBe('work');
    expect(pet.pos).toEqual(here);
  });

  it('일이 모두 끝나면 잠깐 기뻐하고 다시 쉰다', () => {
    const pet = DeskPet.enter(area, size, 0).working(0).allDone(5000);
    expect(pet.mode).toBe('cheer');
    expect(pet.step(5000 + 5000, fixed(0.3)).mode).toBe('pause');
  });

  it('일하지 않을 때 일이 끝났다는 소식은 무시한다', () => {
    expect(DeskPet.enter(area, size, 0).allDone(10).mode).toBe('pause');
  });

  it('말풍선은 정한 시간 동안만 보인다', () => {
    const pet = DeskPet.enter(area, size, 0).say('네?', 0, 3000);
    expect(pet.bubble(1000)).toBe('네?');
    expect(pet.bubble(3001)).toBeNull();
  });

  it('화면 크기가 바뀌면 새 화면 안으로 들어온다', () => {
    const pet = DeskPet.enter(area, size, 0).within({ x: 0, y: 0, width: 800, height: 600 });
    expect(pet.pos.x + size.width).toBeLessThanOrEqual(800);
    expect(pet.pos.y + size.height).toBeLessThanOrEqual(600);
  });
});
