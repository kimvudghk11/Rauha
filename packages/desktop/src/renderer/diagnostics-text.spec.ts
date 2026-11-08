import { describe, expect, it } from 'vitest';
import { diagnosticsText } from './diagnostics-text.js';

describe('진단 정보 복사 안내 글', () => {
  it('복사했으면 줄 수와 붙여 넣으라는 안내, 가려졌다는 말을 보인다', () => {
    const text = diagnosticsText({ ok: true, copied: true, lines: 64, markdown: '' });
    expect(text).toContain('복사했어요');
    expect(text).toContain('64줄');
    expect(text).toContain('붙여 넣어');
    expect(text).toContain('가려');
  });

  it('클립보드에 넣지 않은 실행이면 복사했다고 말하지 않는다', () => {
    expect(diagnosticsText({ ok: true, copied: false, lines: 3, markdown: '' })).not.toContain('복사했어요');
  });

  it('실패하면 이유를, 답이 없으면 못 했다는 말을 보인다', () => {
    expect(diagnosticsText({ ok: false, error: '진단 정보를 만들지 못했어요.' })).toBe('진단 정보를 만들지 못했어요.');
    expect(diagnosticsText(null)).toContain('복사하지 못했어요');
  });
});
