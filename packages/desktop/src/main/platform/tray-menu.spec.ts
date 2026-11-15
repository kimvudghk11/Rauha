import { describe, expect, it } from 'vitest';
import { trayView, type TrayJob } from './tray-menu.js';

const job = (id: string, status: TrayJob['status'], request = `요청 ${id}`): TrayJob => ({ id, request, status });

describe('메뉴 막대 아이콘', () => {
  it('일이 없으면 아이콘 옆 글자 없이 쉬는 중이라고 한다', () => {
    const v = trayView({ jobs: [], pending: 0 });
    expect(v.title).toBe('');
    expect(v.tooltip).toBe('rauha · 쉬는 중');
    expect(v.items[0]).toEqual({ kind: 'label', text: '쉬는 중이에요' });
  });

  it('도는 작업 수를 아이콘 옆에 숫자로 보인다', () => {
    const v = trayView({ jobs: [job('a', 'running'), job('b', 'running'), job('c', 'queued')], pending: 0 });
    expect(v.title).toBe('2');
    expect(v.items[0]).toEqual({ kind: 'label', text: '일하는 중 2 · 대기 1' });
  });

  it('허락이 기다리면 숫자 대신 느낌표로 먼저 알린다', () => {
    const v = trayView({ jobs: [job('a', 'running'), job('b', 'waiting')], pending: 2 });
    expect(v.title).toBe('!2');
    expect(v.tooltip).toBe('rauha · 허락 2개 기다리는 중');
    expect(v.items).toContainEqual({ kind: 'job', id: 'b', text: '허락 기다리는 작업 보기 (2)' });
  });

  it('최근 작업은 상태 기호와 함께 3개까지, 진행 중인 것부터 보인다', () => {
    const v = trayView({ jobs: [job('d1', 'done'), job('s1', 'stopped'), job('r1', 'running'), job('d2', 'done')], pending: 0 });
    const jobs = v.items.filter((i) => i.kind === 'job');
    expect(jobs.map((j) => j.text)).toEqual(['● 요청 r1', '✓ 요청 d2', '■ 요청 s1']);
  });

  it('긴 요청은 40자에서 자른다', () => {
    const v = trayView({ jobs: [job('a', 'running', '가'.repeat(60))], pending: 0 });
    expect(v.items.find((i) => i.kind === 'job')?.text).toBe(`● ${'가'.repeat(39)}…`);
  });

  it('열기와 종료는 언제나 있다', () => {
    const kinds = trayView({ jobs: [], pending: 0 }).items.map((i) => i.kind);
    expect(kinds).toContain('open');
    expect(kinds[kinds.length - 1]).toBe('quit');
  });
});
