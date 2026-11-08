import { describe, expect, it } from 'vitest';
import type { PlanUsage } from '@rauha/core';
import { UsageService } from './usage-service.js';

const usage = (percent: number): PlanUsage => ({ plan: 'max', session: { percent, resetsAt: null }, weekly: { percent: 10, resetsAt: null } });

function setup(results: Array<PlanUsage | null>) {
  let now = 1_000_000;
  const gates: Array<() => void> = [];
  let calls = 0;
  const changes: number[] = [];
  const service = new UsageService({
    read: () => {
      const result = results[Math.min(calls, results.length - 1)] ?? null;
      calls += 1;
      return new Promise((resolve) => gates.push(() => resolve(result)));
    },
    now: () => now,
    onChange: (snap) => changes.push(snap.readAt ?? -1),
  });
  return { service, gates, calls: () => calls, advance: (ms: number) => (now += ms), changes };
}

describe('한도 읽기 서비스', () => {
  it('읽는 중에 여러 곳이 요청해도 호출은 한 번이고 모두 같은 값을 받는다', async () => {
    const t = setup([usage(40)]);
    const a = t.service.refresh('settings-open');
    const b = t.service.refresh('focus');
    t.gates[0]!();
    const [x, y] = await Promise.all([a, b]);
    expect(t.calls()).toBe(1);
    expect(x.plan?.session?.percent).toBe(40);
    expect(y).toEqual(x);
  });

  it('읽은 값과 읽은 시각을 함께 돌려준다', async () => {
    const t = setup([usage(40)]);
    const p = t.service.refresh('interval');
    t.advance(1500);
    t.gates[0]!();
    const snap = await p;
    expect(snap.readAt).toBe(1_001_500);
  });

  it('읽기에 실패하면 예전 값을 그대로 두고 읽은 시각도 바꾸지 않는다(오래됨이 드러나게)', async () => {
    const t = setup([usage(40), null]);
    const first = t.service.refresh('interval');
    t.gates[0]!();
    const before = await first;
    t.advance(60_000);
    const second = t.service.refresh('interval');
    t.gates[1]!();
    const after = await second;
    expect(after.plan?.session?.percent).toBe(40);
    expect(after.readAt).toBe(before.readAt);
  });

  it('방금 읽었으면 초점 요청은 호출 없이 저장된 값을 돌려준다', async () => {
    const t = setup([usage(40)]);
    const first = t.service.refresh('interval');
    t.gates[0]!();
    await first;
    t.advance(1000);
    const again = await t.service.refresh('focus');
    expect(t.calls()).toBe(1);
    expect(again.plan?.session?.percent).toBe(40);
  });

  it('읽는 중에 일이 끝나면 끝난 뒤 한 번 더 읽어서 새 값을 돌려준다', async () => {
    const t = setup([usage(40), usage(55)]);
    const first = t.service.refresh('interval');
    const over = t.service.refresh('job-over');
    t.gates[0]!();
    await first;
    await Promise.resolve();
    await Promise.resolve();
    t.advance(2000);
    t.gates[1]!();
    const snap = await over;
    expect(t.calls()).toBe(2);
    expect(snap.plan?.session?.percent).toBe(55);
  });

  it('값이 새로 읽힐 때마다 화면에 알린다', async () => {
    const t = setup([usage(40)]);
    const p = t.service.refresh('interval');
    t.gates[0]!();
    await p;
    expect(t.changes).toHaveLength(1);
  });

  it('읽기에 실패하면 이유를 기억하고, 성공하면 지운다', async () => {
    const t = setup([null, usage(40)]);
    expect(t.service.health()).toEqual({ readAt: null, failure: null });
    const failed = t.service.refresh('interval');
    t.gates[0]!();
    await failed;
    expect(t.service.health().readAt).toBeNull();
    expect(t.service.health().failure).toContain('값을 받지 못');
    t.advance(60_000);
    const ok = t.service.refresh('focus');
    t.gates[1]!();
    await ok;
    expect(t.service.health().failure).toBeNull();
    expect(t.service.health().readAt).not.toBeNull();
  });

  it('읽다가 오류가 나면 오류 글을 이유로 남긴다', async () => {
    const service = new UsageService({ read: () => Promise.reject(new Error('spawn EACCES')), now: () => 1, onChange: () => undefined });
    await service.refresh('interval');
    expect(service.health().failure).toContain('spawn EACCES');
  });
});
