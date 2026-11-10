import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChatHistoryStore } from '../data/chat-history-store.js';
import type { JobView } from '../../shared/ipc.js';
import { ChatHistoryKeeper } from './chat-history-keeper.js';

let dir = '';
let file = '';
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rauha-chat-'));
  file = join(dir, 'chat-history.json');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const view = (id: string, over: Partial<JobView> = {}): JobView => ({
  id,
  request: `요청 ${id}`,
  status: 'done',
  stopReason: null,
  queuedAt: 't0',
  endedAt: 't1',
  role: null,
  roleName: null,
  cast: ['intake'],
  steps: [],
  lastLine: null,
  result: `결과 ${id}`,
  canGoDeeper: false,
  knowledgeMissing: false,
  toolsLine: null,
  notes: [],
  ...over,
});

const reopen = async () => {
  const keeper = new ChatHistoryKeeper(new ChatHistoryStore(file));
  await keeper.load();
  return keeper;
};

describe('채팅 기록 보관', () => {
  it('저장한 일은 앱을 다시 켜면 돌아온다', async () => {
    const first = await reopen();
    await first.observe([view('a'), view('b', { status: 'stopped', stopReason: '사용자가 멈춤', result: null })]);
    const keeper = await reopen();
    expect(keeper.restored().map((v) => [v.id, v.status, v.result])).toEqual([['a', 'done', '결과 a'], ['b', 'stopped', null]]);
  });

  it('돌던 일은 다시 켜면 중단됨으로 돌아온다', async () => {
    const first = await reopen();
    await first.observe([view('a', { status: 'running', result: null, endedAt: null })]);
    const keeper = await reopen();
    expect(keeper.restored()[0]).toMatchObject({ status: 'stopped' });
  });

  it('초기화한 뒤에는 복원하지 않고, 그때 돌던 일이 끝나도 다시 담지 않는다', async () => {
    const first = await reopen();
    await first.observe([view('a'), view('b', { status: 'running', result: null, endedAt: null })]);
    await first.clear(['a', 'b']);
    await first.observe([view('b')]);
    expect((await reopen()).restored()).toEqual([]);
  });

  it('깨진 파일은 .bak으로 보존하고 빈 상태로 시작한다', async () => {
    await writeFile(file, '{깨짐', 'utf8');
    const keeper = await reopen();
    expect(keeper.restored()).toEqual([]);
    expect((await readdir(dir)).some((n) => n.includes('.bak-'))).toBe(true);
  });
});
