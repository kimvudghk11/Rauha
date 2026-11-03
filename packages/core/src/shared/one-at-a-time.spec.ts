import { describe, expect, it } from 'vitest';
import { oneAtATime } from './one-at-a-time.js';

describe('oneAtATime', () => {
  it('동시에 불러도 앞 호출이 끝난 뒤에 다음 호출을 시작한다 (질문이 화면에 겹치지 않게)', async () => {
    const log: string[] = [];
    let release: () => void = () => undefined;
    const slow = oneAtATime(async (name: string) => {
      log.push(`start ${name}`);
      if (name === 'a') await new Promise<void>((r) => (release = r));
      log.push(`end ${name}`);
      return name.toUpperCase();
    });
    const a = slow('a');
    const b = slow('b');
    await Promise.resolve();
    expect(log).toEqual(['start a']);
    release();
    expect(await Promise.all([a, b])).toEqual(['A', 'B']);
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b']);
  });

  it('앞 호출이 실패해도 다음 호출은 돈다', async () => {
    const run = oneAtATime(async (fail: boolean) => {
      if (fail) throw new Error('x');
      return 'ok';
    });
    const first = run(true);
    const second = run(false);
    await expect(first).rejects.toThrow('x');
    expect(await second).toBe('ok');
  });
});
