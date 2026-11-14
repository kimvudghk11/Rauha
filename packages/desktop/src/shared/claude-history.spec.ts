import { describe, expect, it } from 'vitest';
import { HistoryId, mergeTurns, sessionSummary, transcriptEntry } from './claude-history.js';

const line = (o: unknown): string => JSON.stringify(o);
const user = (content: unknown, extra: Record<string, unknown> = {}) => line({ type: 'user', cwd: 'e:\\rauha', timestamp: '2026-11-14T00:00:00Z', message: { role: 'user', content }, ...extra });
const assistant = (content: unknown) => line({ type: 'assistant', timestamp: '2026-11-14T00:00:05Z', message: { role: 'assistant', content } });

describe('세션 요약(목록 한 줄)', () => {
  it('첫 사람 질문을 제목으로, 작업 폴더와 시작 시각을 읽는다(명령·시스템 글은 건너뛴다)', () => {
    const s = sessionSummary([line({ type: 'session-owner' }), user('<local-command-caveat>x</local-command-caveat>'), user('<command-name>/clear</command-name>'), user([{ type: 'text', text: '  DB 연결 고쳐 줘\n그리고 테스트도  ' }]), assistant([{ type: 'text', text: '네' }])]);
    expect(s).toEqual({ title: 'DB 연결 고쳐 줘 그리고 테스트도', cwd: 'e:\\rauha', startedAt: '2026-11-14T00:00:00Z', automated: false });
  });
  it('태그로 시작하는 첫 글(프로그램이 보낸 요청)은 자동 실행으로 표시한다', () => {
    expect(sessionSummary([user('<endpoint>POST /users</endpoint> 시험')]).automated).toBe(true);
    expect(sessionSummary([user('<3 고마워')]).automated).toBe(false);
  });
  it('VS Code 가 앞에 붙이는 꼬리표(열린 파일·선택·붙여넣기)는 떼고 사람 대화로 본다', () => {
    const s = sessionSummary([user('<ide_opened_file>The user opened the file a.json in the IDE.</ide_opened_file>\n\n<ide_selection>x</ide_selection>\n이 파일 정리해 줘')]);
    expect(s).toMatchObject({ title: '이 파일 정리해 줘', automated: false });
    const p = sessionSummary([user('<ide_opened_file>o</ide_opened_file>\n<pasted_content id="86a1">\n검색어\t클릭\n</pasted_content>')]);
    expect(p).toMatchObject({ title: '검색어 클릭', automated: false });
  });
  it('슬래시 명령만 있는 대화는 명령 이름을 제목으로, 사람 대화로 본다', () => {
    const s = sessionSummary([user('<local-command-caveat>x</local-command-caveat>'), user('<command-name>/reload-plugins</command-name>\n<command-message>reload-plugins</command-message>'), assistant([{ type: 'text', text: '네' }])]);
    expect(s).toMatchObject({ title: '/reload-plugins', automated: false });
  });
  it('요약(summary) 줄이 있으면 그것을 제목으로', () => {
    expect(sessionSummary([line({ type: 'summary', summary: 'Fix DB pooler' }), user('hello')]).title).toBe('Fix DB pooler');
  });
  it('사람 질문이 없으면 제목은 비어 있다', () => {
    expect(sessionSummary([line({ type: 'session-owner' })]).title).toBe('');
  });
  it('깨진 줄은 건너뛴다', () => {
    expect(sessionSummary(['{nope', user('hi')]).title).toBe('hi');
  });
});

describe('대화 한 줄(열어 보기)', () => {
  it('사람 글과 답 글은 그대로, 도구 호출은 이름과 짧은 대상만', () => {
    expect(transcriptEntry(user('안녕'))).toEqual({ role: 'user', text: '안녕', at: '2026-11-14T00:00:00Z' });
    expect(transcriptEntry(assistant([{ type: 'text', text: '고칠게요' }, { type: 'tool_use', name: 'Read', input: { file_path: 'e:\\rauha\\a.ts' } }]))).toEqual({ role: 'assistant', text: '고칠게요', tools: ['Read e:\\rauha\\a.ts'], at: '2026-11-14T00:00:05Z' });
  });
  it('도구 결과·시스템 알림·명령 줄·생각(thinking)은 보이지 않는다', () => {
    expect(transcriptEntry(user([{ type: 'tool_result', content: 'x' }]))).toBeNull();
    expect(transcriptEntry(user('<system-reminder>x</system-reminder>'))).toBeNull();
    expect(transcriptEntry(assistant([{ type: 'thinking', thinking: 'hmm' }]))).toBeNull();
    expect(transcriptEntry(line({ type: 'attachment' }))).toBeNull();
  });
  it('아주 긴 글은 줄여서 싣는다', () => {
    const e = transcriptEntry(user('x'.repeat(50_000)));
    expect(e?.text.length).toBeLessThan(21_000);
  });
});

describe('HistoryId — 세션을 가리키는 값', () => {
  it('목록에서 받은 모양(뿌리 번호:폴더/세션)만 받는다', () => {
    expect(HistoryId.parse('0:e--rauha/db37ca02-b6aa-44ef-9cd6-89e6dccf7063').toJSON()).toEqual({ root: 0, project: 'e--rauha', session: 'db37ca02-b6aa-44ef-9cd6-89e6dccf7063' });
    for (const bad of ['0:../x/y', '0:a/../../etc', 'x:a/b', '0:a\\b/c', 5, '0:a/b.jsonl/../c']) expect(() => HistoryId.parse(bad), String(bad)).toThrow();
  });
});

describe('mergeTurns — 이어지는 답 합치기', () => {
  it('Claude 답이 이어지면 글과 도구를 한 말풍선으로', () => {
    const m = mergeTurns([
      { role: 'user', text: 'a', at: '1' },
      { role: 'assistant', text: '보고', at: '2' },
      { role: 'assistant', text: '', tools: ['Read x'], at: '3' },
      { role: 'assistant', text: '끝', tools: ['Edit y'], at: '4' },
      { role: 'user', text: 'b', at: '5' },
    ]);
    expect(m).toEqual([
      { role: 'user', text: 'a', at: '1' },
      { role: 'assistant', text: '보고\n\n끝', tools: ['Read x', 'Edit y'], at: '2' },
      { role: 'user', text: 'b', at: '5' },
    ]);
  });
});