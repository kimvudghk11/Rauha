import { describe, expect, it } from 'vitest';
import type { SearchFileHits } from '../shared/code-api.js';
import type { DefinitionResult, NavApi, NavLocation, ReferencesResult } from '../shared/ts-nav.js';
import { createCodeNav } from './code-nav.js';

const loc = (path: string, line: number): NavLocation => ({ path, line, column: 3, preview: 'x', start: 0, end: 1 });

function setup(over: { path?: string; definition?: DefinitionResult; references?: ReferencesResult } = {}) {
  const log = { opened: [] as string[], results: [] as { title: string; files: readonly SearchFileHits[] }[], names: [] as string[], said: [] as string[], cleared: 0, calls: 0 };
  const api: NavApi = {
    definition: async () => (log.calls++, over.definition ?? { ok: true, locations: [] }),
    references: async () => (log.calls++, over.references ?? { ok: true, files: [], truncated: false }),
    diagnostics: async () => ({ ok: true, items: [], truncated: false, semantic: true }),
  };
  const text = 'const fooBar = 1;\nfooBar + 2;\n';
  const nav = createCodeNav({
    api,
    active: () => over.path ?? 'src/a.ts',
    textOf: () => text,
    openAt: async (p, l, c) => void log.opened.push(`${p}:${l}:${c}`),
    showResults: (title, files) => void log.results.push({ title, files }),
    searchByName: (w) => void log.names.push(w),
    say: (t) => void log.said.push(t),
    clear: () => void log.cleared++,
  });
  return { nav, log };
}

describe('정의로 이동·참조 찾기 화면 흐름', () => {
  it('정의가 하나면 그 파일·줄로 바로 간다', async () => {
    const { nav, log } = setup({ definition: { ok: true, locations: [loc('src/lib.ts', 7)] } });
    await nav.go('definition', 2, 2);
    expect(log.opened).toEqual(['src/lib.ts:7:3']);
    expect(log.names).toEqual([]);
  });

  it('정의가 여럿이면 목록으로 보인다', async () => {
    const { nav, log } = setup({ definition: { ok: true, locations: [loc('b.ts', 2), loc('a.ts', 1)] } });
    await nav.go('definition', 2, 2);
    expect(log.opened).toEqual([]);
    expect(log.results[0]?.title).toBe('2 definitions of fooBar');
    expect(log.results[0]?.files.map((f) => f.path)).toEqual(['a.ts', 'b.ts']);
  });

  it('정의를 못 찾으면 그 이름으로 전체 찾기를 대신 한다', async () => {
    const { nav, log } = setup({ definition: { ok: true, locations: [] } });
    await nav.go('definition', 2, 2);
    expect(log.names).toEqual(['fooBar']);
    expect(log.said.join(' ')).toContain('by name');
  });

  it('언어 도구가 실패하면 까닭을 알리고 이름 검색으로 대신 한다', async () => {
    const { nav, log } = setup({ definition: { ok: false, reason: 'timeout' } });
    await nav.go('definition', 2, 2);
    expect(log.names).toEqual(['fooBar']);
    expect(log.said.join(' ')).toContain('took too long');
  });

  it('TS/JS 가 아닌 파일은 언어 도구를 부르지 않고 바로 이름 검색을 한다', async () => {
    const { nav, log } = setup({ path: 'main.py' });
    await nav.go('references', 2, 2);
    expect(log.calls).toBe(0);
    expect(log.names).toEqual(['fooBar']);
  });

  it('참조 찾기는 개수와 파일 수를 제목으로 목록을 보인다', async () => {
    const files = [{ path: 'a.ts', hits: [loc('a.ts', 1), loc('a.ts', 4)] }, { path: 'b.ts', hits: [loc('b.ts', 2)] }];
    const { nav, log } = setup({ references: { ok: true, files, truncated: false } });
    await nav.go('references', 1, 8);
    expect(log.results[0]?.title).toBe('3 references to fooBar in 2 files');
    expect(log.results[0]?.files).toHaveLength(2);
  });

  it('커서 아래에 이름이 없으면 안내만 한다', async () => {
    const { nav, log } = setup();
    await nav.go('definition', 1, 14);
    expect(log.calls).toBe(0);
    expect(log.said).toEqual(['Put the cursor on a name first.']);
  });
});
