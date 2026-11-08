import { describe, expect, it } from 'vitest';
import type { JobView } from '../../shared/ipc.js';
import { recordInputOf } from './record-input.js';

const view = (over: Partial<JobView> = {}): JobView => ({
  id: 'j1',
  request: '결제 타임아웃 원인 찾아줘',
  status: 'done',
  stopReason: null,
  queuedAt: '2026-11-08T01:00:00.000Z',
  endedAt: '2026-11-08T01:10:00.000Z',
  role: null,
  roleName: null,
  cast: ['intake'],
  steps: [{ label: '원인 찾기', state: 'done' }, { label: '고치기', state: 'done' }],
  lastLine: null,
  result: '풀 크기를 늘렸어요.',
  canGoDeeper: false,
  knowledgeMissing: false,
  notes: [
    { role: 'debugger', roleName: '디버거', message: '로그 확인', at: '2026-11-08T01:02:00.000Z' },
    { role: null, roleName: null, message: '알림', at: '2026-11-08T01:03:00.000Z' },
    { role: 'debugger', roleName: '디버거', message: '또 확인', at: '2026-11-08T01:04:00.000Z' },
    { role: 'implementer', roleName: '구현 팀원', message: '수정', at: '2026-11-08T01:05:00.000Z' },
  ],
  ...over,
});

describe('끝난 작업 → 기록 입력', () => {
  it('팀원 이름은 나온 순서대로 한 번씩, 단계 이름과 작업 중 모은 것이 함께 담긴다', () => {
    const input = recordInputOf(view(), { approvals: [], files: ['a.ts'], repo: 'api', direction: null }, '2026-11-08T02:00:00.000Z');
    expect(input).toMatchObject({ id: 'j1', roles: ['디버거', '구현 팀원'], stages: ['원인 찾기', '고치기'], files: ['a.ts'], repo: 'api', endedAt: '2026-11-08T01:10:00.000Z', direction: null });
  });

  it('분석에서 고른 방향이 기록 입력의 방향 비교로 간다 (AI 추천과 다르게 골랐는지 표시가 채워진다)', async () => {
    const { RecordEntry } = await import('../../shared/record-book.js');
    const direction = { recommended: '멱등 키', chosen: '락', reason: '락이 더 단순하다' };
    const input = recordInputOf(view(), { approvals: [], files: [], repo: 'api', direction }, '2026-11-08T02:00:00.000Z')!;
    expect(input.direction).toEqual(direction);
    expect(RecordEntry.capture(input).divergedFromAi()).toBe(true);
  });

  it('끝나지 않은 작업은 기록하지 않는다', () => {
    for (const status of ['queued', 'running', 'waiting'] as const) expect(recordInputOf(view({ status }), { approvals: [], files: null, repo: null, direction: null }, 'x')).toBeNull();
  });

  it('끝난 시각이 없으면 지금 시각을 쓰고, 바뀐 파일을 모르면 빈 목록이다', () => {
    const input = recordInputOf(view({ status: 'stopped', endedAt: null, stopReason: '내가 멈췄어요' }), { approvals: [], files: null, repo: null, direction: null }, '2026-11-08T02:00:00.000Z')!;
    expect(input.endedAt).toBe('2026-11-08T02:00:00.000Z');
    expect(input.files).toEqual([]);
    expect(input.stopReason).toBe('내가 멈췄어요');
  });
});
