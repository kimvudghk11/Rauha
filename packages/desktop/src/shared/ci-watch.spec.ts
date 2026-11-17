import { describe, expect, it } from 'vitest';
import { ciFixTodo, ciVerdict, pushedSha } from './ci-watch.js';
import type { RunView } from './gh-actions.js';

const run = (over: Partial<RunView>): RunView => ({ id: 1, workflow: 'desktop', title: 't', event: 'push', branch: 'main', sha: 'abc', number: 7, attempt: 1, verdict: 'success', startedAt: '', durationSec: 1, url: 'https://github.com/o/r/actions/runs/1', actor: 'me', ...over });

describe('push 뒤 CI 지켜보기', () => {
  it('작업 동안 원격 추적 브랜치가 바뀌어 지금 HEAD 와 같아졌을 때만 push 한 것으로 본다', () => {
    expect(pushedSha({ upstreamBefore: 'a', upstreamAfter: 'b', head: 'b' })).toBe('b');
    expect(pushedSha({ upstreamBefore: null, upstreamAfter: 'b', head: 'b' })).toBe('b'); // 새 브랜치를 -u 로 올림
    expect(pushedSha({ upstreamBefore: 'a', upstreamAfter: 'a', head: 'b' })).toBeNull(); // 커밋만
    expect(pushedSha({ upstreamBefore: 'a', upstreamAfter: 'b', head: 'c' })).toBeNull(); // 올린 뒤 또 커밋
    expect(pushedSha({ upstreamBefore: 'a', upstreamAfter: null, head: 'a' })).toBeNull();
  });

  it('그 커밋의 실행이 모두 끝나야 판정한다: 하나라도 실패면 실패, 아직 도는 게 있으면 기다림, 실행이 없으면 없음', () => {
    expect(ciVerdict([], 'abc')).toBe('none');
    expect(ciVerdict([run({ sha: 'other' })], 'abc')).toBe('none');
    expect(ciVerdict([run({ verdict: 'running' }), run({ id: 2, verdict: 'failure' })], 'abc')).toBe('waiting');
    expect(ciVerdict([run({ verdict: 'success' }), run({ id: 2, verdict: 'failure' })], 'abc')).toBe('failed');
    expect(ciVerdict([run({ verdict: 'success' }), run({ id: 2, verdict: 'skipped' })], 'abc')).toBe('passed');
  });

  it('실패하면 팀에 넘길 수 있는 할 일을 만든다: 실패한 워크플로·작업·주소·로그 끝부분, 메모 길이 안으로', () => {
    const todo = ciFixTodo({ branch: 'feat/refund', runs: [run({ verdict: 'failure', workflow: 'test', number: 12 })], jobs: [{ run: 'test', job: 'yarn test (windows)', tail: ['FAIL src/money.spec.ts', 'Expected 900 but got 899'] }] }, 2000);
    expect(todo.title).toBe('CI 실패 고치기: test #12 (feat/refund)');
    expect(todo.note).toContain('https://github.com/o/r/actions/runs/1');
    expect(todo.note).toContain('실패한 작업: yarn test (windows)');
    expect(todo.note).toContain('Expected 900 but got 899');
    expect(todo.note).toContain('원인을 찾아 고쳐 주세요');
    const long = ciFixTodo({ branch: 'main', runs: [run({ verdict: 'failure' })], jobs: [{ run: 'desktop', job: 'j', tail: Array.from({ length: 500 }, (_, i) => `line ${i} ${'x'.repeat(30)}`) }] }, 2000);
    expect(long.note.length).toBeLessThanOrEqual(2000);
    expect(long.note).toContain('line 499'); // 끝부분을 남긴다
  });

  it('로그를 못 읽었으면(로그인 없음) 그렇다고 적는다', () => {
    const todo = ciFixTodo({ branch: 'main', runs: [run({ verdict: 'failure' })], jobs: [] }, 2000);
    expect(todo.note).toContain('로그는 읽지 못했어요');
  });
});
