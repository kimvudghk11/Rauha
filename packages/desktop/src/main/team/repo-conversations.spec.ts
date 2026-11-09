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

  it('동시에 시작해 거의 동시에 끝난 두 업무의 대화가 둘 다 남는다', async () => {
    const store = new RepoConversations(newDir());
    const a = await store.open('E:/work/app');
    const b = await store.open('E:/work/app');
    await Promise.all([a.finish(snap(['A'])), b.finish(snap(['B']))]);
    const turns = (await store.open('E:/work/app')).base?.turns.map((t) => t.input) ?? [];
    expect([...turns].sort()).toEqual(['A', 'B']);
  });
});
