import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ClaudeHistoryService } from './claude-history-service.js';

const line = (o: unknown): string => JSON.stringify(o);
function setup() {
  const a = mkdtempSync(join(tmpdir(), 'rauha-hist-a-'));
  const b = mkdtempSync(join(tmpdir(), 'rauha-hist-b-'));
  mkdirSync(join(a, 'projects', 'e--rauha'), { recursive: true });
  mkdirSync(join(b, 'projects', 'c--work'), { recursive: true });
  writeFileSync(join(a, 'projects', 'e--rauha', 's1.jsonl'), [line({ type: 'user', cwd: 'e:\\rauha', timestamp: '2026-11-14T00:00:00Z', message: { content: 'DB 고쳐 줘' } }), line({ type: 'assistant', timestamp: '2026-11-14T00:00:01Z', message: { content: [{ type: 'text', text: '고칠게요' }, { type: 'tool_use', name: 'Edit', input: { file_path: 'a.ts' } }] } })].join('\n'));
  writeFileSync(join(b, 'projects', 'c--work', 's2.jsonl'), line({ type: 'user', cwd: 'c:\\work', timestamp: '2026-11-13T00:00:00Z', message: { content: '블로그 만들자' } }));
  writeFileSync(join(b, 'projects', 'c--work', 'empty.jsonl'), line({ type: 'session-owner' }));
  writeFileSync(join(a, '.credentials.json'), '{"secret":"x"}');
  const svc = new ClaudeHistoryService({ roots: async () => [{ dir: a, label: '~/.claude' }, { dir: b, label: 'work account' }] });
  return { svc };
}

describe('Claude 대화 내역', () => {
  it('설정 폴더 여러 곳의 프로젝트 대화를 모아 최근 순으로 보이고, 사람 질문이 없는 세션은 뺀다', async () => {
    const { svc } = setup();
    const r = await svc.list();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.sessions.map((s) => [s.title, s.cwd, s.source])).toEqual(expect.arrayContaining([['DB 고쳐 줘', 'e:\\rauha', '~/.claude'], ['블로그 만들자', 'c:\\work', 'work account']]));
    expect(r.data.sessions).toHaveLength(2);
    expect(JSON.stringify(r)).not.toContain('secret');
  });
  it('목록의 id 로 대화를 열면 사람 글·답 글·도구 이름이 나온다', async () => {
    const { svc } = setup();
    const r = await svc.list();
    if (!r.ok) throw new Error('list');
    const id = r.data.sessions.find((s) => s.title === 'DB 고쳐 줘')!.id;
    const t = await svc.open(id);
    expect(t.ok && t.data.entries).toEqual([
      { role: 'user', text: 'DB 고쳐 줘', at: '2026-11-14T00:00:00Z' },
      { role: 'assistant', text: '고칠게요', tools: ['Edit a.ts'], at: '2026-11-14T00:00:01Z' },
    ]);
  });
  it('경로를 꾸민 id·없는 뿌리는 열지 않는다', async () => {
    const { svc } = setup();
    for (const bad of ['0:../..', '0:e--rauha/../../.credentials', '9:e--rauha/s1', '0:e--rauha/nope']) expect((await svc.open(bad)).ok, bad).toBe(false);
  });
});
