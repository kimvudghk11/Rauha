import type { DirectionCard } from '@rauha/core';
import { describe, expect, it } from 'vitest';
import { Approvals } from './approvals.js';
import { askCardFlow } from './ask-flow.js';
import { JobTrail } from './job-trail.js';

const card: DirectionCard = {
  runId: 'r1',
  title: '결제가 왜 두 번 깎여?',
  symptom: '두 번 깎인다',
  options: [
    { id: 'a', title: '멱등 키', summary: 's', pros: [], cons: [], risk: 'r', reversibility: 'easy', touches: [] },
    { id: 'b', title: '락', summary: 's', pros: [], cons: [], risk: 'r', reversibility: 'medium', touches: [] },
  ],
  recommendedId: 'a',
  recommendedReason: '되돌리기 쉽다',
  canGoOn: false,
  docPath: null,
};

function flow(over: { over?: Set<string> } = {}) {
  let n = 0;
  const approvals = new Approvals({ newId: () => `p${++n}`, now: () => '2026-11-08T00:00:00.000Z', onChange: () => undefined });
  const trail = new JobTrail();
  const notified: [string, string][] = [];
  const ask = askCardFlow({ approvals, trail, notify: (jobId, headline) => notified.push([jobId, headline]), isOver: (id) => over.over?.has(id) === true });
  return { approvals, trail, notified, ask };
}

describe('askCardFlow', () => {
  it('카드를 올리면서 알리고, 고른 방향을 AI 추천과 함께 작업 기록거리에 남긴다', async () => {
    const { approvals, trail, notified, ask } = flow();
    const reply = ask('j1', { kind: 'directions', card }, new AbortController().signal);
    expect(notified).toEqual([['j1', '고칠 방향을 골라 주세요 · 결제가 왜 두 번 깎여?']]);
    approvals.answer('p1', { kind: 'pick', id: 'b', reason: '락이 더 단순하다' });
    expect(await reply).toMatchObject({ kind: 'pick', id: 'b' });
    expect(trail.take('j1').direction).toEqual({ recommended: '멱등 키', chosen: '락', reason: '락이 더 단순하다' });
  });

  it('추천을 그대로 골랐으면 AI의 추천 이유가 이유로 남는다', async () => {
    const { approvals, trail, ask } = flow();
    const reply = ask('j1', { kind: 'directions', card }, new AbortController().signal);
    approvals.answer('p1', { kind: 'pick', id: 'a' });
    await reply;
    expect(trail.take('j1').direction).toEqual({ recommended: '멱등 키', chosen: '멱등 키', reason: '되돌리기 쉽다' });
  });

  it('직접 쓴 방향도 기록한다', async () => {
    const { approvals, trail, ask } = flow();
    const reply = ask('j1', { kind: 'directions', card }, new AbortController().signal);
    approvals.answer('p1', { kind: 'custom', text: '결제 모듈을 새로 만든다' });
    await reply;
    expect(trail.take('j1').direction).toMatchObject({ recommended: '멱등 키', chosen: '결제 모듈을 새로 만든다' });
  });

  it('그만두거나 기다림 한도로 닫힌 카드는 선택으로 기록하지 않는다', async () => {
    const { approvals, trail, ask } = flow();
    const controller = new AbortController();
    const timedOut = ask('j1', { kind: 'directions', card }, controller.signal);
    controller.abort();
    expect(await timedOut).toEqual({ kind: 'stop' });
    const stopped = ask('j2', { kind: 'directions', card }, new AbortController().signal);
    approvals.answer('p2', { kind: 'stop' });
    await stopped;
    expect(trail.take('j1').direction).toBeNull();
    expect(trail.take('j2').direction).toBeNull();
  });

  it('작업이 이미 끝난 뒤의 답(멈춤으로 닫힌 카드)은 기록하지 않는다', async () => {
    const { approvals, trail, ask } = flow({ over: new Set(['j1']) });
    const reply = ask('j1', { kind: 'directions', card }, new AbortController().signal);
    approvals.answer('p1', { kind: 'pick', id: 'b' });
    await reply;
    expect(trail.take('j1').direction).toBeNull();
  });

  it('보여 주지 않은 방향 번호는 기록하지 않는다', async () => {
    const { approvals, trail, ask } = flow();
    const reply = ask('j1', { kind: 'directions', card }, new AbortController().signal);
    approvals.answer('p1', { kind: 'pick', id: 'zzz' });
    await reply;
    expect(trail.take('j1').direction).toBeNull();
  });

  it('승인 카드는 방향 기록을 건드리지 않는다', async () => {
    const { approvals, trail, ask } = flow();
    const reply = ask('j1', { kind: 'approval', card: { runId: 'r1', title: 't', chosen: '락', goal: 'g', steps: [{ number: 1, title: 's' }], risks: [], docPath: null } }, new AbortController().signal);
    approvals.answer('p1', { kind: 'proceed' });
    expect(await reply).toEqual({ kind: 'proceed' });
    expect(trail.take('j1').direction).toBeNull();
  });
});
