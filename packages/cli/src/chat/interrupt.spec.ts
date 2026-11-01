import { describe, expect, it } from 'vitest';
import { createInterrupt, type InterruptHost } from './interrupt.js';

function setup(busy: boolean) {
  const log: string[] = [];
  let now = 1_700_000_000_000;
  const timers: (() => void)[] = [];
  const host: InterruptHost = {
    busy: () => busy,
    cancelWork: () => log.push('cancelWork'),
    cancelPrompts: () => log.push('cancelPrompts'),
    clearQueue: () => 2,
    print: (line) => log.push(`print:${line}`),
    setNotice: (text) => log.push(`notice:${text}`),
    exit: () => log.push('exit'),
    now: () => now,
    later: (fn) => void timers.push(fn),
  };
  return { interrupt: createInterrupt(host), log, timers, advance: (ms: number) => (now += ms) };
}

describe('Ctrl+C', () => {
  it('일하는 중이면 작업을 멈추고 기다리던 질문과 입력을 지운다', () => {
    const { interrupt, log } = setup(true);
    interrupt();
    expect(log).toEqual(['cancelWork', 'cancelPrompts', 'print:  멈추는 중이에요… (기다리던 입력 2개도 지웠어요)']);
  });

  it('쉬는 중 처음 누르면 한 번 더 누르라는 알림만 띄운다', () => {
    const { interrupt, log } = setup(false);
    interrupt();
    expect(log).toEqual(['notice:한 번 더 Ctrl+C(또는 Ctrl+D)를 누르면 끝나요']);
  });

  it('쉬는 중 2초 안에 한 번 더 누르면 알림을 지우고 끝낸다', () => {
    const { interrupt, log, timers, advance } = setup(false);
    interrupt();
    advance(1500);
    interrupt();
    expect(log).toContain('notice:');
    timers.at(-1)!();
    expect(log.at(-1)).toBe('exit');
  });

  it('쉬는 중 2초가 지난 뒤 누르면 다시 처음처럼 알림만 띄운다', () => {
    const { interrupt, log, advance } = setup(false);
    interrupt();
    advance(2500);
    interrupt();
    expect(log.filter((l) => l.startsWith('notice:한')).length).toBe(2);
    expect(log).not.toContain('exit');
  });
});
