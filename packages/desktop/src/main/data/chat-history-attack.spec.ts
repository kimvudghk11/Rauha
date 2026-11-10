import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChatHistoryKeeper } from '../team/chat-history-keeper.js';
import { ChatHistory, HISTORY_LIMITS } from '../../shared/chat-history.js';
import { ChatHistoryDto } from '../../shared/chat-history-dto.js';
import type { JobView } from '../../shared/ipc.js';
import { ChatHistoryStore } from './chat-history-store.js';

// 시험용 가짜 비밀(조각을 이어붙여 만든다)
const ghToken = ['gh', 'p_', 'a'.repeat(30)].join('');
const skKey = ['s', 'k-', 'live-', 'c'.repeat(30)].join('');

let dir = '';
let file = '';
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rauha-chat-'));
  file = join(dir, 'chat-history.json');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const entry = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ id: 'j1', request: 'hi', status: 'done', stopReason: null, result: 'ok', toolsLine: null, cast: [], queuedAt: '2026-11-11T00:00:00.000Z', endedAt: null, ...over });
const write = (value: unknown): Promise<void> => writeFile(file, typeof value === 'string' ? value : JSON.stringify(value));
const load = (): Promise<ChatHistory> => new ChatHistoryStore(file, () => '20261111').load();

describe('채팅 기록 파일 변조', () => {
  it.each([['깨진 JSON', '{"jobs": [{"id":'], ['빈 파일', ''], ['null', 'null'], ['숫자', '42'], ['배열', '[]'], ['문자열', '"x"']])('%s이면 빈 기록으로 시작하고 원본을 보존한다', async (_n, raw) => {
    await write(raw);
    expect((await load()).isEmpty).toBe(true);
    expect((await readdir(dir)).some((n) => n.includes('.bak-') || n.includes('.broken-'))).toBe(true);
  });

  it('jobs가 배열이 아니거나 항목 타입이 섞여 있으면 읽을 수 있는 것만 연다', async () => {
    await write({ jobs: [entry(), null, 7, 'x', [], { id: 1 }, entry({ id: '' }), entry({ id: 'j2', status: 'weird' }), entry({ id: 'j3', request: 5 }), entry({ id: 'j4', queuedAt: {} }), entry({ id: 'j5' })] });
    const items = (await load()).items;
    expect(items.map((e) => e.id)).toEqual(['j1', 'j5']);
  });

  it('거대한 값은 건너뛰거나 잘라서 상한을 지킨다', async () => {
    await write({ jobs: [entry({ id: 'huge', request: 'x'.repeat(5_000_000) }), entry({ id: 'big', request: 'y'.repeat(90_000), result: 'z'.repeat(90_000), stopReason: 'w'.repeat(90_000), toolsLine: 'v'.repeat(90_000) })] });
    const items = (await load()).items;
    expect(items.map((e) => e.id)).toEqual(['big']);
    const big = items[0]!;
    expect(big.request.length).toBeLessThanOrEqual(HISTORY_LIMITS.request);
    expect((big.result ?? '').length).toBeLessThanOrEqual(HISTORY_LIMITS.result);
    expect((big.stopReason ?? '').length).toBeLessThanOrEqual(HISTORY_LIMITS.reason);
    expect((big.toolsLine ?? '').length).toBeLessThanOrEqual(HISTORY_LIMITS.tools);
  });

  it('일이 수만 개 들어 있어도 최근 50개만 남는다', async () => {
    await write({ jobs: Array.from({ length: 20_000 }, (_, i) => entry({ id: `j${i}` })) });
    const items = (await load()).items;
    expect(items.length).toBe(HISTORY_LIMITS.jobs);
    expect(items[items.length - 1]!.id).toBe('j19999');
  });

  it('__proto__·constructor 키는 전역 객체를 오염시키지 않는다', async () => {
    await write('{"jobs":[{"id":"j1","request":"a","status":"done","queuedAt":"t","__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":1}},"cast":[]}],"__proto__":{"polluted":2}}');
    const items = (await load()).items;
    expect(items.length).toBe(1);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(Object.keys(items[0]!).sort()).toEqual(['cast', 'endedAt', 'id', 'queuedAt', 'request', 'result', 'status', 'stopReason', 'toolsLine']);
  });

  it('역할 목록에 객체 기본 이름(constructor·__proto__·toString)을 끼워 넣어도 역할로 인정하지 않는다', () => {
    const dto = ChatHistoryDto.from({ jobs: [entry({ cast: ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'intake', 7, null] })] });
    expect(dto.toEntity().items[0]!.cast).toEqual(['intake']);
  });

  it('변조된 파일 속 토큰·키는 불러올 때도 가려진다', async () => {
    await write({ jobs: [entry({ request: `token ${ghToken}`, result: `키 ${skKey}`, stopReason: `Bearer ${'q'.repeat(30)}`, toolsLine: `${ghToken}` })] });
    const text = JSON.stringify((await load()).items);
    expect(text).not.toContain(ghToken);
    expect(text).not.toContain(skKey);
    expect(text).not.toContain('q'.repeat(30));
  });
});

describe('채팅 기록 저장', () => {
  const view = (over: Partial<JobView> = {}): JobView => ({ id: 'j1', request: 'r', status: 'done', stopReason: null, queuedAt: '2026-11-11T00:00:00.000Z', endedAt: null, role: null, roleName: null, cast: ['intake'], steps: [], lastLine: null, result: 'r', canGoDeeper: false, knowledgeMissing: false, toolsLine: null, notes: [], ...over });

  it('토큰·키가 든 요청·결과는 파일에 평문으로 저장되지 않는다', async () => {
    const keeper = new ChatHistoryKeeper(new ChatHistoryStore(file));
    await keeper.load();
    await keeper.observe([view({ request: `deploy with ${ghToken}`, result: `done ${skKey}\npassword=${'hunter' + '22'}`, toolsLine: `Bearer ${'z'.repeat(40)}` })]);
    const saved = await readFile(file, 'utf8');
    expect(saved).not.toContain(ghToken);
    expect(saved).not.toContain(skKey);
    expect(saved).not.toContain('hunter22');
    expect(saved).not.toContain('z'.repeat(40));
  });

  it('돌던 일은 결과·이유를 저장하지 않고 중단됨으로만 복원한다', async () => {
    const keeper = new ChatHistoryKeeper(new ChatHistoryStore(file));
    await keeper.load();
    await keeper.observe([view({ status: 'running' as JobView['status'], result: ghToken, stopReason: ghToken })]);
    expect(await readFile(file, 'utf8')).not.toContain(ghToken);
  });
});
