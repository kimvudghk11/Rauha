import { codeFailText, type SearchResult } from './code-api.js';

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** 전체 찾기 결과 한 줄 요약(영어). 잘린 까닭과 건너뛴 파일 수도 숨기지 않고 알린다. */
export function searchSummaryText(r: Extract<SearchResult, { ok: true }>): string {
  const hits = r.files.reduce((n, f) => n + f.hits.length, 0);
  let text = hits === 0 ? `No matches in ${plural(r.scanned, 'file')}` : `${plural(hits, 'match').replace('matchs', 'matches')} in ${plural(r.files.length, 'file')}`;
  if (r.stopped === 'limit') text += ' (result limit reached; narrow the search)';
  else if (r.stopped === 'timeout') text += ' (time limit reached; showing what was found)';
  else if (r.stopped === 'cancelled') text += ' (stopped)';
  else if (r.stopped === 'stalled') text += ' (stopped: the regex took too long)';
  else if (r.truncated) text += ' (too many files; only some were searched)';
  if (r.skipped > 0) text += ` · ${r.skipped} skipped (large or binary)`;
  return text;
}

export function searchFailText(reason: Extract<SearchResult, { ok: false }>['reason']): string {
  if (reason === 'empty') return '';
  if (reason === 'bad-regex') return 'The regex is not valid.';
  if (reason === 'bad-glob') return 'A glob in include/exclude is not valid.';
  return codeFailText(reason);
}
