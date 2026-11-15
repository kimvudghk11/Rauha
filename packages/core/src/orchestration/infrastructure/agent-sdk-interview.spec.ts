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
  it('회사 평가는 판단이 필요해 opus 를 보통 깊이(medium)로 부른다', async () => {
    const seen: Seen = {};
    await evaluateCompany(posting.id, posting, 3, 'commits', {}, undefined, undefined, fake(seen, { structured_output: {} })).catch(() => undefined);
    expect(seen.options?.['model']).toContain('opus');
    expect(seen.options?.['effort']).toBe('medium');
  });

  it('담당자와 대화는 짧은 답이라 얕게(low) 부른다', async () => {
    const seen: Seen = {};
    await askInterviewer(posting.id, posting, 3, 'commits', [], '왜 떨어졌어요?', {}, undefined, undefined, fake(seen, { result: '담당자: 답' }));
    expect(seen.options?.['effort']).toBe('low');
  });
});
