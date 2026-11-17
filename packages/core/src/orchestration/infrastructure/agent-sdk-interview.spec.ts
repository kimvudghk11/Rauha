import { describe, expect, it } from 'vitest';
import { draftPostings } from '../domain/job-posting.js';
import { askInterviewer, evaluateCompany } from './agent-sdk-interview.js';

type Seen = { options?: Record<string, unknown> };
const fake = (seen: Seen, result: { result?: string; structured_output?: unknown }) =>
  ((params: { options: Record<string, unknown> }) => {
    seen.options = params.options;
    return (async function* () {
      yield { type: 'result', subtype: 'success', ...result };
    })();
  }) as unknown as Parameters<typeof askInterviewer>[9];

const posting = draftPostings({ years: 3, role: 'any', seed: 7 })[0]!;

describe('채용 검토실 호출', () => {
  it('회사 평가는 한 번에 5곳을 돌려 한도를 많이 써서 sonnet 을 보통 깊이(medium)로 부른다', async () => {
    const seen: Seen = {};
    await evaluateCompany(posting.id, posting, 3, 'commits', {}, undefined, undefined, fake(seen, { structured_output: {} })).catch(() => undefined);
    expect(seen.options?.['model']).toBe('claude-sonnet-5-5');
    expect(seen.options?.['effort']).toBe('medium');
  });

  it('회사 평가는 작업 요약을 시스템 프롬프트 맨 앞에 두어 회사가 달라도 앞부분이 같다(캐시가 잘 맞게)', async () => {
    const a: Seen = {};
    const b: Seen = {};
    const other = draftPostings({ years: 3, role: 'any', seed: 7 })[1]!;
    await evaluateCompany(posting.id, posting, 3, 'MY-COMMITS', {}, undefined, undefined, fake(a, { structured_output: {} })).catch(() => undefined);
    await evaluateCompany(other.id, other, 3, 'MY-COMMITS', {}, undefined, undefined, fake(b, { structured_output: {} })).catch(() => undefined);
    const sa = String(a.options?.['systemPrompt']);
    const sb = String(b.options?.['systemPrompt']);
    const shared = sa.indexOf('You run the hiring review');
    expect(shared).toBeGreaterThan(0);
    expect(sa.slice(0, shared)).toBe(sb.slice(0, sb.indexOf('You run the hiring review')));
    expect(sa.slice(0, shared)).toContain('MY-COMMITS');
  });

  it('담당자와 대화에는 작업 요약을 짧게(6천 자까지)만 넣는다', async () => {
    const seen: Seen = {};
    await askInterviewer(posting.id, posting, 3, 'x'.repeat(20_000), [], '왜 떨어졌어요?', {}, undefined, undefined, fake(seen, { result: '담당자: 답' }));
    expect(String(seen.options?.['systemPrompt']).length).toBeLessThan(9_000);
  });

  it('담당자와 대화는 짧은 답이라 얕게(low) 부른다', async () => {
    const seen: Seen = {};
    await askInterviewer(posting.id, posting, 3, 'commits', [], '왜 떨어졌어요?', {}, undefined, undefined, fake(seen, { result: '담당자: 답' }));
    expect(seen.options?.['effort']).toBe('low');
  });
});
