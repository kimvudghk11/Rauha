import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RecordBook, RecordEntry, type RecordInput } from '../../shared/record-book.js';
import { RecordService } from './record-service.js';
import { RecordStore, type RecordStorePort } from './record-store.js';
import { TodoStore } from './todo-store.js';

const input = (id: string, minute: number): RecordInput => ({
  id,
  request: `작업 ${id}`,
  result: '끝냈어요',
  status: 'done',
  stopReason: null,
  roles: [],
  stages: [],
  queuedAt: `2026-11-08T01:0${minute}:00.000Z`,
  endedAt: `2026-11-08T01:1${minute}:00.000Z`,
  repo: null,
  files: [],
  approvals: [],
  direction: null,
});

function memory(initial = RecordBook.empty()) {
  let saved = initial;
  const archived: RecordEntry[] = [];
  const store: RecordStorePort = { load: async () => saved, save: async (b) => void (saved = b), archive: async (e) => void archived.push(...e) };
  const pushed: number[] = [];
  const service = (max?: number) => new RecordService({ store, onChange: (b) => pushed.push(b.entries.length), ...(max === undefined ? {} : { max }) });
  return { service, saved: () => saved, archived, pushed };
}

describe('기록 서비스', () => {
  it('끝난 작업을 기록하고 화면에 알린다', async () => {
    const m = memory();
    await m.service().capture(input('a', 1));
    expect(m.saved().entries.map((e) => e.id)).toEqual(['a']);
    expect(m.pushed).toEqual([1]);
  });

  it('같은 작업을 또 알려 와도 한 번만 남고 다시 알리지 않는다', async () => {
    const m = memory();
    const s = m.service();
    await s.capture(input('a', 1));
    await s.capture(input('a', 1));
    expect(m.saved().entries).toHaveLength(1);
    expect(m.pushed).toHaveLength(1);
  });

  it('요청이 빈 작업은 기록하지 않고 조용히 넘어간다', async () => {
    const m = memory();
    await m.service().capture({ ...input('a', 1), request: '  ' });
    expect(m.saved().entries).toEqual([]);
  });

  it('상한을 넘으면 오래된 기록을 지우지 않고 보관으로 옮긴다', async () => {
    const m = memory();
    const s = m.service(2);
    for (const [i, id] of ['a', 'b', 'c'].entries()) await s.capture(input(id, i));
    expect(m.saved().entries.map((e) => e.id)).toEqual(['c', 'b']);
    expect(m.archived.map((e) => e.id)).toEqual(['a']);
  });

  it('태그·메모·지우기 요청을 처리하고, 틀린 요청은 이유를 돌려준다', async () => {
    const m = memory();
    const s = m.service();
    await s.capture(input('a', 1));
    expect((await s.apply({ kind: 'tags', id: 'a', tags: ['design'] })).ok).toBe(true);
    expect(m.saved().get('a')!.tags).toEqual(['design']);
    expect(await s.apply({ kind: 'tags', id: 'a', tags: [] })).toEqual({ ok: false, error: '태그는 하나 이상 골라 주세요.' });
    expect(await s.apply({ kind: 'remove', id: 'nope' })).toEqual({ ok: false, error: '그 기록을 찾지 못했어요.' });
    expect((await s.apply({ kind: 'remove', id: 'a' })).ok).toBe(true);
    expect(m.saved().entries).toEqual([]);
  });
});

describe('파일 저장소', () => {
  let dir = '';
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rauha-store-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('기록은 저장했다 다시 열어도 그대로다(앱을 다시 켜도 유지)', async () => {
    const file = join(dir, 'records.json');
    await new RecordService({ store: new RecordStore(file), onChange: () => undefined }).capture(input('a', 1));
    const again = await new RecordService({ store: new RecordStore(file), onChange: () => undefined }).get();
    expect(again.entries.map((e) => e.id)).toEqual(['a']);
  });

  it('깨진 기록 파일은 복사본을 남기고 빈 기록으로 열린다(앱이 못 열리지 않는다)', async () => {
    const file = join(dir, 'records.json');
    await writeFile(file, '{ 깨짐', 'utf8');
    expect((await new RecordStore(file, () => 'T1').load()).entries).toEqual([]);
    expect(await readFile(`${file}.broken-T1`, 'utf8')).toBe('{ 깨짐');
  });

  it('일부 항목만 깨졌으면 나머지는 살리고 원본을 복사해 둔다', async () => {
    const file = join(dir, 'records.json');
    const store = new RecordStore(file, () => 'T2');
    await store.save(RecordBook.empty().add(RecordEntry.capture(input('a', 1))));
    const good = JSON.parse(await readFile(file, 'utf8')).entries[0];
    await writeFile(file, JSON.stringify({ entries: [good, { id: 'broken' }] }), 'utf8');
    expect((await store.load()).entries.map((e) => e.id)).toEqual(['a']);
    expect(JSON.parse(await readFile(`${file}.broken-T2`, 'utf8')).entries).toHaveLength(2);
  });

  it('할 일도 깨진 파일은 복사본을 남기고 빈 목록으로 연다', async () => {
    const file = join(dir, 'todos.json');
    await writeFile(file, 'not json', 'utf8');
    expect((await new TodoStore(file, () => 'T3').load()).items).toEqual([]);
    expect(await readFile(`${file}.broken-T3`, 'utf8')).toBe('not json');
  });

  it('넘친 기록은 보관 파일에 한 줄씩 쌓인다', async () => {
    const file = join(dir, 'records.json');
    const service = new RecordService({ store: new RecordStore(file), onChange: () => undefined, max: 1 });
    await service.capture(input('a', 1));
    await service.capture(input('b', 2));
    const lines = (await readFile(`${file}.archive.jsonl`, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).id).toBe('a');
  });
});
