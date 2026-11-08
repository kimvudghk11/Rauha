import { describe, expect, it } from 'vitest';
import { Checklist, CHECKLIST_MAX, CHECKLIST_TEXT_LIMIT } from './todo-checklist.js';

let n = 0;
const id = () => `i${(n += 1)}`;

describe('체크리스트', () => {
  it('항목을 더하면 안 한 상태로 맨 끝에 붙는다', () => {
    const list = Checklist.empty().add('테스트 쓰기', id()).add('구현', id());
    expect(list.items.map((i) => [i.text, i.done])).toEqual([['테스트 쓰기', false], ['구현', false]]);
  });

  it('항목 글은 앞뒤 공백을 지우고, 비었거나 120자를 넘으면 거절한다', () => {
    expect(Checklist.empty().add('  a  ', 'x').items[0]!.text).toBe('a');
    expect(() => Checklist.empty().add('   ', 'x')).toThrow(/비어/);
    expect(() => Checklist.empty().add('a'.repeat(CHECKLIST_TEXT_LIMIT + 1), 'x')).toThrow(/120자/);
  });

  it('항목은 50개까지다', () => {
    let list = Checklist.empty();
    for (let i = 0; i < CHECKLIST_MAX; i += 1) list = list.add(`일 ${i}`, `k${i}`);
    expect(() => list.add('하나 더', 'z')).toThrow(/50개/);
  });

  it('체크했다 풀 수 있고 항목을 지울 수 있다', () => {
    const list = Checklist.empty().add('a', 'a').add('b', 'b');
    expect(list.toggle('a').items[0]!.done).toBe(true);
    expect(list.toggle('a').toggle('a').items[0]!.done).toBe(false);
    expect(list.remove('a').items.map((i) => i.id)).toEqual(['b']);
  });

  it('항목 글을 고칠 수 있고 같은 규칙으로 검사한다', () => {
    const list = Checklist.empty().add('a', 'a');
    expect(list.rename('a', ' 새 글 ').items[0]!.text).toBe('새 글');
    expect(() => list.rename('a', '')).toThrow(/비어/);
  });

  it('없는 항목을 만지면 거절한다', () => {
    expect(() => Checklist.empty().toggle('없음')).toThrow(/찾지 못/);
  });

  it('진행률은 한 것 / 전체이고, 비어 있으면 0 / 0 이다', () => {
    const list = Checklist.empty().add('a', 'a').add('b', 'b').add('c', 'c').add('d', 'd').toggle('a');
    expect(list.progress()).toEqual({ done: 1, total: 4, percent: 25 });
    expect(list.toggle('b').toggle('c').toggle('d').progress()).toEqual({ done: 4, total: 4, percent: 100 });
    expect(Checklist.empty().progress()).toEqual({ done: 0, total: 0, percent: 0 });
  });

  it('저장된 값에서 다시 만들 때도 같은 규칙으로 검사한다(번호가 겹치면 거절)', () => {
    expect(Checklist.restore([{ id: 'a', text: 'x', done: true }]).progress().done).toBe(1);
    expect(() => Checklist.restore([{ id: 'a', text: 'x', done: false }, { id: 'a', text: 'y', done: false }])).toThrow(/겹/);
    expect(() => Checklist.restore([{ id: '', text: 'x', done: false }])).toThrow(/번호/);
  });
});
