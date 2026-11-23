import { describe, expect, it } from 'vitest';
import { DirectChain } from './direct-chain.js';

const at = 1_000_000;

describe('메인 채팅 Claude 세션 잇기', () => {
  it('앞 세션이 있고 같은 모델이면 이어서 새 말만 보낸다', () => {
    expect(DirectChain.continues({ id: 's1', tier: 'sonnet', at, count: 3, context: 50_000 }, { now: at + 60_000, tier: 'sonnet' })).toBe(true);
  });

  it('앞 세션이 없거나 다른 모델이면 새로 연다', () => {
    expect(DirectChain.continues(null, { now: at, tier: 'sonnet' })).toBe(false);
    expect(DirectChain.continues({ id: 's1', tier: 'sonnet', at, count: 0 }, { now: at, tier: 'opus' })).toBe(false);
  });

  it('너무 오래됐거나(3시간) 대화가 너무 커지면(15만 토큰) 새로 연다', () => {
    expect(DirectChain.continues({ id: 's1', tier: 'sonnet', at, count: 0 }, { now: at + 3 * 3_600_000 + 1, tier: 'sonnet' })).toBe(false);
    expect(DirectChain.continues({ id: 's1', tier: 'sonnet', at, count: 0, context: 150_001 }, { now: at, tier: 'sonnet' })).toBe(false);
  });

  it('너무 여러 번 이었으면(40번) 새로 연다', () => {
    expect(DirectChain.continues({ id: 's1', tier: 'sonnet', at, count: 40 }, { now: at, tier: 'sonnet' })).toBe(false);
  });

  it('이은 결과는 횟수를 하나 늘리고, 새로 열었으면 0부터 센다', () => {
    const before = { id: 's1', tier: 'sonnet' as const, at, count: 3 };
    expect(DirectChain.after(before, { id: 's2', tier: 'sonnet', at: at + 5, context: 9, continued: true })).toEqual({ id: 's2', tier: 'sonnet', at: at + 5, count: 4, context: 9 });
    expect(DirectChain.after(before, { id: 's3', tier: 'sonnet', at: at + 5, context: 9, continued: false })).toEqual({ id: 's3', tier: 'sonnet', at: at + 5, count: 0, context: 9 });
  });
});
