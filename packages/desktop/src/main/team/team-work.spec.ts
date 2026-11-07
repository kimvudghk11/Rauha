import type { PermissionAnswer, TurnOutcome } from '@rauha/core';
import { Job, JobRunner } from '@rauha/core/jobs';
import { describe, expect, it } from 'vitest';
import { teamWork, type TeamIo } from './team-work.js';

const flush = () => new Promise((r) => setTimeout(r, 0));
const answer = (text: string): TurnOutcome => ({ kind: 'answer', answer: text, checked: [], costUsd: 0, durationMs: 1, basis: null });

function setup(handle: (io: TeamIo, input: string) => Promise<TurnOutcome>, askUser: (id: string) => Promise<PermissionAnswer> = async () => ({ kind: 'allow' })) {
  const ios: TeamIo[] = [];
  const runner = JobRunner.start({
    work: teamWork({
      newSession: (io) => {
        ios.push(io);
        return { handle: (input) => handle(io, input) };
      },
      askUser,
    }),
    newId: (() => {
      let n = 0;
      return () => `j${++n}`;
    })(),
    now: () => '2026-11-08T00:00:00.000Z',
  });
  return { runner, ios };
}

describe('teamWork', () => {
  it('작업마다 새 세션을 만들어 요청을 넘기고 결과 글을 작업에 붙인다', async () => {
    const { runner, ios } = setup(async (_io, input) => answer(`답: ${input}`));
    runner.submit('A');
    runner.submit('B');
    await runner.idle();
    expect(ios.length).toBe(2);
    expect(runner.board.find('j1')?.result).toBe('답: A');
    expect(runner.board.find('j2')?.status).toBe('done');
  });

  it('팀원이 일을 시작했다고 알리면 그 줄과 역할이 작업에 남는다', async () => {
    const { runner } = setup(async (io) => {
      io.progress.step('테스트를 쓰는 중', 'tester');
      return answer('끝');
    });
    runner.submit('A');
    await runner.idle();
    expect(runner.board.find('j1')?.notes[0]).toMatchObject({ role: 'tester', message: '테스트를 쓰는 중' });
  });

  it('허락을 기다리는 동안 작업은 기다림이고, 답이 오면 이어서 진행한다', async () => {
    let allow!: (a: PermissionAnswer) => void;
    const { runner } = setup(
      async (io) => {
        const a = await io.ask({ role: 'implementer', tool: 'Bash', detail: 'git push', reason: '푸시' });
        return answer(a.kind);
      },
      () => new Promise((resolve) => (allow = resolve)),
    );
    runner.submit('A');
    await flush();
    expect(runner.board.find('j1')?.status).toBe('waiting');
    allow({ kind: 'allow' });
    await runner.idle();
    expect(runner.board.find('j1')?.result).toBe('allow');
  });

  it('묻지 않는 사용자 쪽이라 해석은 추천대로, 지난 작업은 새 작업으로 간다', async () => {
    let seen: TeamIo | null = null;
    const { runner } = setup(async (io) => {
      seen = io;
      return answer('끝');
    });
    runner.submit('A');
    await runner.idle();
    expect(seen!.user.interactive).toBe(false);
    expect(await seen!.user.choose({ question: 'q', chosen: 'a', alternatives: [] } as never)).toBe(0);
    expect(await seen!.user.pickPast([])).toBeNull();
  });

  it('멈추면 세션이 끝나기를 기다리지 않고 신호를 끄고 멈춤으로 끝낸다', async () => {
    const { runner, ios } = setup(() => new Promise<TurnOutcome>(() => void 0));
    runner.submit('A');
    await flush();
    runner.stop('j1');
    expect(ios[0]!.signal.aborted).toBe(true);
    expect(runner.board.find('j1')?.status).toBe('stopped');
    void Job;
  });

  it('세션이 실패하면 멈춤으로 표시하고 이유를 남긴다', async () => {
    const { runner } = setup(async () => {
      throw new Error('로그인 풀림');
    });
    runner.submit('A');
    await runner.idle();
    expect(runner.board.find('j1')?.status).toBe('stopped');
    expect(runner.board.find('j1')?.stopReason).toBe('로그인 풀림');
  });
});
