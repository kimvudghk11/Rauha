import { describe, expect, it } from 'vitest';
import { createInputQueue, type InputQueueHost } from './input-queue.js';

function setup() {
  const queue: string[] = [];
  const log: string[] = [];
  const gates: (() => void)[] = [];
  const host: InputQueueHost = {
    enqueue: (t) => void queue.push(t),
    dequeue: () => queue.shift(),
    print: (l) => log.push(`print:${l}`),
    saveHistory: (t) => log.push(`history:${t}`),
    isQueueCommand: (t) => t === '/queue',
    queueCommand: (t) => log.push(`queueCommand:${t}`),
    handle: (t) => {
      log.push(`handle:${t}`);
      if (t === 'boom') return Promise.reject(new Error('깨짐'));
      return new Promise<void>((done) => gates.push(done));
    },
  };
  return { input: createInputQueue(host), queue, log, gates };
}
const tick = () => new Promise((r) => setImmediate(r));

describe('입력 대기열', () => {
  it('쉬는 중 받은 입력은 바로 처리한다', async () => {
    const { input, log } = setup();
    input.submit('a');
    await tick();
    expect(log).toEqual(['history:a', 'handle:a']);
  });

  it('일하는 중 받은 입력은 줄을 세우고, 끝나면 넣은 순서대로 하나씩 처리한다', async () => {
    const { input, log, gates, queue } = setup();
    input.submit('a');
    input.submit('b');
    input.submit('c');
    await tick();
    expect(queue).toEqual(['b', 'c']);
    gates[0]!();
    await tick();
    gates[1]!();
    await tick();
    expect(log.filter((l) => l.startsWith('handle'))).toEqual(['handle:a', 'handle:b', 'handle:c']);
  });

  it('쌓아 둔 입력을 다루는 명령은 일하는 중에도 줄 서지 않고 바로 처리한다', async () => {
    const { input, log, queue } = setup();
    input.submit('a');
    input.submit('/queue');
    expect(queue).toEqual([]);
    expect(log).toContain('queueCommand:/queue');
  });

  it('처리 중 오류가 나도 알리고 다음 입력을 이어서 처리한다', async () => {
    const { input, log, gates } = setup();
    input.submit('boom');
    input.submit('next');
    await tick();
    await tick();
    expect(log).toContain('print:rauha: 깨짐');
    expect(log).toContain('handle:next');
    gates[0]!();
  });

  it('입력을 다 처리하면 다시 쉬는 중이 된다', async () => {
    const { input, gates } = setup();
    input.submit('a');
    await tick();
    expect(input.running()).toBe(true);
    gates[0]!();
    await tick();
    expect(input.running()).toBe(false);
  });
});
