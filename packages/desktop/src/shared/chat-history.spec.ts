import { describe, expect, it } from 'vitest';
import { ChatHistory, HISTORY_LIMITS, INTERRUPTED_REASON, type HistoryEntry } from './chat-history.js';

const entry = (id: string, over: Partial<HistoryEntry> = {}): HistoryEntry => ({
  id,
  request: `요청 ${id}`,
  status: 'done',
  stopReason: null,
  result: `결과 ${id}`,
  toolsLine: null,
  cast: ['intake', 'implementer'],
  queuedAt: '2026-11-10T01:00:00.000Z',
  endedAt: '2026-11-10T01:01:00.000Z',
  ...over,
});

describe('ChatHistory', () => {
  it('끝난 일은 요청·결과·이유·역할 그대로 복원한다', () => {
    const history = ChatHistory.empty().remember([entry('a'), entry('b', { status: 'stopped', stopReason: '사용자가 멈춤', result: null })]);
    const [a, b] = history.restored();
    expect(a).toMatchObject({ request: '요청 a', result: '결과 a', status: 'done', cast: ['intake', 'implementer'] });
    expect(b).toMatchObject({ status: 'stopped', stopReason: '사용자가 멈춤' });
  });

  it('돌던 일은 중단됨 상태로 복원한다', () => {
    const history = ChatHistory.empty().remember([entry('a', { status: 'running', result: null, endedAt: null })]);
    expect(history.restored()[0]).toMatchObject({ status: 'stopped', stopReason: INTERRUPTED_REASON, result: null });
  });

  it('같은 일이 다시 들어오면 덮어쓰고 순서는 처음 그대로다', () => {
    const history = ChatHistory.empty().remember([entry('a', { status: 'running' }), entry('b')]).remember([entry('a')]);
    expect(history.items.map((e) => e.id)).toEqual(['a', 'b']);
    expect(history.items[0]?.status).toBe('done');
  });

  it('최근 50개만 남기고 오래된 것부터 뺀다', () => {
    const many = Array.from({ length: HISTORY_LIMITS.jobs + 5 }, (_, i) => entry(String(i)));
    const history = ChatHistory.empty().remember(many);
    expect(history.items).toHaveLength(HISTORY_LIMITS.jobs);
    expect(history.items[0]?.id).toBe('5');
  });

  it('요청·결과·이유가 너무 길면 한도에서 자른다', () => {
    const long = 'x'.repeat(HISTORY_LIMITS.result + 100);
    const [e] = ChatHistory.empty().remember([entry('a', { request: long, result: long, stopReason: long })]).items;
    expect(e?.request.length).toBeLessThanOrEqual(HISTORY_LIMITS.request);
    expect(e?.result?.length).toBeLessThanOrEqual(HISTORY_LIMITS.result);
    expect(e?.stopReason?.length).toBeLessThanOrEqual(HISTORY_LIMITS.reason);
  });

  it('토큰·키처럼 보이는 값은 가려서 담는다', () => {
    const [e] = ChatHistory.empty().remember([entry('a', { request: '키는 sk-abcdefghijklmnopqrstuv 야', result: 'ghp_abcdefghijklmnopqrstuvwx' })]).items;
    expect(e?.request).not.toContain('sk-abcdef');
    expect(e?.result).not.toContain('ghp_');
  });

  it('돌던 일에는 결과를 담지 않는다', () => {
    const [e] = ChatHistory.empty().remember([entry('a', { status: 'running', result: '중간 글', cast: ['intake'] })]).items;
    expect(e?.result).toBeNull();
    expect(e?.cast).toEqual([]);
  });

  it('초기화하면 아무것도 복원하지 않는다', () => {
    const history = ChatHistory.empty().remember([entry('a')]).cleared();
    expect(history.isEmpty).toBe(true);
    expect(history.restored()).toEqual([]);
  });

  it('초기화 뒤에도 도는 일은 기록에서 뺄 수 있다', () => {
    const history = ChatHistory.empty().remember([entry('a'), entry('b')]).without(new Set(['a']));
    expect(history.items.map((e) => e.id)).toEqual(['b']);
  });
});
