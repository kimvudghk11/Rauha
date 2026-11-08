import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TodoStore } from './todo-store.js';

let dir = '';
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rauha-todos-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const legacy = { version: 1, items: [{ id: 'a', title: '옛 일', note: '', status: 'doing', priority: 'normal', due: null, repo: null, team: null, jobId: null, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z', completedAt: null }] };

describe('할 일 저장소', () => {
  it('파일이 없으면 기본 세 칸의 빈 보드다', async () => {
    const board = await new TodoStore(join(dir, 'todos.json')).load();
    expect(board.items).toEqual([]);
    expect(board.columns.items.map((c) => c.name)).toEqual(['할 일', '진행 중', '완료']);
  });

  it('세 칸 고정 옛 파일은 새 구조로 바꿔 쓰고 원본을 todos.json.bak-시각으로 남긴다', async () => {
    const file = join(dir, 'todos.json');
    const original = JSON.stringify(legacy);
    await writeFile(file, original, 'utf8');
    const board = await new TodoStore(file, () => '2026-11-08T10:00:00.000Z').load();
    expect(board.get('a')?.columnId).toBe('doing');
    const files = await readdir(dir);
    expect(files.sort()).toEqual(['todos.json', 'todos.json.bak-2026-11-08T100000000Z']);
    expect(await readFile(join(dir, 'todos.json.bak-2026-11-08T100000000Z'), 'utf8')).toBe(original);
    const now = JSON.parse(await readFile(file, 'utf8')) as { version: number; columns: unknown[]; items: { columnId: string }[] };
    expect(now.version).toBe(2);
    expect(now.columns).toHaveLength(3);
    expect(now.items[0]!.columnId).toBe('doing');
  });

  it('새 구조 파일은 다시 읽어도 백업을 만들지 않는다', async () => {
    const file = join(dir, 'todos.json');
    await writeFile(file, JSON.stringify(legacy), 'utf8');
    await new TodoStore(file, () => 'T1').load();
    await new TodoStore(file, () => 'T2').load();
    expect((await readdir(dir)).filter((f) => f.includes('.bak-'))).toEqual(['todos.json.bak-T1']);
  });

  it('깨진 파일은 .broken-시각으로 복사해 두고 빈 보드로 연다', async () => {
    const file = join(dir, 'todos.json');
    await writeFile(file, '{ 깨짐', 'utf8');
    const board = await new TodoStore(file, () => 'T1').load();
    expect(board.items).toEqual([]);
    expect(await readdir(dir)).toContain('todos.json.broken-T1');
  });

  it('저장했다 다시 읽으면 같고, 임시 파일이 남지 않는다', async () => {
    const file = join(dir, 'todos.json');
    const store = new TodoStore(file);
    const board = (await store.load()).add({ title: '새 일', labels: [{ name: '버그', color: 'red' }] }, () => 'x', '2026-11-08T00:00:00.000Z');
    await store.save(board);
    const back = await new TodoStore(file).load();
    expect(back.items[0]).toMatchObject({ title: '새 일' });
    expect(back.items[0]!.labels).toEqual([{ name: '버그', color: 'red' }]);
    expect(await readdir(dir)).toEqual(['todos.json']);
  });
});
