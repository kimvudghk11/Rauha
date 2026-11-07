import type { PermissionAnswer, PermissionRequest } from '@rauha/core';
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
