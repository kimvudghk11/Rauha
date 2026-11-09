import type { ChatSnapshot } from '@rauha/core';
import { describe, expect, it } from 'vitest';
import { ConversationMerge, MAX_KEPT_TURNS } from './conversation-merge.js';

const snap = (turns: string[], carried: [string, string][] = [], lastTitle: string | null = null, savedAt = '2026-11-09T10:00:00.000Z'): ChatSnapshot => ({
  version: 1,
  turns: turns.map((t) => ({ input: t, result: `결과 ${t}` })),
  carried,
  lastTitle,
  savedAt,
});
const inputs = (s: ChatSnapshot) => s.turns.map((t) => t.input);

describe('ConversationMerge', () => {
  it('저장된 대화가 없으면 끝난 업무의 대화가 그대로 저장된다', () => {
    const merged = ConversationMerge.startingFrom(null).finishedWith(null, snap(['a'], [['a.ts', 'h1']], '제목'));
    expect(inputs(merged)).toEqual(['a']);
    expect(merged.carried).toEqual([['a.ts', 'h1']]);
    expect(merged.lastTitle).toBe('제목');
  });

  it('동시에 돈 두 업무는 끝난 순서대로 새 대화만 이어 붙는다', () => {
    const base = snap(['앞']);
    const first = ConversationMerge.startingFrom(base);
    const second = ConversationMerge.startingFrom(base);
    const afterFirst = first.finishedWith(base, snap(['앞', 'B']));
    const afterSecond = second.finishedWith(afterFirst, snap(['앞', 'A']));
    expect(inputs(afterSecond)).toEqual(['앞', 'B', 'A']);
  });

  it('먼저 끝난 업무가 남긴 파일을 나중에 끝난 업무가 지우지 않는다', () => {
    const base = snap(['앞']);
    const a = ConversationMerge.startingFrom(base);
    const b = ConversationMerge.startingFrom(base);
    const afterB = b.finishedWith(base, snap(['앞', 'B'], [['b.ts', 'h2']]));
    const afterA = a.finishedWith(afterB, snap(['앞', 'A'], [['a.ts', 'h1']]));
    expect(Object.fromEntries(afterA.carried)).toEqual({ 'a.ts': 'h1', 'b.ts': 'h2' });
  });

  it('같은 파일이면 나중에 끝난 업무의 내용 값이 이긴다', () => {
    const base = snap(['앞']);
    const a = ConversationMerge.startingFrom(base);
    const afterB = ConversationMerge.startingFrom(base).finishedWith(base, snap(['앞', 'B'], [['x.ts', 'old']]));
    const afterA = a.finishedWith(afterB, snap(['앞', 'A'], [['x.ts', 'new']]));
    expect(afterA.carried).toEqual([['x.ts', 'new']]);
  });

  it('업무가 시작할 때 있던 파일이 끝났을 때 없으면(지웠으면) 합친 뒤에도 없다', () => {
    const base = snap(['앞'], [['gone.ts', 'h0'], ['keep.ts', 'h1']]);
    const merged = ConversationMerge.startingFrom(base).finishedWith(base, snap(['앞', 'A'], [['keep.ts', 'h1']]));
    expect(merged.carried).toEqual([['keep.ts', 'h1']]);
  });

  it('앞 대화는 최근 것만 남기고 오래된 것부터 버린다', () => {
    const many = Array.from({ length: MAX_KEPT_TURNS }, (_, i) => `t${i}`);
    const base = snap(many);
    const merged = ConversationMerge.startingFrom(base).finishedWith(base, snap([...many, '새것']));
    expect(merged.turns).toHaveLength(MAX_KEPT_TURNS);
    expect(inputs(merged)[0]).toBe('t1');
    expect(inputs(merged).at(-1)).toBe('새것');
  });

  it('새 대화가 없는 업무는 제목과 저장 시각만 바꾸고 나머지는 둔다', () => {
    const base = snap(['앞'], [], '옛 제목');
    const merged = ConversationMerge.startingFrom(base).finishedWith(base, snap(['앞'], [], null, '2026-11-09T11:00:00.000Z'));
    expect(inputs(merged)).toEqual(['앞']);
    expect(merged.lastTitle).toBe('옛 제목');
    expect(merged.savedAt).toBe('2026-11-09T11:00:00.000Z');
  });
});
