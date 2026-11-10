import { describe, expect, it } from 'vitest';
import { resetText } from './settings-view.js';

describe('resetText', () => {
  const now = new Date('2026-11-09T09:00:00');

  it('같은 날이면 오늘 시각으로 쓴다', () => {
    expect(resetText('2026-11-09T15:20:00', now)).toMatch(/^Today /);
  });

  it('다른 날이면 월·일과 시각으로 쓴다', () => {
    expect(resetText('2026-11-12T03:05:00', now)).toMatch(/^Nov 12 /);
  });

  it('모르거나 틀린 값은 빈 글이다', () => {
    expect(resetText(null, now)).toBe('');
    expect(resetText('아무 글', now)).toBe('');
  });
});
