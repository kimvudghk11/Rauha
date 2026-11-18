import { describe, expect, it } from 'vitest';
import { UnreadBadge } from './unread-badge.js';

const job = (id: string, status: 'queued' | 'running' | 'waiting' | 'done' | 'stopped') => ({ id, status });

describe('안 본 것 빨간 배지(카톡처럼)', () => {
  it('창을 안 보고 있을 때 끝난 작업은 안 본 것으로 센다', () => {
    const b = UnreadBadge.empty().observe([job('a', 'running')], false).observe([job('a', 'done')], false);
    expect(b.count(0)).toBe(1);
  });

  it('창을 보고 있을 때 끝난 작업은 세지 않는다', () => {
    const b = UnreadBadge.empty().observe([job('a', 'running')], true).observe([job('a', 'done')], true);
    expect(b.count(0)).toBe(0);
  });

  it('창을 보면 끝난 작업은 본 것이 되고, 기다리는 허락은 계속 센다', () => {
    const b = UnreadBadge.empty().observe([job('a', 'running'), job('b', 'running')], false).observe([job('a', 'stopped'), job('b', 'done')], false);
    expect(b.count(2)).toBe(4);
    expect(b.seen().count(2)).toBe(2);
  });

  it('앱을 다시 켰을 때 이미 끝나 있던 작업과, 다시 돌기 시작한 작업은 세지 않는다', () => {
    expect(UnreadBadge.empty().observe([job('a', 'done')], false).count(0)).toBe(0);
    const again = UnreadBadge.empty().observe([job('a', 'running')], false).observe([job('a', 'done')], false).observe([job('a', 'running')], false);
    expect(again.count(0)).toBe(0);
  });

  it('작업판에서 사라진 작업은 세지 않는다', () => {
    const b = UnreadBadge.empty().observe([job('a', 'running')], false).observe([job('a', 'done')], false).observe([], false);
    expect(b.count(0)).toBe(0);
  });

  it('배지 글자는 없으면 빈 글, 99 넘으면 99+, 메뉴 막대에는 빨간 점과 숫자를 원래 글자 앞에', () => {
    expect(UnreadBadge.label(0)).toBe('');
    expect(UnreadBadge.label(3)).toBe('3');
    expect(UnreadBadge.label(120)).toBe('99+');
    expect(UnreadBadge.trayTitle(2, '1')).toBe(' 🔴2 1');
    expect(UnreadBadge.trayTitle(0, '1')).toBe(' 1');
    expect(UnreadBadge.trayTitle(0, '')).toBe('');
  });
});
