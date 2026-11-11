import { describe, expect, it } from 'vitest';
import type { CheckpointKeeper } from './checkpoint-keeper.js';
import { dispatchCheckpoint } from './checkpoint-dispatch.js';

const calls: unknown[][] = [];
const keeper = {
  changes: async (...a: unknown[]) => (calls.push(['changes', ...a]), null),
  revert: async (...a: unknown[]) => (calls.push(['revert', ...a]), { message: 'ok', reverted: 0, conflicts: [], backupId: null }),
  preview: async (...a: unknown[]) => (calls.push(['preview', ...a]), {}),
} as unknown as CheckpointKeeper;

describe('dispatchCheckpoint 화면에서 온 값 검사', () => {
  it('모르는 함수 이름·객체가 아닌 인자·이상한 작업 id 는 거절한다', async () => {
    expect(await dispatchCheckpoint(keeper, 'rm', {})).toMatchObject({ ok: false });
    expect(await dispatchCheckpoint(keeper, 'constructor', {})).toMatchObject({ ok: false });
    expect(await dispatchCheckpoint(keeper, 'changes', 'job')).toMatchObject({ ok: false });
    expect(await dispatchCheckpoint(keeper, 'changes', { jobId: '' })).toMatchObject({ ok: false });
    expect(await dispatchCheckpoint(keeper, 'changes', { jobId: 5 })).toMatchObject({ ok: false });
  });

  it('경로 탈출·.git 안쪽·옵션처럼 읽히는 파일 이름이나 너무 많은 목록은 거절하고 서비스를 부르지 않는다', async () => {
    calls.length = 0;
    for (const paths of [['../x'], ['.git/config'], ['--output=x'], ['/etc/passwd'], ['C:/x'], 'a.txt', [], [5], Array.from({ length: 501 }, (_, i) => `f${i}`)]) {
      expect(await dispatchCheckpoint(keeper, 'revert', { jobId: 'j', paths })).toMatchObject({ ok: false });
    }
    expect(calls).toEqual([]);
  });

  it('올바른 값은 서비스로 넘긴다', async () => {
    calls.length = 0;
    expect(await dispatchCheckpoint(keeper, 'revert', { jobId: 'j1', paths: ['src' + String.fromCharCode(92) + 'a.ts'] })).toMatchObject({ ok: true });
    expect(calls).toEqual([['revert', 'j1', ['src/a.ts']]]);
    expect(await dispatchCheckpoint(keeper, 'changes', { jobId: 'j1' })).toEqual({ ok: true, data: null });
  });
});
