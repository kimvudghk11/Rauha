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

  it('AWS 문서 검색 결과는 결과마다 그 주소와 본문 조각을 남긴다', async () => {
    const log = createFetchLog();
    const found = JSON.stringify({ content: { result: [
      { rank_order: 1, title: 'Lambda timeout', context: 'up to a maximum value of 900 seconds (15 minutes).', url: 'https://docs.aws.amazon.com/lambda/latest/dg/configuration-timeout.html' },
      { rank_order: 2, title: 'Quotas', context: 'Function timeout 900 seconds', url: 'https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html' },
    ] } });
    await log.hook(post('mcp__aws__aws___search_documentation', { search_phrase: 'Lambda timeout' }, [{ type: 'text', text: found }]), 't', opts);
    expect(log.entries()).toEqual([
      { url: 'https://docs.aws.amazon.com/lambda/latest/dg/configuration-timeout.html', body: 'up to a maximum value of 900 seconds (15 minutes).' },
      { url: 'https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html', body: 'Function timeout 900 seconds' },
    ]);
  });

  it('AWS 문서 읽기는 요청한 주소에 읽은 본문을 남긴다', async () => {
    const log = createFetchLog();
    const url = 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html';
    await log.hook(post('mcp__aws__aws___read_documentation', { requests: [{ url }] }, [{ type: 'text', text: '# What is Amazon S3?\nAmazon S3 is an object storage service.' }]), 't', opts);
    expect(log.entries()).toEqual([{ url, body: '# What is Amazon S3?\nAmazon S3 is an object storage service.' }]);
  });

  it('주소를 알 수 없는 브라우저 결과는 남기지 않는다', async () => {
    const log = createFetchLog();
    await log.hook(post('mcp__browser__browser_tabs', { action: 'list' }, [{ type: 'text', text: '탭 없음' }]), 't', opts);
    expect(log.entries()).toEqual([]);
  });
});
