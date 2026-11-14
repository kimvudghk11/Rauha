import { describe, expect, it } from 'vitest';
import { RunReport, type RunStep } from './api-runner.js';

const step = (o: Partial<RunStep>): RunStep => ({ id: 'a', name: 'Login', method: 'POST', url: '{{base_url}}/login', status: 200, ms: 10, error: null, checks: [], saved: [], skipped: false, ...o });

describe('RunReport — 폴더 일괄 실행 결과', () => {
  it('검증이 있으면 검증이 모두 통과해야, 없으면 4xx·5xx 가 아니어야 통과다', () => {
    expect(RunReport.passed(step({}))).toBe(true);
    expect(RunReport.passed(step({ status: 404 }))).toBe(false);
    expect(RunReport.passed(step({ status: 404, checks: [{ label: 'Status = 404', pass: true, actual: '404' }] }))).toBe(true);
    expect(RunReport.passed(step({ checks: [{ label: 'x', pass: false, actual: '1' }] }))).toBe(false);
    expect(RunReport.passed(step({ status: null, error: 'Connection refused' }))).toBe(false);
    expect(RunReport.passed(step({ skipped: true, status: null }))).toBe(false);
  });

  it('요약: 전체·통과·실패·건너뜀·걸린 시간', () => {
    const r = RunReport.of('Auth flow', [step({ ms: 10 }), step({ id: 'b', name: 'Me', status: 401, ms: 5 }), step({ id: 'c', name: 'Skip', status: null, ms: 0, skipped: true })], '2026-11-14T00:00:00.000Z');
    expect(r.summary()).toEqual({ total: 3, passed: 1, failed: 1, skipped: 1, ms: 15 });
  });

  it('Markdown 은 결과 줄을 맨 위에, 실패 요청과 실패한 검증을 먼저 보인다', () => {
    const r = RunReport.of('Auth flow', [step({ saved: ['token'] }), step({ id: 'b', name: 'Me', method: 'GET', url: '{{base_url}}/me', status: 401, checks: [{ label: 'Status = 200', pass: false, actual: '401' }] })], '2026-11-14T00:00:00.000Z');
    const md = r.toMarkdown();
    expect(md.split('\n')[0]).toBe('# Run: Auth flow');
    expect(md).toContain('❌ **1 failed** · 1 passed');
    expect(md.indexOf('## Failed')).toBeLessThan(md.indexOf('## All requests'));
    expect(md).toContain('- ✗ Status = 200 — actual: 401');
    expect(md).toContain('| ✅ | POST | Login | 200 | 10 ms | saved {{token}} |');
  });

  it('모두 통과하면 통과 줄', () => {
    expect(RunReport.of('x', [step({})], '2026-11-14T00:00:00.000Z').toMarkdown()).toContain('✅ **All 1 passed**');
  });
});
