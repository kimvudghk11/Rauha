import { open } from 'node:fs/promises';
import { join } from 'node:path';
import type { SearchFileHits, SearchResult } from '../../shared/code-api.js';
import { decodeFile, MAX_OPEN_BYTES } from '../../shared/code-text.js';
import { SearchMatcher, type SearchOptions } from '../../shared/text-search.js';
import { walkFiles } from './code-walk.js';

/** 찾은 곳 총 개수와 파일당 개수 상한, 걸리는 시간 상한 */
export const MAX_TOTAL_HITS = 500;
export const MAX_HITS_PER_FILE = 20;
export const SEARCH_DEADLINE_MS = 8000;

/** 검색 요청 DTO. 화면에서 온 값을 믿지 않고 검사한다. */
export class SearchRequestDto {
  private constructor(readonly options: SearchOptions) {}

  static from(input: unknown): SearchRequestDto | null {
    if (typeof input !== 'object' || input === null) return null;
    const o = input as Record<string, unknown>;
    if (typeof o['query'] !== 'string' || typeof o['caseSensitive'] !== 'boolean' || typeof o['regex'] !== 'boolean') return null;
    return new SearchRequestDto({ query: o['query'], caseSensitive: o['caseSensitive'], regex: o['regex'] });
  }
}

/**
 * 작업 폴더 전체 글 찾기. 링크는 따라가지 않고, 비밀 파일·1MB 넘는 파일·바이너리·UTF-8 아닌 글은 건너뛴다.
 * 시간이 상한을 넘으면 거기까지 찾은 것만 돌려주고 잘렸다고 알린다.
 */
export async function searchWorkspace(rootReal: string, input: unknown, isSecret: (rel: string) => boolean, now: () => number = Date.now): Promise<SearchResult> {
  const dto = SearchRequestDto.from(input);
  if (dto === null) return { ok: false, reason: 'bad-path' };
  const built = SearchMatcher.from(dto.options);
  if (!built.ok) return { ok: false, reason: built.reason };
  const { paths, truncated: walkTruncated } = await walkFiles(rootReal, { isSecret });
  const files: SearchFileHits[] = [];
  const deadline = now() + SEARCH_DEADLINE_MS;
  let total = 0;
  let scanned = 0;
  let truncated = walkTruncated;
  for (const rel of paths) {
    if (total >= MAX_TOTAL_HITS || now() > deadline) {
      truncated = true;
      break;
    }
    scanned++;
    let text: string | null = null;
    try {
      const handle = await open(join(rootReal, ...rel.split('/')), 'r');
      try {
        if ((await handle.stat()).size > MAX_OPEN_BYTES) continue;
        const decoded = decodeFile(await handle.readFile());
        if (decoded.ok) text = decoded.text;
      } finally {
        await handle.close();
      }
    } catch {
      continue;
    }
    if (text === null) continue;
    const hits = built.matcher.search(text, Math.min(MAX_HITS_PER_FILE, MAX_TOTAL_HITS - total));
    if (hits.length === 0) continue;
    total += hits.length;
    files.push({ path: rel, hits });
  }
  return { ok: true, files, truncated, scanned };
}
