import { describe, expect, it } from 'vitest';
import { CommitDraftDto, commitDraftPrompt, COMMIT_DIFF_LIMIT } from './commit-draft.dto.js';

describe('커밋 메시지 초안', () => {
  it('제목은 한 줄로, 앞뒤 공백·끝 마침표를 지운다', () => {
    expect(CommitDraftDto.from({ subject: '  feat: add login button.\nextra ', body: ' why \n' })).toEqual({ subject: 'feat: add login button', body: 'why' });
  });
  it('제목은 72자에서 자르고, 본문은 2000자까지', () => {
    const d = CommitDraftDto.from({ subject: 'x'.repeat(100), body: 'y'.repeat(3000) });
    expect([...d.subject].length).toBe(72);
    expect(d.body.length).toBe(2000);
  });
  it('제목이 없으면 실패한다', () => {
    expect(() => CommitDraftDto.from({ subject: '   ', body: 'b' })).toThrow();
    expect(() => CommitDraftDto.from(null)).toThrow();
  });
});

describe('모델에 보낼 글', () => {
  it('diff 는 상한까지만, 이 레포의 방식 안내를 함께 넣는다', () => {
    const p = commitDraftPrompt('d'.repeat(COMMIT_DIFF_LIMIT + 50), 'This repo uses `feat: text` (English).');
    expect(p).toContain('This repo uses `feat: text` (English).');
    expect(p).toContain('(diff cut here)');
    expect(p.length).toBeLessThan(COMMIT_DIFF_LIMIT + 400);
  });
});
