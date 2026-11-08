import type { ApprovalCard, DirectionCard, PermissionAnswer, PermissionRequest } from '@rauha/core';
import { describe, expect, it } from 'vitest';
import { Approvals, type PendingApproval } from './approvals.js';

const request: PermissionRequest = { role: 'implementer', tool: 'Bash', detail: 'git push origin main', reason: '보호 브랜치로 push' };

function approvals() {
  let n = 0;
  const seen: (readonly PendingApproval[])[] = [];
  const a = new Approvals({ newId: () => `p${++n}`, now: () => '2026-11-08T00:00:00.000Z', onChange: (p) => seen.push(p) });
  return { a, seen };
}

describe('Approvals', () => {
  it('요청을 모아 화면에 알리고 화면의 답을 팀원에게 돌려준다', async () => {
    const { a, seen } = approvals();
    const answered = a.ask('j1', request);
    expect(a.pending().map((p) => p.id)).toEqual(['p1']);
    expect(seen.length).toBe(1);
    a.answer('p1', { kind: 'allow-always' });
    expect(await answered).toEqual({ kind: 'allow-always' });
    expect(a.pending()).toEqual([]);
  });

  it('모르는 요청에 답해도 아무 일 없다', () => {
    const { a, seen } = approvals();
    a.answer('없음', { kind: 'allow' });
    expect(seen.length).toBe(0);
  });

  it('같은 요청에 두 번 답해도 처음 답만 쓴다', async () => {
    const { a } = approvals();
    const answered = a.ask('j1', request);
    a.answer('p1', { kind: 'allow' });
    a.answer('p1', { kind: 'deny', note: null });
    expect(await answered).toEqual({ kind: 'allow' });
  });

  it('작업을 멈추면 그 작업의 요청만 거절로 닫는다', async () => {
    const { a } = approvals();
    const mine = a.ask('j1', request);
    const other = a.ask('j2', request);
    a.closeJob('j1');
    expect(await mine).toEqual({ kind: 'deny', note: null });
    expect(a.pending().map((p) => p.jobId)).toEqual(['j2']);
    a.answer('p2', { kind: 'allow' });
    expect(await other).toEqual({ kind: 'allow' });
  });

  it('다르게 해 달라는 말은 거절과 함께 팀원에게 간다', async () => {
    const { a } = approvals();
    const answered = a.ask('j1', request);
    const note: PermissionAnswer = { kind: 'deny', note: 'main 말고 qa로 해 줘' };
    a.answer('p1', note);
    expect(await answered).toEqual(note);
  });
});

const directionCard: DirectionCard = {
  runId: 'r1',
  title: '결제가 왜 두 번 깎여?',
  symptom: '두 번 깎인다',
  options: [
    { id: 'a', title: '멱등 키', summary: 's', pros: [], cons: [], risk: 'r', reversibility: 'easy', touches: [] },
    { id: 'b', title: '락', summary: 's', pros: [], cons: [], risk: 'r', reversibility: 'medium', touches: [] },
  ],
  recommendedId: 'a',
  recommendedReason: '쉽다',
  canGoOn: false,
  docPath: 'docs/analysis/a.md',
};
const approvalCard: ApprovalCard = { runId: 'r1', title: '결제', chosen: '멱등 키', goal: '한 번만', steps: [{ number: 1, title: '키' }], risks: [], docPath: null };

