import type { SearchFileHits, SearchResult } from '../../shared/code-api.js';
import { GlobFilter } from '../../shared/search-glob.js';
import { isGeneratedFile, SearchMatcher, type SearchOptions } from '../../shared/text-search.js';
import { walkFiles } from './code-walk.js';
import type { SearchRunner } from './search-runner.js';

/** 찾은 곳 총 개수와 파일당 개수 상한 */
export const MAX_TOTAL_HITS = 2000;
export const MAX_HITS_PER_FILE = 200;

/** 글롭 칸 길이 상한 */
const MAX_GLOB_TEXT = 400;
const MAX_ID = 64;

/** 검색 요청 DTO. 화면에서 온 값을 믿지 않고 검사한다. */
export class SearchRequestDto {
  private constructor(
    readonly options: SearchOptions,
    readonly id: string,
  ) {}

  static from(input: unknown): SearchRequestDto | null {
    if (typeof input !== 'object' || input === null) return null;
    const o = input as Record<string, unknown>;
    if (typeof o['query'] !== 'string' || typeof o['caseSensitive'] !== 'boolean' || typeof o['regex'] !== 'boolean') return null;
    const text = (v: unknown): string | null | undefined => (v === undefined ? undefined : typeof v === 'string' && v.length <= MAX_GLOB_TEXT ? v : null);
    const include = text(o['include']);
    const exclude = text(o['exclude']);
    if (include === null || exclude === null) return null;
    if (o['wholeWord'] !== undefined && typeof o['wholeWord'] !== 'boolean') return null;
    const id = o['id'];
    if (id !== undefined && (typeof id !== 'string' || id.length === 0 || id.length > MAX_ID)) return null;
    return new SearchRequestDto(
      { query: o['query'], caseSensitive: o['caseSensitive'], regex: o['regex'], wholeWord: o['wholeWord'] === true, include, exclude },
      typeof id === 'string' ? id : 'default',
    );
  }
}

/**
 * 작업 폴더 전체 글 찾기. 링크는 따라가지 않고, 비밀 파일·생성물·1MB 넘는 파일·바이너리·UTF-8 아닌 글은 건너뛴다.
 * 파일을 읽고 글을 맞추는 일은 runner(worker 스레드)가 한다: 정규식이 멈추거나 시간이 넘으면 거기까지 찾은 것만 돌려주고 까닭을 알린다.
 */
export async function searchWorkspace(rootReal: string, input: unknown, isSecret: (rel: string) => boolean, runner: SearchRunner, caseInsensitivePaths: boolean = process.platform !== 'linux'): Promise<SearchResult> {
  const dto = SearchRequestDto.from(input);
  if (dto === null) return { ok: false, reason: 'bad-path' };
  const built = SearchMatcher.from(dto.options);
  if (!built.ok) return { ok: false, reason: built.reason };
  const include = GlobFilter.from(dto.options.include ?? '', caseInsensitivePaths);
  const exclude = GlobFilter.from(dto.options.exclude ?? '', caseInsensitivePaths);
  if (!include.ok || !exclude.ok) return { ok: false, reason: 'bad-glob' };
  const walked = await walkFiles(rootReal, { isSecret });
  const paths = walked.paths.filter((p) => !isGeneratedFile(p) && (include.filter.isEmpty || include.filter.matches(p)) && !exclude.filter.matches(p));
  const out = await runner.run(dto.id, {
    root: rootReal,
    paths,
    query: dto.options.query,
    caseSensitive: dto.options.caseSensitive,
    regex: dto.options.regex,
    wholeWord: dto.options.wholeWord === true,
    maxTotal: MAX_TOTAL_HITS,
    maxPerFile: MAX_HITS_PER_FILE,
  });
  const files: SearchFileHits[] = out.files.map((f) => ({ path: f.path, hits: f.hits }));
  return { ok: true, files, truncated: walked.truncated || out.stopped !== null, scanned: out.scanned, skipped: out.skipped, stopped: out.stopped };
}
