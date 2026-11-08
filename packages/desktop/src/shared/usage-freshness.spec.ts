import { describe, expect, it } from 'vitest';
import { ageText, decideRead, isStale, READ_EVERY_MS, MIN_GAP_MS, STALE_AFTER_MS } from './usage-freshness.js';

const NOW = 1_000_000;

describe('한도 읽기 시점', () => {
  it('평소 간격은 20~30초 사이다', () => {
    expect(READ_EVERY_MS).toBeGreaterThanOrEqual(20_000);
    expect(READ_EVERY_MS).toBeLessThanOrEqual(30_000);
  });

  it('한 번도 읽지 않았으면 이유와 상관없이 바로 읽는다', () => {
    for (const reason of ['interval', 'focus', 'settings-open', 'job-over'] as const) {
      expect(decideRead({ reason, lastReadAt: null, inFlight: false, now: NOW })).toBe('read');
    }
  });

  it('읽는 중에 같은 요청이 또 오면 새로 부르지 않고 합친다', () => {
    expect(decideRead({ reason: 'focus', lastReadAt: NOW - 60_000, inFlight: true, now: NOW })).toBe('join');
    expect(decideRead({ reason: 'settings-open', lastReadAt: NOW - 60_000, inFlight: true, now: NOW })).toBe('join');
  });

  it('읽는 중에 일이 끝나면 그 읽기는 끝나기 전 값일 수 있어서 끝난 뒤 한 번 더 읽는다', () => {
    expect(decideRead({ reason: 'job-over', lastReadAt: NOW - 60_000, inFlight: true, now: NOW })).toBe('after');
  });

  it('방금 읽었으면 초점이 돌아와도 다시 부르지 않는다', () => {
    expect(decideRead({ reason: 'focus', lastReadAt: NOW - (MIN_GAP_MS - 1), inFlight: false, now: NOW })).toBe('skip');
    expect(decideRead({ reason: 'focus', lastReadAt: NOW - MIN_GAP_MS, inFlight: false, now: NOW })).toBe('read');
  });

  it('설정을 열 때와 일이 끝날 때는 방금 읽었어도 바로 읽는다', () => {
    expect(decideRead({ reason: 'settings-open', lastReadAt: NOW - 1000, inFlight: false, now: NOW })).toBe('read');
    expect(decideRead({ reason: 'job-over', lastReadAt: NOW - 1000, inFlight: false, now: NOW })).toBe('read');
  });

  it('평소 간격 읽기는 읽을 때가 되기 전에는 건너뛴다', () => {
    expect(decideRead({ reason: 'interval', lastReadAt: NOW - (READ_EVERY_MS - 5000), inFlight: false, now: NOW })).toBe('skip');
    expect(decideRead({ reason: 'interval', lastReadAt: NOW - READ_EVERY_MS, inFlight: false, now: NOW })).toBe('read');
  });
});

describe('읽은 지 얼마나 됐는지', () => {
  it('아직 못 읽었으면 그렇게 말한다', () => {
    expect(ageText(null, NOW)).toBe('아직 못 읽었어요');
  });

  it('1분 안이면 n초 전으로 보인다', () => {
    expect(ageText(NOW - 12_000, NOW)).toBe('12초 전');
    expect(ageText(NOW - 400, NOW)).toBe('방금');
  });

  it('1분이 넘으면 n분 전, 1시간이 넘으면 n시간 전으로 보인다', () => {
    expect(ageText(NOW - 150_000, NOW)).toBe('2분 전');
    expect(ageText(NOW - 3 * 3_600_000, NOW)).toBe('3시간 전');
  });

  it('시계가 거꾸로 가도 방금으로 본다', () => {
    expect(ageText(NOW + 5000, NOW)).toBe('방금');
  });

  it('정해 둔 시간보다 오래되면 오래된 값으로 본다', () => {
    expect(isStale(NOW - STALE_AFTER_MS, NOW)).toBe(false);
    expect(isStale(NOW - STALE_AFTER_MS - 1, NOW)).toBe(true);
    expect(isStale(null, NOW)).toBe(true);
  });
});
