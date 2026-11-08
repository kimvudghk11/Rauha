import { describe, expect, it } from 'vitest';
import { isLegacyTodoFile, migrateLegacyTodos } from './todo-migrate.js';

const legacyItem = (id: string, status: string) => ({ id, title: `일 ${id}`, note: '메모', status, priority: 'high', due: '2026-12-01', repo: 'api', team: 'dev', jobId: null, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-02T00:00:00.000Z', completedAt: null });

describe('옛 할 일 파일(세 칸 고정) 알아보기', () => {
  it('version 1이거나 version이 없고 items가 있으면 옛 파일이다', () => {
    expect(isLegacyTodoFile({ version: 1, items: [] })).toBe(true);
    expect(isLegacyTodoFile({ items: [legacyItem('a', 'todo')] })).toBe(true);
  });
  it('version 2나 아무것도 아닌 값은 옛 파일이 아니다', () => {
    expect(isLegacyTodoFile({ version: 2, columns: [], items: [] })).toBe(false);
    expect(isLegacyTodoFile(null)).toBe(false);
    expect(isLegacyTodoFile([])).toBe(false);
    expect(isLegacyTodoFile({ version: 1 })).toBe(false);
  });
});

describe('옛 파일을 새 구조로 바꾸기', () => {
  const out = migrateLegacyTodos({ version: 1, items: [legacyItem('a', 'todo'), legacyItem('b', 'doing'), legacyItem('c', 'done')] }) as { version: number; columns: { id: string; name: string; done: boolean }[]; items: Record<string, unknown>[] };

  it('기본 세 칸(할 일 / 진행 중 / 완료)이 생기고 완료 칸은 "완료로 취급"이다', () => {
    expect(out.version).toBe(2);
    expect(out.columns.map((c) => [c.id, c.name, c.done])).toEqual([['todo', '할 일', false], ['doing', '진행 중', false], ['done', '완료', true]]);
  });

  it('상태 문자열은 같은 번호의 칸으로 옮겨 가고 status 키는 사라진다', () => {
    expect(out.items.map((i) => i['columnId'])).toEqual(['todo', 'doing', 'done']);
    expect(out.items.every((i) => !('status' in i))).toBe(true);
  });

  it('원래 순서와 다른 값은 그대로 두고, 새 속성은 빈 값으로 채운다', () => {
    expect(out.items.map((i) => i['id'])).toEqual(['a', 'b', 'c']);
    expect(out.items[0]).toMatchObject({ title: '일 a', note: '메모', priority: 'high', due: '2026-12-01', repo: 'api', team: 'dev', checklist: [], labels: [] });
  });

  it('모르는 상태의 항목은 columnId 없이 남겨 읽을 때 걸러지게 한다', () => {
    const odd = migrateLegacyTodos({ items: [legacyItem('x', '???')] }) as { items: Record<string, unknown>[] };
    expect(odd.items[0]!['columnId']).toBeUndefined();
  });

  it('객체가 아닌 항목은 그대로 둔다(읽을 때 걸러진다)', () => {
    const odd = migrateLegacyTodos({ items: [5, null] }) as { items: unknown[] };
    expect(odd.items).toEqual([5, null]);
  });

  it('원본 객체를 바꾸지 않는다', () => {
    const src = { version: 1, items: [legacyItem('a', 'todo')] };
    migrateLegacyTodos(src);
    expect(src.items[0]).toHaveProperty('status', 'todo');
  });
});
