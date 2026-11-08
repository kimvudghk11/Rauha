import { describe, expect, it } from 'vitest';
import { TodoList } from '../../shared/todo-list.js';
import { TodoService } from './todo-service.js';
import type { TodoStorePort } from './todo-store.js';

function setup(opts: { submit?: (text: string) => { id: string } | null; initial?: TodoList; failSave?: boolean } = {}) {
  let saved = opts.initial ?? TodoList.empty();
  let saves = 0;
  const sent: string[] = [];
  const pushed: number[] = [];
  let n = 0;
  const store: TodoStorePort = {
    load: async () => saved,
    save: async (l) => {
      if (opts.failSave === true) throw new Error('disk');
      saved = l;
      saves += 1;
    },
  };
  const service = new TodoService({
    store,
    newId: () => `t${(n += 1)}`,
    now: () => '2026-11-08T09:00:00.000Z',
    submit: opts.submit ?? ((text) => (sent.push(text), { id: `job-${sent.length}` })),
    onChange: (l) => pushed.push(l.items.length),
  });
  return { service, sent, pushed, saved: () => saved, saves: () => saves };
}

describe('할 일 서비스', () => {
  it('더하면 저장되고 결과에 새 모음이 담긴다', async () => {
    const t = setup();
    const res = await t.service.apply({ kind: 'add', title: '환불 API' });
    expect(res.ok && res.list.items[0]!.title).toBe('환불 API');
    expect(t.saved().items).toHaveLength(1);
  });

  it('규칙을 어기면 이유를 돌려주고 저장하지 않는다', async () => {
    const t = setup();
    const res = await t.service.apply({ kind: 'add', title: '  ' });
    expect(res).toEqual({ ok: false, error: '할 일 제목을 적어 주세요.' });
    expect(t.saves()).toBe(0);
  });

  it('깨진 요청은 거절한다', async () => {
    const t = setup();
    expect((await t.service.apply({ kind: '???' })).ok).toBe(false);
    expect((await t.service.apply(null)).ok).toBe(false);
  });

  it('저장이 실패하면 메모리 모음도 바꾸지 않는다', async () => {
    const t = setup({ failSave: true });
    const res = await t.service.apply({ kind: 'add', title: 'a' });
    expect(res.ok).toBe(false);
    expect((await t.service.get()).items).toEqual([]);
  });

  it('맡기면 메인으로 글이 가고 작업 번호가 붙어 "진행"이 된다', async () => {
    const t = setup();
    await t.service.apply({ kind: 'add', title: '인스턴스 늘리기', repo: 'infra' });
    const id = (await t.service.get()).items[0]!.id;
    const res = await t.service.apply({ kind: 'delegate', id });
    expect(res.ok && res.jobId).toBe('job-1');
    expect(t.sent).toEqual(['@infra 인스턴스 늘리기']);
    expect(t.saved().items[0]).toMatchObject({ columnId: 'doing', jobId: 'job-1' });
  });

  it('메인이 받지 못하면 맡기지 않고 할 일은 그대로다', async () => {
    const t = setup({ submit: () => null });
    await t.service.apply({ kind: 'add', title: 'a' });
    const id = (await t.service.get()).items[0]!.id;
    const res = await t.service.apply({ kind: 'delegate', id });
    expect(res.ok).toBe(false);
    expect(t.saved().items[0]!.columnId).toBe('todo');
  });

  it('이미 맡긴 할 일을 또 맡기면 두 번째 작업을 만들지 않는다', async () => {
    const t = setup();
    await t.service.apply({ kind: 'add', title: 'a' });
    const id = (await t.service.get()).items[0]!.id;
    await t.service.apply({ kind: 'delegate', id });
    const again = await t.service.apply({ kind: 'delegate', id });
    expect(again.ok).toBe(false);
    expect(t.sent).toHaveLength(1);
  });

  it('작업이 끝나면 완료가 되고 화면에 알리며, 같은 알림이 또 와도 한 번만 바뀐다', async () => {
    const t = setup();
    await t.service.apply({ kind: 'add', title: 'a' });
    const id = (await t.service.get()).items[0]!.id;
    await t.service.apply({ kind: 'delegate', id });
    await t.service.jobFinished('job-1', 'done');
    await t.service.jobFinished('job-1', 'done');
    expect(t.saved().items[0]!.columnId).toBe('done');
    expect(t.pushed).toHaveLength(1);
  });

  it('동시에 들어온 요청도 서로 덮어쓰지 않고 모두 남는다', async () => {
    const t = setup();
    await Promise.all(['a', 'b', 'c', 'd'].map((title) => t.service.apply({ kind: 'add', title })));
    expect(t.saved().items).toHaveLength(4);
  });

  it('칸을 더하고 카드를 옮기면 저장되고, 칸 규칙을 어기면 이유를 돌려준다', async () => {
    const t = setup();
    await t.service.apply({ kind: 'add', title: 'a' });
    const added = await t.service.apply({ kind: 'column-add', name: '검토', color: 'purple' });
    expect(added.ok && added.list.columns).toHaveLength(4);
    const id = (await t.service.get()).items[0]!.id;
    const moved = await t.service.apply({ kind: 'move', id, columnId: 'done', beforeId: null });
    expect(moved.ok && moved.list.items[0]!.columnId).toBe('done');
    expect(t.saved().items[0]!.columnId).toBe('done');
    expect(await t.service.apply({ kind: 'column-edit', id: 'todo', patch: { name: ' ' } })).toEqual({ ok: false, error: '칸 이름을 적어 주세요.' });
    expect((await t.service.apply({ kind: 'move', id, columnId: '없는칸' })).ok).toBe(false);
  });

  it('켤 때 살아 있지 않은 작업에 매인 진행은 할 일로 돌아온다', async () => {
    const seed = TodoList.empty().add({ title: 'a' }, () => 'x', '2026-11-08T00:00:00.000Z').attachJob('x', 'old-job', '2026-11-08T00:00:00.000Z');
    const t = setup({ initial: seed });
    await t.service.releaseOrphans(new Set());
    expect(t.saved().items[0]).toMatchObject({ columnId: 'todo', jobId: null });
  });
});
