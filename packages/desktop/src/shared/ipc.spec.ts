import { describe, expect, it } from 'vitest';
import { Job, JobBoard } from '@rauha/core/jobs';
import { boardView, castOf, jobView, stepsOf } from './ipc.js';

const AT = '2026-11-08T00:00:00.000Z';
const job = (id = 'a', request = '결제 타임아웃 원인 찾아줘') => Job.queue({ id, request, at: AT })!;

describe('boardView', () => {
  it('작업판을 화면용 모양으로 바꾼다 — 상태 수와 상한을 담는다', () => {
    const a = job('a');
    const b = job('b', '온보딩 시안');
    const board = JobBoard.empty().add(a).add(b);
    const view = boardView(board.replace(a.start()));
    expect(view.jobs.map((j) => [j.id, j.status])).toEqual([['a', 'running'], ['b', 'queued']]);
    expect(view).toMatchObject({ running: 1, waiting: 0, queued: 1, limit: 3 });
  });

  it('멈춘 이유를 함께 보낸다', () => {
    const view = boardView(JobBoard.empty().add(job().stop('사용자가 멈춤', AT)));
    expect(view.jobs[0]?.stopReason).toBe('사용자가 멈춤');
  });
});

describe('jobView', () => {
  it('팀원 기록이 없으면 방에는 팀장(Delfi)만 서 있다', () => {
    const view = jobView(job().start());
    expect(view.cast).toEqual(['intake']);
    expect(view.role).toBeNull();
    expect(view.lastLine).toBeNull();
  });

  it('지금 일하는 팀원과 마지막 한 줄을 알린다', () => {
    const view = jobView(job().start().noted('tester', '재현 테스트 작성', AT).noted(null, '파일 3개 읽음', AT));
    expect(view.role).toBe('tester');
    expect(view.roleName).toBe('테스트 팀원');
    expect(view.lastLine).toBe('파일 3개 읽음');
  });

  it('방에 서는 캐릭터는 많아야 셋이고 같은 팀원은 한 번만 센다', () => {
    const j = job().start().noted('tester', 'a', AT).noted('implementer', 'b', AT).noted('tester', 'c', AT).noted('reviewer', 'd', AT).noted('writer', 'e', AT);
    expect(castOf(j)).toEqual(['implementer', 'reviewer', 'writer']);
  });

  it('돈(달러)은 화면용 모양 어디에도 들어가지 않는다', () => {
    expect(JSON.stringify(jobView(job().start()))).not.toContain('$');
  });
});

describe('jobView 더 깊게', () => {
  it('답의 꼬리표를 화면용으로 담는다', () => {
    const view = jobView(job().start().withResult('답', { canGoDeeper: true, knowledgeMissing: false }).finish(AT));
    expect(view).toMatchObject({ canGoDeeper: true, knowledgeMissing: false });
    expect(jobView(job()).canGoDeeper).toBe(false);
  });

  it('찾아본 도구 한 줄은 있을 때만 담고 없으면 null이다', () => {
    expect(jobView(job().start().withResult('답', { canGoDeeper: false, knowledgeMissing: false, toolsLine: 'Grep 3 · Read 5' }).finish(AT)).toolsLine).toBe('Grep 3 · Read 5');
    expect(jobView(job()).toolsLine).toBeNull();
  });
});

describe('stepsOf', () => {
  it('나온 단계를 순서대로 쓰고 지금 단계만 now로 표시한다', () => {
    const j = job().start().noted('tester', 'a', AT).noted('implementer', 'b', AT);
    expect(stepsOf(j)).toEqual([{ label: '테스트', state: 'done' }, { label: '구현', state: 'now' }]);
  });

  it('단계가 없는 역할(라우터·답변)은 막대에 넣지 않는다', () => {
    expect(stepsOf(job().start().noted('router', 'a', AT))).toEqual([]);
  });

  it('끝난 작업은 모든 단계가 done이다', () => {
    const done = job().start().noted('tester', 'a', AT).finish(AT);
    expect(stepsOf(done).every((s) => s.state === 'done')).toBe(true);
  });
});
