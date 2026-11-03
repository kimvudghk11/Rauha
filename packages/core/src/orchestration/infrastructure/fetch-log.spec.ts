import { describe, expect, it } from 'vitest';
import { createFetchLog } from './fetch-log.js';

const opts = { signal: new AbortController().signal };
const post = (tool_name: string, tool_input: Record<string, unknown>, tool_response: unknown) => ({
  hook_event_name: 'PostToolUse' as const,
  tool_name,
  tool_input,
  tool_response,
  tool_use_id: 't',
  session_id: 's',
  transcript_path: '',
  cwd: 'E:/w',
});

describe('createFetchLog', () => {
  it('WebFetch로 연 주소와 본문을 남기고 다른 도구는 무시한다', async () => {
    const log = createFetchLog();
    await log.hook(post('WebFetch', { url: 'https://docs.example.com/api', prompt: 'x' }, 'POST /api/v1/info'), 't', opts);
    await log.hook(post('WebFetch', { url: 'https://a.example.com' }, { result: '본문 A' }), 't', opts);
    await log.hook(post('WebFetch', { url: 'https://b.example.com' }, { other: 1 }), 't', opts);
    await log.hook(post('Read', { file_path: 'x' }, 'file'), 't', opts);
    expect(log.entries()).toEqual([
      { url: 'https://docs.example.com/api', body: 'POST /api/v1/info' },
      { url: 'https://a.example.com', body: '본문 A' },
      { url: 'https://b.example.com', body: null },
    ]);
  });

  it('본문은 앞 20,000자만 남긴다', async () => {
    const log = createFetchLog();
    await log.hook(post('WebFetch', { url: 'https://x.example.com' }, 'a'.repeat(30_000)), 't', opts);
    expect(log.entries()[0]!.body).toHaveLength(20_000);
  });

  it('브라우저로 연 페이지는 그 주소에 읽은 화면 글을 이어 붙여 남긴다', async () => {
    const log = createFetchLog();
    const text = (t: string) => [{ type: 'text', text: t }];
    await log.hook(post('mcp__browser__browser_navigate', { url: 'http://localhost:5173/' }, text('### Page\n- Page URL: http://localhost:5173/\n### Snapshot\n- [Snapshot](x.yml)')), 't', opts);
    await log.hook(post('mcp__browser__browser_snapshot', {}, { content: text('### Page\n- Page URL: http://localhost:5173/\n```yaml\n- heading "안녕 rauha"\n```') }), 't', opts);
    await log.hook(post('mcp__browser__browser_click', { ref: 'e3' }, text('### Page\n- Page URL: http://localhost:5173/login\n- button "로그인"')), 't', opts);
    const entries = log.entries();
    expect(entries.map((e) => e.url)).toEqual(['http://localhost:5173/', 'http://localhost:5173/login']);
    expect(entries[0]!.body).toContain('heading "안녕 rauha"');
    expect(entries[1]!.body).toContain('button "로그인"');
  });

  it('주소를 알 수 없는 브라우저 결과는 남기지 않는다', async () => {
    const log = createFetchLog();
    await log.hook(post('mcp__browser__browser_tabs', { action: 'list' }, [{ type: 'text', text: '탭 없음' }]), 't', opts);
    expect(log.entries()).toEqual([]);
  });
});
