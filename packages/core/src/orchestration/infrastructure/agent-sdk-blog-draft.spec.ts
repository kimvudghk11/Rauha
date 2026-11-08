import { describe, expect, it } from 'vitest';
import { draftBlog, type BlogQuery } from './agent-sdk-blog-draft.js';

const fake = (messages: readonly { type: string; subtype?: string; result?: string }[], seen: { params?: unknown } = {}): BlogQuery => (params) => {
  seen.params = params;
  return (async function* () {
    for (const m of messages) yield m;
  })();
};

describe('블로그 초안 호출', () => {
  it('가장 값싼 모델로 도구와 쓰기 권한 없이 한 턴만 부른다', async () => {
    const seen: { params?: { options: Record<string, unknown>; prompt: string } } = {};
    const text = await draftBlog('# 제목', 'friendly', { A: 'b' }, undefined, 1000, fake([{ type: 'result', subtype: 'success', result: ' 초안이에요 ' }], seen as { params?: unknown }));
    expect(text).toBe('초안이에요');
    const o = seen.params!.options;
    expect(o['model']).toContain('haiku');
    expect(o['tools']).toEqual([]);
    expect(o['allowedTools']).toEqual([]);
    expect(o['permissionMode']).toBe('dontAsk');
    expect(o['maxTurns']).toBe(1);
    expect(seen.params!.prompt).toContain('~했어요');
  });

  it('결과가 비었거나 실패하면 오류를 던진다', async () => {
    await expect(draftBlog('n', 'plain', {}, undefined, 1000, fake([{ type: 'result', subtype: 'error_max_turns' }]))).rejects.toThrow('초안을 쓰지 못했어요');
    await expect(draftBlog('n', 'plain', {}, undefined, 1000, fake([]))).rejects.toThrow();
  });
});
