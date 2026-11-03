import type { HookCallback } from '@anthropic-ai/claude-agent-sdk';
import type { FetchedPage } from '../application/ports.js';
import { BROWSER_TOOL_PREFIX } from './browser-mcp.js';

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

/**
 * 팀원이 WebFetch나 브라우저로 실제로 연 주소와 본문을 남기는 PostToolUse 훅.
 * "찾아봤다"는 말 대신 이 기록으로 web 근거를 확인한다.
 * 브라우저는 한 주소에서 여러 번 읽으므로(열기 → 화면 읽기 → 누르기) 그 주소의 본문에 이어 붙인다.
 */
export function createFetchLog(): { hook: HookCallback; entries(): FetchedPage[] } {
  const pages: FetchedPage[] = [];
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
      if (!input.tool_name.startsWith(BROWSER_TOOL_PREFIX)) return {};
      const body = bodyOf(input.tool_response);
      const url = body?.match(PAGE_URL)?.[1] ?? (typeof toolInput?.['url'] === 'string' ? toolInput['url'] : null);
      if (url === null || body === null) return {};
      const at = pages.findIndex((p) => p.url === url);
      if (at < 0) pages.push({ url, body: body.slice(0, MAX_BODY) });
      else pages[at] = { url, body: `${pages[at]!.body ?? ''}\n${body}`.slice(0, MAX_BODY) };
      return {};
    },
    entries: () => [...pages],
  };
}
