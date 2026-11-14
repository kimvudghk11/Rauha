import { describe, expect, it } from 'vitest';
import { actionSummary, groupTurns, touchedFiles } from './conversation-turns.js';

const u = (text: string) => ({ role: 'user' as const, text, at: '' });
const a = (text: string, tools?: string[]) => ({ role: 'assistant' as const, text, ...(tools ? { tools } : {}), at: '' });

describe('대화를 질문 카드로 묶기', () => {
  it('내 질문 하나 + 그 뒤 Claude 의 답·도구를 한 묶음으로', () => {
    const t = groupTurns([u('로그인 고쳐 줘'), a('볼게요', ['Read src/a.ts']), a('고쳤어요', ['Edit src/a.ts', 'Bash yarn test']), u('테스트도'), a('통과')]);
    expect(t).toHaveLength(2);
    expect(t[0]).toEqual({ ask: '로그인 고쳐 줘', answer: '볼게요\n\n고쳤어요', tools: ['Read src/a.ts', 'Edit src/a.ts', 'Bash yarn test'] });
    expect(t[1]?.answer).toBe('통과');
  });
  it('질문 없이 시작한 답은 빈 질문 카드로', () => {
    expect(groupTurns([a('안내')])).toEqual([{ ask: '', answer: '안내', tools: [] }]);
  });
});

describe('Claude 가 한 일 요약', () => {
  it('도구를 종류별로 세고 대상 몇 개를 보인다', () => {
    expect(actionSummary(['Edit src/a.ts', 'Edit src/b.ts', 'Write docs/x.md', 'Read src/c.ts', 'Bash yarn test', 'Bash git push', 'Grep foo', 'WebSearch rauha'])).toEqual([
      { label: 'Edited', count: 3, sample: ['src/a.ts', 'src/b.ts', 'docs/x.md'] },
      { label: 'Ran', count: 2, sample: ['yarn test', 'git push'] },
      { label: 'Read', count: 1, sample: ['src/c.ts'] },
      { label: 'Searched', count: 2, sample: ['foo', 'rauha'] },
    ]);
  });
  it('고친 파일 목록(중복 없이)', () => {
    expect(touchedFiles(['Edit a.ts', 'Edit a.ts', 'Write b.md', 'Read c.ts'])).toEqual(['a.ts', 'b.md']);
  });
});
