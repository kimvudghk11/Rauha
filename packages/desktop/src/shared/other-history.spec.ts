import { describe, expect, it } from 'vitest';
import { codexEntry, codexSummary, kiroCliEntry, kiroCliSummary, kiroCrewEntry, kiroCrewSummary, OtherHistoryId } from './other-history.js';

const j = (o: unknown): string => JSON.stringify(o);

describe('Kiro CLI 대화', () => {
  it('세션 .json 에서 제목·폴더·시각', () => {
    expect(kiroCliSummary(j({ session_id: 'a', cwd: 'C:\\work', created_at: '2026-09-20T15:02:18Z', updated_at: '2026-09-20T15:06:06Z', title: '  바탕화면 가이드 질문 ' }))).toEqual({ title: '바탕화면 가이드 질문', cwd: 'C:\\work', startedAt: '2026-09-20T15:02:18Z', updatedAt: '2026-09-20T15:06:06Z' });
    expect(kiroCliSummary('not json')).toBeNull();
  });
  it('.jsonl 줄: 질문·답 글과 도구 이름만(생각·도구 결과는 뺌)', () => {
    expect(kiroCliEntry(j({ kind: 'Prompt', data: { content: [{ kind: 'text', data: '안녕' }] } }))).toEqual({ role: 'user', text: '안녕', at: '' });
    expect(kiroCliEntry(j({ kind: 'AssistantMessage', data: { content: [{ kind: 'thinking', data: { text: 'x' } }, { kind: 'text', data: '답' }, { kind: 'toolUse', data: { name: 'fs_read' } }] } }))).toEqual({ role: 'assistant', text: '답', tools: ['fs_read'], at: '' });
    expect(kiroCliEntry(j({ kind: 'ToolResults', data: {} }))).toBeNull();
  });
});

describe('Kiro crew 대화', () => {
  it('첫 줄 metadata 에서 제목, 나머지는 role·content', () => {
    const lines = [j({ _type: 'metadata', created_at: '2026-09-21T00:25:36+09:00', title: 'Bedrock 가이드', project: 'C:\\p' }), j({ role: 'user', content: '질문', ts: '2026-09-21T00:26:00+09:00' })];
    expect(kiroCrewSummary(lines)).toEqual({ title: 'Bedrock 가이드', cwd: 'C:\\p', startedAt: '2026-09-21T00:25:36+09:00' });
    expect(kiroCrewEntry(lines[1]!)).toEqual({ role: 'user', text: '질문', at: '2026-09-21T00:26:00+09:00' });
    expect(kiroCrewEntry(lines[0]!)).toBeNull();
  });
});

describe('Codex 대화', () => {
  const meta = j({ timestamp: '2026-11-14T12:00:00Z', type: 'session_meta', payload: { cwd: 'E:\\rauha' } });
  const env = j({ timestamp: 't', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>cwd</environment_context>' }] } });
  const ask = j({ timestamp: '2026-11-14T12:00:05Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'rauha 가 뭐야?' }] } });
  const ans = j({ timestamp: '2026-11-14T12:00:09Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '데스크톱 앱이에요.' }] } });
  it('첫 진짜 질문이 제목(환경 안내 글은 건너뜀)', () => {
    expect(codexSummary([meta, env, ask, ans])).toEqual({ title: 'rauha 가 뭐야?', cwd: 'E:\\rauha', startedAt: '2026-11-14T12:00:00Z' });
  });
  it('질문·답 줄', () => {
    expect(codexEntry(ask)).toEqual({ role: 'user', text: 'rauha 가 뭐야?', at: '2026-11-14T12:00:05Z' });
    expect(codexEntry(ans)).toEqual({ role: 'assistant', text: '데스크톱 앱이에요.', at: '2026-11-14T12:00:09Z' });
    expect(codexEntry(env)).toBeNull();
    expect(codexEntry(meta)).toBeNull();
  });
});

describe('바깥 대화 id 는 경로를 담지 못한다', () => {
  it('출처와 파일 이름만', () => {
    expect(OtherHistoryId.parse('kiro:083bd163-f091-40fa-a8f7-a83e0bf11d64')).toMatchObject({ source: 'kiro', file: '083bd163-f091-40fa-a8f7-a83e0bf11d64' });
    expect(OtherHistoryId.parse('codex:2026/11/14/rollout-2026-11-14T12-00-00-abc')).toMatchObject({ source: 'codex' });
    for (const bad of ['kiro:../x', 'kiro:a/b', 'codex:../../etc', 'codex:2026/11/14/../x', 'nope:abc', 42]) expect(OtherHistoryId.parse(bad)).toBeNull();
  });
});
