import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ClaudeHistoryService } from './claude-history-service.js';

const home = mkdtempSync(join(tmpdir(), 'rauha-oh-'));
afterAll(() => rmSync(home, { recursive: true, force: true }));
const kiro = join(home, '.kiro');
const cli = join(kiro, 'sessions', 'cli');
mkdirSync(cli, { recursive: true });
const id = '083bd163-f091-40fa-a8f7-a83e0bf11d64';
writeFileSync(join(cli, `${id}.json`), JSON.stringify({ session_id: id, cwd: 'C:\\Users\\me', created_at: '2026-09-20T15:02:18.253036300Z', updated_at: '2026-09-20T15:06:06.995788900Z', title: 'Bedrock 질문', session_state: {} }, null, 2));
writeFileSync(join(cli, `${id}.jsonl`), [JSON.stringify({ version: 'v1', kind: 'Prompt', data: { message_id: 'm1', content: [{ kind: 'text', data: '모델 하나만 고르나요?' }] } }), JSON.stringify({ version: 'v1', kind: 'AssistantMessage', data: { message_id: 'm2', content: [{ kind: 'text', data: '아니요.' }] } })].join('\n') + '\n');
const untitled = '12ea1d53-f031-43de-8cf7-f6621bbc9043';
writeFileSync(join(cli, `${untitled}.json`), JSON.stringify({ session_id: untitled, cwd: 'C:\\', created_at: '2026-11-14T08:00:00Z', updated_at: '2026-11-14T08:01:00Z' }));
writeFileSync(join(cli, `${untitled}.jsonl`), JSON.stringify({ version: 'v1', kind: 'Prompt', data: { content: [{ kind: 'text', data: '제목 없는 대화의 첫 질문' }] } }) + '\n');
const codexDir = join(home, '.codex', 'sessions', '2026', '11', '14');
mkdirSync(codexDir, { recursive: true });
writeFileSync(join(codexDir, 'rollout-2026-11-14T12-00-00-abc.jsonl'), [JSON.stringify({ timestamp: '2026-11-14T12:00:00Z', type: 'session_meta', payload: { cwd: 'E:\\rauha' } }), JSON.stringify({ timestamp: 't', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi codex' }] } })].join('\n'));

const svc = new ClaudeHistoryService({ roots: async () => [], others: { kiro, codex: join(home, '.codex') } });

describe('다른 AI 대화도 목록에 넣고 연다', () => {
  it('Kiro CLI 와 Codex 대화가 출처와 함께 보인다', async () => {
    const r = await svc.list();
    if (!r.ok) throw new Error(r.error);
    expect(r.data.sessions.map((s) => [s.source, s.title])).toEqual(expect.arrayContaining([['Kiro', 'Bedrock 질문'], ['Kiro', '제목 없는 대화의 첫 질문'], ['ChatGPT (Codex)', 'hi codex']]));
  });
  it('Kiro 대화를 열면 질문과 답', async () => {
    const r = await svc.open(`kiro:${id}`);
    if (!r.ok) throw new Error(r.error);
    expect(r.data.entries.map((e) => [e.role, e.text])).toEqual([['user', '모델 하나만 고르나요?'], ['assistant', '아니요.']]);
  });
  it('경로가 섞인 id 는 열지 않는다', async () => {
    expect(await svc.open('kiro:../../secret')).toMatchObject({ ok: false });
  });
});
