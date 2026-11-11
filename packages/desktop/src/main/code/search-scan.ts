import { lstat, open } from 'node:fs/promises';
import { join } from 'node:path';
import type { LineHit } from '../../shared/text-search.js';
import { decodeFile, MAX_OPEN_BYTES } from '../../shared/code-text.js';
import { SearchMatcher } from '../../shared/text-search.js';

/** 일꾼(worker)에게 주는 일감. 파일 목록은 main 이 이미 거른(비밀·생성물·글롭) 상대 경로다. */
export interface ScanJob {
  readonly root: string;
  readonly paths: readonly string[];
  readonly query: string;
  readonly caseSensitive: boolean;
  readonly regex: boolean;
  readonly wholeWord: boolean;
  readonly maxTotal: number;
  readonly maxPerFile: number;
}

/** 일꾼이 main 에게 보내는 소식 */
export type ScanMessage =
  | { readonly t: 'file'; readonly path: string; readonly hits: readonly LineHit[] }
  /** 살아 있다는 신호(정규식 하나가 멈춰 있으면 이 신호가 끊긴다) */
  | { readonly t: 'beat'; readonly scanned: number }
  | { readonly t: 'done'; readonly scanned: number; readonly skipped: number; readonly limited: boolean };

const BEAT_MS = 150;

/**
 * 파일을 하나씩 읽어 맞는 줄을 모은다. worker 안에서 돈다(정규식이 영원히 도는 경우 main 이 worker 째 끊는다).
 * 바로가기·1MB 넘는 파일·바이너리·UTF-8 아닌 글은 건너뛰고 skipped 로 센다.
 */
export async function scanFiles(job: ScanJob, send: (m: ScanMessage) => void, shouldStop: () => boolean): Promise<void> {
  const built = SearchMatcher.from({ query: job.query, caseSensitive: job.caseSensitive, regex: job.regex, wholeWord: job.wholeWord });
  if (!built.ok) {
    send({ t: 'done', scanned: 0, skipped: 0, limited: false });
    return;
  }
  let total = 0;
  let scanned = 0;
  let skipped = 0;
  let limited = false;
  let lastBeat = Date.now();
  for (const rel of job.paths) {
    if (shouldStop()) break;
    if (total >= job.maxTotal) {
      limited = true;
      break;
    }
    if (rel.split('/').includes('..')) continue;
    scanned++;
    const text = await readText(join(job.root, ...rel.split('/')));
    if (text === null) skipped++;
    else {
      const hits = built.matcher.search(text, Math.min(job.maxPerFile, job.maxTotal - total));
      if (hits.length > 0) {
        total += hits.length;
        send({ t: 'file', path: rel, hits });
        lastBeat = Date.now();
        if (hits.length >= job.maxPerFile) limited = true;
      }
    }
    if (Date.now() - lastBeat > BEAT_MS) {
      send({ t: 'beat', scanned });
      lastBeat = Date.now();
    }
  }
  send({ t: 'done', scanned, skipped, limited });
}

/** 글 파일이면 내용, 아니면 null */
async function readText(abs: string): Promise<string | null> {
  try {
    if ((await lstat(abs)).isSymbolicLink()) return null;
    const handle = await open(abs, 'r');
    try {
      if ((await handle.stat()).size > MAX_OPEN_BYTES) return null;
      const decoded = decodeFile(await handle.readFile());
      return decoded.ok ? decoded.text : null;
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}
