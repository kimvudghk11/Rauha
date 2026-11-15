import { describe, expect, it } from 'vitest';
import { isLimitStop, LimitRetries, retryTime } from './limit-retry.js';

const now = new Date('2026-11-15T10:00:00Z');

describe('한도 풀리면 다시 맡기기', () => {
  it('한도·사용량 때문에 멈춘 이유만 한도 멈춤으로 본다', () => {
    expect(isLimitStop('usage limit reached')).toBe(true);
    expect(isLimitStop('세션 한도에 걸렸어요')).toBe(true);
    expect(isLimitStop('사용자가 멈춤')).toBe(false);
    expect(isLimitStop(null)).toBe(false);
  });

  it('다 쓴 한도가 풀리는 때 1분 뒤에 다시 맡긴다', () => {
    const at = retryTime({ session: { percent: 100, resetsAt: '2026-11-15T11:30:00Z' }, weekly: { percent: 40, resetsAt: '2026-11-18T00:00:00Z' } }, now);
    expect(at?.toISOString()).toBe('2026-11-15T11:31:00.000Z');
  });

  it('주간 한도까지 다 썼으면 둘 중 늦게 풀리는 때를 기다린다', () => {
    const at = retryTime({ session: { percent: 100, resetsAt: '2026-11-15T11:30:00Z' }, weekly: { percent: 100, resetsAt: '2026-11-18T00:00:00Z' } }, now);
    expect(at?.toISOString()).toBe('2026-11-18T00:01:00.000Z');
  });

  it('다 쓴 한도가 없으면(이미 풀림) 바로 다음 확인 때 맡기고, 풀리는 때를 모르면 정하지 않는다', () => {
    expect(retryTime({ session: { percent: 60, resetsAt: '2026-11-15T11:30:00Z' }, weekly: null }, now)?.toISOString()).toBe(now.toISOString());
    expect(retryTime({ session: { percent: 100, resetsAt: null }, weekly: null }, now)).toBeNull();
    expect(retryTime(null, now)).toBeNull();
  });

  it('예약한 작업은 때가 되면 꺼내고 나머지는 남긴다', () => {
    const r = LimitRetries.empty().schedule('a', '요청 A', new Date('2026-11-15T10:30:00Z')).schedule('b', '요청 B', new Date('2026-11-15T12:00:00Z'));
    const { due, rest } = r.due(new Date('2026-11-15T11:00:00Z'));
    expect(due.map((d) => d.request)).toEqual(['요청 A']);
    expect(Object.keys(rest.view())).toEqual(['b']);
  });

  it('같은 작업을 다시 예약하면 시각만 바뀌고, 취소하면 빠진다', () => {
    const r = LimitRetries.empty().schedule('a', '요청 A', new Date('2026-11-15T10:30:00Z')).schedule('a', '요청 A', new Date('2026-11-15T11:30:00Z'));
    expect(r.view()).toEqual({ a: '2026-11-15T11:30:00.000Z' });
    expect(r.cancel('a').view()).toEqual({});
  });
});
