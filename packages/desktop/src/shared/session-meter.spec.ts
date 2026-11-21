import { describe, expect, it } from 'vitest';
import { SessionMeter } from './session-meter.js';

describe('SessionMeter', () => {
  it('일이 시작할 때와 끝날 때 세션 사용률 차이를 그 일이 쓴 몫으로 보인다', () => {
    const meter = SessionMeter.empty().start('a', 31).finish('a', 33);
    expect(meter.line('a')).toBe('Session: +2%');
  });

  it('사용률이 그대로면 1% 미만이라고 말한다(0% 로 보이지 않게)', () => {
    expect(SessionMeter.empty().start('a', 40).finish('a', 40).line('a')).toBe('Session: under 1%');
  });

  it('같은 때 다른 일이 돌았으면 그 일도 섞였다고 밝힌다', () => {
    const meter = SessionMeter.empty().start('a', 10).start('b', 11).finish('a', 14).finish('b', 15);
    expect(meter.line('a')).toBe('Session: +4% (other work ran at the same time)');
    expect(meter.line('b')).toBe('Session: +4% (other work ran at the same time)');
  });

  it('앞 일이 끝난 뒤 시작한 일은 섞이지 않는다', () => {
    const meter = SessionMeter.empty().start('a', 10).finish('a', 12).start('b', 12).finish('b', 13);
    expect(meter.line('b')).toBe('Session: +1%');
  });

  it('세션이 도중에 새로 시작됐거나(값이 줄면) 어느 한쪽을 못 읽었으면 지어내지 않고 보이지 않는다', () => {
    expect(SessionMeter.empty().start('a', 90).finish('a', 3).line('a')).toBeNull();
    expect(SessionMeter.empty().start('a', null).finish('a', 30).line('a')).toBeNull();
    expect(SessionMeter.empty().start('a', 30).finish('a', null).line('a')).toBeNull();
    expect(SessionMeter.empty().finish('a', 30).line('a')).toBeNull();
  });

  it('아직 끝나지 않은 일과 모르는 일은 줄이 없다', () => {
    expect(SessionMeter.empty().start('a', 30).line('a')).toBeNull();
    expect(SessionMeter.empty().line('x')).toBeNull();
  });

  it('시작 직후 새로 읽은 값으로 시작값을 고칠 수 있고, 끝난 일이나 모르는 일은 그대로다', () => {
    expect(SessionMeter.empty().start('a', 28).restart('a', 30).finish('a', 31).line('a')).toBe('Session: +1%');
    expect(SessionMeter.empty().start('a', 28).restart('a', null).finish('a', 31).line('a')).toBe('Session: +3%');
    expect(SessionMeter.empty().start('a', 28).finish('a', 31).restart('a', 30).line('a')).toBe('Session: +3%');
    expect(SessionMeter.empty().restart('x', 30).line('x')).toBeNull();
  });

  it('같은 일을 두 번 시작해도 처음 값을 지킨다', () => {
    expect(SessionMeter.empty().start('a', 30).start('a', 35).finish('a', 36).line('a')).toBe('Session: +6%');
  });

  it('오래된 기록은 정해 둔 수만 남긴다', () => {
    let meter = SessionMeter.empty();
    for (let i = 0; i < 260; i += 1) meter = meter.start(`j${i}`, 1).finish(`j${i}`, 2);
    expect(meter.line('j0')).toBeNull();
    expect(meter.line('j259')).toBe('Session: +1%');
  });
});
