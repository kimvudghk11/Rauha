import { describe, expect, it } from 'vitest';
import { FOLLOW_RESULT_MAX, followUpPrompt, followUpText } from './follow-up.js';

describe('이어서 묻기(답장·후속 질문)', () => {
  it('앞 요청과 결과를 맥락으로 붙이고 새 말은 맨 끝에', () => {
    const p = followUpPrompt({ request: '로그인 버튼 고쳐 줘', result: '버튼 색과 클릭 범위를 고쳤어요.' }, '모바일에서도 확인해 줘');
    expect(p).toContain('로그인 버튼 고쳐 줘');
    expect(p).toContain('버튼 색과 클릭 범위를 고쳤어요.');
    expect(p.trim().endsWith('모바일에서도 확인해 줘')).toBe(true);
  });
  it('앞 결과가 없으면(멈춘 작업) 그렇다고 적는다', () => {
    expect(followUpPrompt({ request: 'a', result: null }, 'b')).toMatch(/no result/i);
  });
  it('앞 결과는 상한까지만', () => {
    const p = followUpPrompt({ request: 'a', result: 'x'.repeat(FOLLOW_RESULT_MAX + 500) }, 'b');
    expect(p.length).toBeLessThan(FOLLOW_RESULT_MAX + 600);
    expect(p).toContain('(cut)');
  });
  it('새 말은 다듬고, 비었거나 너무 길면 거절', () => {
    expect(followUpText('  더 해 줘 ')).toBe('더 해 줘');
    expect(followUpText('   ')).toBeNull();
    expect(followUpText('x'.repeat(20_001))).toBeNull();
    expect(followUpText(42)).toBeNull();
  });
});
