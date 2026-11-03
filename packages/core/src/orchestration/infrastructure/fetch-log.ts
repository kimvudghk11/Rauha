import type { HookCallback } from '@anthropic-ai/claude-agent-sdk';
import type { FetchedPage } from '../application/ports.js';
import { BROWSER_TOOL_PREFIX } from './browser-mcp.js';
import { AWS_TOOL_PREFIX } from './tool-kits.js';

/** 근거 확인에 충분한 만큼만 본문을 남긴다. */
const MAX_BODY = 20_000;
/** 브라우저 도구 결과에 붙는 지금 페이지 주소 */
const PAGE_URL = /Page URL:\s*(\S+)/;

function bodyOf(response: unknown): string | null {
  if (typeof response === 'string') return response;
  // MCP 도구 결과: [{ type: 'text', text }] 또는 { content: [...] }
  if (Array.isArray(response)) {
    const texts = response.map((block) => (typeof block === 'object' && block !== null ? (block as Record<string, unknown>)['text'] : undefined)).filter((t): t is string => typeof t === 'string');
    return texts.length > 0 ? texts.join('\n') : null;
  }
  if (typeof response === 'object' && response !== null) {
    const record = response as Record<string, unknown>;
    for (const key of ['result', 'content']) {
      if (typeof record[key] === 'string') return record[key] as string;
      if (Array.isArray(record[key])) return bodyOf(record[key]);
    }
  }
  return null;
}

/** AWS 문서 검색 결과 글({ content: { result: [{ url, context }] } })에서 주소와 본문 조각. 읽지 못하면 빈 목록. */
function searchResults(text: string): { url: string; context: string }[] {
  try {
    const parsed = JSON.parse(text) as { content?: { result?: unknown } };
    const results = Array.isArray(parsed.content?.result) ? (parsed.content.result as Record<string, unknown>[]) : [];
    return results.flatMap((r) => (typeof r['url'] === 'string' && typeof r['context'] === 'string' ? [{ url: r['url'], context: r['context'] }] : []));
  } catch {
    return [];
  }
}

/**
 * 팀원이 WebFetch나 브라우저로 실제로 연 주소와 본문을 남기는 PostToolUse 훅.
 * "찾아봤다"는 말 대신 이 기록으로 web 근거를 확인한다.
 * 브라우저는 한 주소에서 여러 번 읽으므로(열기 → 화면 읽기 → 누르기) 그 주소의 본문에 이어 붙인다.
 * AWS 지식 서버의 문서 검색은 결과마다 실제 페이지 조각을 주므로 그 주소마다 남긴다.
 */
export function createFetchLog(): { hook: HookCallback; entries(): FetchedPage[] } {
  const pages: FetchedPage[] = [];
  const add = (url: string, body: string) => {
    const at = pages.findIndex((p) => p.url === url);
    if (at < 0) pages.push({ url, body: body.slice(0, MAX_BODY) });
    else pages[at] = { url, body: `${pages[at]!.body ?? ''}\n${body}`.slice(0, MAX_BODY) };
  };
  return {
    hook: async (input) => {
      if (input.hook_event_name !== 'PostToolUse') return {};
      const toolInput = input.tool_input as Record<string, unknown> | undefined;
      if (input.tool_name === 'WebFetch') {
        const url = toolInput?.['url'];
        if (typeof url !== 'string') return {};
        const body = bodyOf(input.tool_response);
        pages.push({ url, body: body === null ? null : body.slice(0, MAX_BODY) });
        return {};
      }
      const body = bodyOf(input.tool_response);
      if (body === null) return {};
      if (input.tool_name.startsWith(BROWSER_TOOL_PREFIX)) {
        const url = body.match(PAGE_URL)?.[1] ?? (typeof toolInput?.['url'] === 'string' ? toolInput['url'] : null);
        if (url !== null) add(url, body);
        return {};
      }
      if (input.tool_name === `${AWS_TOOL_PREFIX}aws___search_documentation`) {
        for (const found of searchResults(body)) add(found.url, found.context);
        return {};
      }
      if (input.tool_name === `${AWS_TOOL_PREFIX}aws___read_documentation`) {
        const requests = Array.isArray(toolInput?.['requests']) ? (toolInput['requests'] as unknown[]) : [];
        for (const request of requests) {
          const url = typeof request === 'object' && request !== null ? (request as Record<string, unknown>)['url'] : undefined;
          if (typeof url === 'string') add(url, body);
        }
      }
      return {};
    },
    entries: () => [...pages],
  };
}
