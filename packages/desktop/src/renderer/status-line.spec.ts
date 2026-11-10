import { describe, expect, it } from 'vitest';
import { statusText } from './status-line.js';

const view = (running: number, waiting: number, queued: number) => ({ jobs: [], running, waiting, queued, limit: 3 });

describe('statusText', () => {
  it('진행·기다림·대기 수를 한 줄로 쓴다', () => {
    expect(statusText(view(2, 1, 0))).toBe('Running 2 · Waiting 1 · Queued 0');
  });

  it('돈은 보이지 않는다', () => {
    expect(statusText(view(3, 0, 4))).not.toMatch(/\$|달러|원\b/);
  });
});
