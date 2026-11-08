import { describe, expect, it } from 'vitest';
import { decisionOf, JobTrail } from './job-trail.js';

describe('허락 답 → 기록 결정', () => {
  it('허락은 한 번만·이 작업 동안으로, 거절은 메모가 있으면 "고쳐 달라"로 나뉜다', () => {
    expect(decisionOf({ kind: 'allow' })).toEqual({ decision: 'once', note: null });
    expect(decisionOf({ kind: 'allow-always' })).toEqual({ decision: 'job', note: null });
    expect(decisionOf({ kind: 'deny', note: null })).toEqual({ decision: 'deny', note: null });
    expect(decisionOf({ kind: 'deny', note: '  ' })).toEqual({ decision: 'deny', note: null });
    expect(decisionOf({ kind: 'deny', note: 'qa에 먼저' })).toEqual({ decision: 'revise', note: 'qa에 먼저' });
  });
});

describe('작업 중 모아 두는 기록거리', () => {
  const note = { tool: 'Bash', headline: 'push', reason: '', decision: 'once' as const, note: null, at: '2026-11-08T00:00:00.000Z' };

  it('작업마다 따로 모으고, 꺼내면 비운다', () => {
    const trail = new JobTrail();
    trail.approval('a', note);
    trail.approval('a', { ...note, headline: 'merge' });
    trail.files('a', ['x.ts']);
    trail.repo('a', 'api');
    trail.approval('b', note);
    expect(trail.take('a')).toEqual({ approvals: [note, { ...note, headline: 'merge' }], files: ['x.ts'], repo: 'api' });
    expect(trail.take('a')).toEqual({ approvals: [], files: null, repo: null });
    expect(trail.take('b').approvals).toHaveLength(1);
  });

  it('바뀐 파일을 알아내지 못했으면 null이다(없음과 구분)', () => {
    expect(new JobTrail().take('x').files).toBeNull();
  });
});
