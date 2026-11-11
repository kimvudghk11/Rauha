import { describe, expect, it } from 'vitest';
import { OutputFlow } from './pty-flow.js';

describe('PTY 출력 흐름 제어', () => {
  it('보낸 뒤 받았다는 확인이 오기 전의 양이 상한을 넘으면 PTY를 멈추라고 한다', () => {
    const flow = OutputFlow.create(100, 20);
    expect(flow.sent(60)).toBeNull();
    expect(flow.sent(60)).toBe('pause');
    expect(flow.inFlight).toBe(120);
  });

  it('이미 멈춘 뒤에는 더 보내도 멈추라는 말을 되풀이하지 않는다', () => {
    const flow = OutputFlow.create(100, 20);
    flow.sent(150);
    expect(flow.sent(10)).toBeNull();
  });

  it('확인이 와서 하한 아래로 내려오면 다시 시작하라고 한다', () => {
    const flow = OutputFlow.create(100, 20);
    flow.sent(150);
    expect(flow.acked(100)).toBeNull();
    expect(flow.acked(40)).toBe('resume');
    expect(flow.paused).toBe(false);
  });

  it('보낸 것보다 많은 확인(거짓 확인)은 보낸 양까지만 인정한다', () => {
    const flow = OutputFlow.create(100, 20);
    flow.sent(30);
    flow.acked(1_000_000);
    expect(flow.inFlight).toBe(0);
  });

  it('음수·소수·NaN 확인은 무시한다', () => {
    const flow = OutputFlow.create(100, 20);
    flow.sent(30);
    flow.acked(-5);
    flow.acked(Number.NaN);
    flow.acked(2.5);
    expect(flow.inFlight).toBe(30);
  });
});
