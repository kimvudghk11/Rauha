import { describe, expect, it } from 'vitest';
import { diagnosticsText } from './diagnostics-text.js';

describe('진단 정보 복사 안내 글', () => {
  it('복사했으면 줄 수와 붙여 넣으라는 안내, 가려졌다는 말을 보인다', () => {
    const text = diagnosticsText({ ok: true, copied: true, lines: 64, markdown: '' });
    expect(text).toContain('copied');
    expect(text).toContain('64 lines');
    expect(text).toContain('Paste');
    expect(text).toContain('masked');
  });

  it('클립보드에 넣지 않은 실행이면 복사했다고 말하지 않는다', () => {
    expect(diagnosticsText({ ok: true, copied: false, lines: 3, markdown: '' })).not.toContain('copied');
  });

  it('실패하면 이유를, 답이 없으면 못 했다는 말을 보인다', () => {
    expect(diagnosticsText({ ok: false, error: 'Could not create the diagnostics.' })).toBe('Could not create the diagnostics.');
    expect(diagnosticsText(null)).toContain('Could not copy');
  });
});
