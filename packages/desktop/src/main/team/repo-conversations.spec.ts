import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatSnapshot } from '@rauha/core';
import { afterEach, describe, expect, it } from 'vitest';
import { RepoConversations } from './repo-conversations.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const newDir = () => {
  const d = mkdtempSync(join(tmpdir(), 'rauha-conv-'));
  dirs.push(d);
  return d;
};

const snap = (turns: string[], carried: [string, string][] = []): ChatSnapshot => ({
  version: 1,
  turns: turns.map((t) => ({ input: t, result: `결과 ${t}` })),
  carried,
  lastTitle: null,
  savedAt: '2026-11-09T10:00:00.000Z',
});

describe('RepoConversations', () => {
  it('처음 여는 레포는 이어 받을 대화가 없다', async () => {
    expect((await new RepoConversations(newDir()).open('E:/work/app')).base).toBeNull();
  });

  it('끝난 업무의 대화를 저장하면 다음 업무가 이어 받고, 앱을 다시 켜도 남는다', async () => {
    const dir = newDir();
    const first = await new RepoConversations(dir).open('E:/work/app');
    await first.finish(snap(['만들어줘'], [['a.ts', 'h1']]));
    const next = await new RepoConversations(dir).open('e:\\work\\app');
    expect(next.base?.turns.map((t) => t.input)).toEqual(['만들어줘']);
    expect(next.base?.carried).toEqual([['a.ts', 'h1']]);
  });

  it('레포가 다르면 대화도 따로다', async () => {
    const dir = newDir();
    await (await new RepoConversations(dir).open('E:/work/app')).finish(snap(['a']));
    expect((await new RepoConversations(dir).open('E:/work/other')).base).toBeNull();
  });

  it('대화 초기화는 그 레포의 앞 대화와 이어 일할 파일 목록을 비운다', async () => {
    const dir = newDir();
    const store = new RepoConversations(dir);
    await (await store.open('E:/work/app')).finish(snap(['a'], [['a.ts', 'h1']]));
    await store.clear('E:/work/app');
    expect((await new RepoConversations(dir).open('E:/work/app')).base).toBeNull();
  });

  it('대화 초기화는 다른 레포의 대화를 건드리지 않는다', async () => {
    const store = new RepoConversations(newDir());
    await (await store.open('E:/work/other')).finish(snap(['남는다']));
    await store.clear('E:/work/app');
    expect((await store.open('E:/work/other')).base?.turns.map((t) => t.input)).toEqual(['남는다']);
  });

  it('초기화하기 전에 시작한 업무가 늦게 끝나도 옛 대화를 되살리지 않는다', async () => {
    const store = new RepoConversations(newDir());
    const running = await store.open('E:/work/app');
    await store.clear('E:/work/app');
    await running.finish(snap(['옛 대화'], [['a.ts', 'h1']]));
    expect((await store.open('E:/work/app')).base).toBeNull();
  });

  it('초기화한 뒤에 시작한 업무의 대화는 다시 쌓인다', async () => {
    const store = new RepoConversations(newDir());
    await store.clear('E:/work/app');
    await (await store.open('E:/work/app')).finish(snap(['새 대화']));
    expect((await store.open('E:/work/app')).base?.turns.map((t) => t.input)).toEqual(['새 대화']);
  });

  it('실행 중인 업무가 저장하는 동안 초기화해도 저장 순서가 꼬이지 않고 비워진다', async () => {
    const store = new RepoConversations(newDir());
    const a = await store.open('E:/work/app');
    await Promise.all([a.finish(snap(['A'])), store.clear('E:/work/app')]);
    expect((await store.open('E:/work/app')).base).toBeNull();
  });

  it('여러 레포를 한꺼번에 초기화한다', async () => {
    const store = new RepoConversations(newDir());
    await (await store.open('E:/work/a')).finish(snap(['a']));
    await (await store.open('E:/work/b')).finish(snap(['b']));
    await store.clearAll(['E:/work/a', 'E:/work/b']);
    expect((await store.open('E:/work/a')).base).toBeNull();
    expect((await store.open('E:/work/b')).base).toBeNull();
  });

  it('동시에 시작해 거의 동시에 끝난 두 업무의 대화가 둘 다 남는다', async () => {
    const store = new RepoConversations(newDir());
    const a = await store.open('E:/work/app');
    const b = await store.open('E:/work/app');
    await Promise.all([a.finish(snap(['A'])), b.finish(snap(['B']))]);
    const turns = (await store.open('E:/work/app')).base?.turns.map((t) => t.input) ?? [];
    expect([...turns].sort()).toEqual(['A', 'B']);
  });
});
