/** 한 파일에서 blame 으로 보여 주는 줄 수 상한. 더 긴 파일은 앞부분만 보인다. */
export const BLAME_LINE_LIMIT = 5000;

const AUTHOR_MAX = 80;
const SUMMARY_MAX = 200;
const HEADER = /^([0-9a-f]{40,64}) \d+ (\d+)(?: \d+)?$/;
const ZERO = /^0+$/;
/** 제어 문자와, 글 방향을 뒤집거나 보이지 않게 하는 문자 */
const UNSAFE = /[\u0000-\u001f\u007f​-‏‪-‮⁠-⁩﻿]/g;

export interface BlameCommit {
  readonly hash: string;
  readonly short: string;
  readonly author: string;
  /** 초 단위 UNIX 시각. 모르면 0 */
  readonly at: number;
  readonly summary: string;
  /** 커밋하지 않은 줄(작업 폴더에서 바뀐 부분) */
  readonly uncommitted: boolean;
  /** 이 파일이 처음 생긴 커밋 */
  readonly boundary: boolean;
}

/** 줄마다 어느 커밋 몫인지: lines[n-1] 이 commits 의 번호. 모르는 줄은 -1. */
export interface BlameView {
  readonly commits: readonly BlameCommit[];
  readonly lines: readonly number[];
  readonly truncated: boolean;
}

/** blame 을 돌리는 고정 인자(경로는 -- 뒤). 한 줄 더 읽어서 상한을 넘는지 알아본다. textconv 는 쓰지 않는다. */
export function blameArgs(path: string): string[] {
  return ['blame', '--porcelain', '--no-textconv', '-L', `1,${BLAME_LINE_LIMIT + 1}`, '--', path];
}

const clean = (text: string, max: number): string => text.replace(UNSAFE, '').trim().slice(0, max);

/**
 * `git blame --porcelain` 출력을 읽는다. 커밋 정보(author·summary …)는 그 커밋의 첫 줄에만 나오고,
 * 내용 줄은 항상 탭으로 시작하므로 파일 내용이 해시처럼 보여도 헤더로 읽지 않는다.
 * 읽을 수 없는 줄은 건너뛴다.
 */
export function parseBlame(text: string, limit: number = BLAME_LINE_LIMIT): BlameView {
  const rows = text.split('\n');
  const commits: BlameCommit[] = [];
  const index = new Map<string, number>();
  const byLine = new Map<number, number>();
  let maxLine = 0;
  let truncated = false;
  let i = 0;
  while (i < rows.length) {
    const m = HEADER.exec(rows[i]!.replace(/\r$/, ''));
    if (m === null) {
      i++;
      continue;
    }
    const hash = m[1]!;
    const finalLine = Number(m[2]);
    let j = i + 1;
    let author = '';
    let at = 0;
    let summary = '';
    let boundary = false;
    while (j < rows.length && !rows[j]!.startsWith('\t')) {
      const key = rows[j]!.replace(/\r$/, '');
      if (key.startsWith('author ')) author = key.slice(7);
      else if (key.startsWith('author-time ')) at = Number(key.slice(12)) || 0;
      else if (key.startsWith('summary ')) summary = key.slice(8);
      else if (key === 'boundary') boundary = true;
      j++;
    }
    if (j >= rows.length) break;
    let at1 = index.get(hash);
    if (at1 === undefined) {
      const uncommitted = ZERO.test(hash);
      at1 = commits.length;
      index.set(hash, at1);
      commits.push({ hash, short: hash.slice(0, 7), author: uncommitted ? 'Not committed yet' : clean(author, AUTHOR_MAX), at, summary: clean(summary, SUMMARY_MAX), uncommitted, boundary });
    }
    if (finalLine > limit) truncated = true;
    else if (finalLine >= 1) {
      byLine.set(finalLine, at1);
      maxLine = Math.max(maxLine, finalLine);
    }
    i = j + 1;
  }
  const lines: number[] = [];
  for (let n = 1; n <= maxLine; n++) lines.push(byLine.get(n) ?? -1);
  return { commits, lines, truncated };
}

/** 같은 커밋이 이어지는 줄 가운데 첫 줄만 true. 거터에 작성자·날짜를 한 번만 적는 데 쓴다. */
export function runStarts(lines: readonly number[]): boolean[] {
  return lines.map((c, i) => i === 0 || lines[i - 1] !== c);
}