describe('Approvals — 분석 질문 카드', () => {
  const live = () => new AbortController();

  it('질문 카드를 허락 요청 목록에 함께 담고, 고른 방향을 돌려준다', async () => {
    const { a } = approvals();
    const answered = a.askCard('j1', { kind: 'directions', card: directionCard }, live().signal);
    expect(a.pending()[0]).toMatchObject({ id: 'p1', jobId: 'j1', ask: { kind: 'directions' } });
    a.answer('p1', { kind: 'pick', id: 'b', reason: '단순하다' });
    expect(await answered).toEqual({ kind: 'pick', id: 'b', reason: '단순하다' });
    expect(a.pending()).toEqual([]);
  });

  it('내가 직접 쓴 방향도 돌려준다', async () => {
    const { a } = approvals();
    const answered = a.askCard('j1', { kind: 'directions', card: directionCard }, live().signal);
    a.answer('p1', { kind: 'custom', text: '새로 만든다' });
    expect(await answered).toEqual({ kind: 'custom', text: '새로 만든다' });
  });

  it('승인 카드에서 "다르게 해 줘"는 고칠 점으로, 말 없는 거절은 그만두기로 돌아간다', async () => {
    const { a } = approvals();
    const first = a.askCard('j1', { kind: 'approval', card: approvalCard }, live().signal);
    a.answer('p1', { kind: 'deny', note: '테스트를 더 잘게' });
    expect(await first).toEqual({ kind: 'revise', note: '테스트를 더 잘게' });
    const second = a.askCard('j1', { kind: 'approval', card: approvalCard }, live().signal);
    a.answer('p2', { kind: 'deny', note: null });
    expect(await second).toEqual({ kind: 'stop' });
  });

  it('승인 카드에서 이대로 고치기를 누르면 proceed다', async () => {
    const { a } = approvals();
    const answered = a.askCard('j1', { kind: 'approval', card: approvalCard }, live().signal);
    a.answer('p1', { kind: 'proceed' });
    expect(await answered).toEqual({ kind: 'proceed' });
  });

  it('카드 종류에 맞지 않는 답은 무시하고 계속 기다린다 (허락 버튼이 방향 카드에 닿지 않는다)', async () => {
    const { a } = approvals();
    const answered = a.askCard('j1', { kind: 'directions', card: directionCard }, live().signal);
    a.answer('p1', { kind: 'allow' });
    a.answer('p1', { kind: 'proceed' });
    expect(a.pending()).toHaveLength(1);
    a.answer('p1', { kind: 'stop' });
    expect(await answered).toEqual({ kind: 'stop' });
  });

  it('허락 요청에 질문 카드의 답을 보내도 무시한다', async () => {
    const { a } = approvals();
    const answered = a.ask('j1', request);
    a.answer('p1', { kind: 'pick', id: 'a' });
    expect(a.pending()).toHaveLength(1);
    a.answer('p1', { kind: 'allow' });
    expect(await answered).toEqual({ kind: 'allow' });
  });

  it('기다림 한도로 신호가 꺼지면 카드를 닫고 그만두기로 답한다', async () => {
    const { a, seen } = approvals();
    const controller = live();
    const answered = a.askCard('j1', { kind: 'directions', card: directionCard }, controller.signal);
    controller.abort();
    expect(await answered).toEqual({ kind: 'stop' });
    expect(a.pending()).toEqual([]);
    expect(seen.at(-1)).toEqual([]);
  });

  it('이미 꺼진 신호로는 카드를 띄우지 않는다', async () => {
    const { a, seen } = approvals();
    const controller = live();
    controller.abort();
    expect(await a.askCard('j1', { kind: 'directions', card: directionCard }, controller.signal)).toEqual({ kind: 'stop' });
    expect(seen).toEqual([]);
  });

  it('답한 뒤에 신호가 꺼져도 이미 낸 답은 바뀌지 않는다', async () => {
    const { a } = approvals();
    const controller = live();
    const answered = a.askCard('j1', { kind: 'directions', card: directionCard }, controller.signal);
    a.answer('p1', { kind: 'pick', id: 'a' });
    controller.abort();
    expect(await answered).toEqual({ kind: 'pick', id: 'a' });
  });

  it('작업을 멈추면 그 작업의 질문 카드는 그만두기로 닫힌다', async () => {
    const { a } = approvals();
    const card = a.askCard('j1', { kind: 'directions', card: directionCard }, live().signal);
    const permission = a.ask('j1', request);
    a.closeJob('j1');
    expect(await card).toEqual({ kind: 'stop' });
    expect(await permission).toEqual({ kind: 'deny', note: null });
  });
});
