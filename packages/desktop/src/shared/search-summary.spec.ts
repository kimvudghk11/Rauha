import { describe, expect, it } from 'vitest';
import type { SearchResult } from './code-api.js';
import { searchFailText, searchSummaryText } from './search-summary.js';

type Ok = Extract<SearchResult, { ok: true }>;
const hit = (line: number) => ({ line, column: 1, preview: 'x', start: 0, end: 1 });
const done = (over: Partial<Ok> = {}): Ok => ({ ok: true, files: [{ path: 'a.ts', hits: [hit(1), hit(2)] }, { path: 'b.ts', hits: [hit(3)] }], truncated: false, scanned: 10, skipped: 0, stopped: null, ...over });

describe('전체 찾기 요약 글', () => {
  it('찾은 수와 파일 수를 보여 준다', () => {
    expect(searchSummaryText(done())).toBe('3 matches in 2 files');
    expect(searchSummaryText(done({ files: [{ path: 'a.ts', hits: [hit(1)] }] }))).toBe('1 match in 1 file');
  });

  it('하나도 없으면 훑은 파일 수를 알려 준다', () => {
    expect(searchSummaryText(done({ files: [], scanned: 42 }))).toBe('No matches in 42 files');
  });

  it('상한·시간·취소·정규식 멈춤은 까닭을 덧붙인다', () => {
    expect(searchSummaryText(done({ stopped: 'limit' }))).toContain('result limit');
    expect(searchSummaryText(done({ stopped: 'timeout' }))).toContain('time limit');
    expect(searchSummaryText(done({ stopped: 'cancelled' }))).toContain('stopped');
    expect(searchSummaryText(done({ stopped: 'stalled' }))).toContain('regex took too long');
  });

  it('건너뛴 파일(큰 파일·바이너리)이 있으면 수를 덧붙인다', () => {
    expect(searchSummaryText(done({ skipped: 4 }))).toContain('4 skipped');
  });

  it('파일이 너무 많아 잘렸으면 일부만 훑었다고 알린다', () => {
    expect(searchSummaryText(done({ truncated: true, stopped: null }))).toContain('too many files');
  });

  it('실패 까닭을 문장으로 바꾼다', () => {
    expect(searchFailText('bad-regex')).toBe('The regex is not valid.');
    expect(searchFailText('bad-glob')).toContain('glob');
    expect(searchFailText('empty')).toBe('');
    expect(searchFailText('no-folder')).toContain('work folder');
  });
});
