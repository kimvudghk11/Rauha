import { describe, expect, it } from 'vitest';
import { BLAME_LINE_LIMIT, blameArgs, parseBlame, runStarts } from './git-blame.js';

const H1 = 'a'.repeat(40);
const H2 = 'b'.repeat(40);
const ZERO = '0'.repeat(40);
const T = '\t';

const keys = (author: string, time: number, summary: string, extra: string[] = []): string[] => [
  `author ${author}`,
  `author-mail <${author}@x>`,
  `author-time ${time}`,
  'author-tz +0900',
  `committer ${author}`,
  `committer-time ${time}`,
  `summary ${summary}`,
  ...extra,
  'filename f.txt',
];
const join = (...lines: string[]): string => lines.join('\n') + '\n';

describe('parseBlame', () => {
  it('커밋 정보는 처음 한 번만 나오고 다음 줄들은 같은 커밋으로 묶는다', () => {
    const text = join(`${H1} 1 1 2`, ...keys('Kim', 1700000000, '첫 커밋'), `${T}a`, `${H1} 2 2`, `${T}b`, `${H2} 3 3 1`, ...keys('Bo', 1700000500, 'second'), `${T}c`);
    const v = parseBlame(text);
    expect(v.lines).toEqual([0, 0, 1]);
    expect(v.commits).toHaveLength(2);
    expect(v.commits[0]).toMatchObject({ hash: H1, short: H1.slice(0, 7), author: 'Kim', at: 1700000000, summary: '첫 커밋', uncommitted: false, boundary: false });
    expect(v.commits[1]).toMatchObject({ author: 'Bo', summary: 'second' });
    expect(v.truncated).toBe(false);
  });

  it('줄 순서는 최종 줄 번호를 따른다(git 이 줄 번호를 건너뛰며 내보내도)', () => {
    const text = join(`${H2} 1 2 1`, ...keys('Bo', 5, 'b'), `${T}two`, `${H1} 1 1 1`, ...keys('Kim', 4, 'a'), `${T}one`);
    const v = parseBlame(text);
    expect(v.lines.map((i) => v.commits[i]!.author)).toEqual(['Kim', 'Bo']);
  });

  it('아직 커밋하지 않은 줄(해시가 0)은 uncommitted 로 표시한다', () => {
    const text = join(`${ZERO} 1 1 1`, 'author Not Committed Yet', 'author-time 1', 'summary Version of f.txt from f.txt', 'filename f.txt', `${T}new`);
    const c = parseBlame(text).commits[0]!;
    expect(c.uncommitted).toBe(true);
    expect(c.author).toBe('Not committed yet');
  });

  it('boundary(가장 처음 커밋) 표시를 읽는다', () => {
    const text = join(`${H1} 1 1 1`, ...keys('Kim', 1, 'root', ['boundary']), `${T}x`);
    expect(parseBlame(text).commits[0]!.boundary).toBe(true);
  });

  it('내용 줄이 해시처럼 생겨도 헤더로 읽지 않는다(내용은 항상 탭으로 시작한다)', () => {
    const fake = `${H2} 9 9 1`;
    const text = join(`${H1} 1 1 2`, ...keys('Kim', 1, 's'), `${T}${fake}`, `${H1} 2 2`, `${T}author Mallory`);
    const v = parseBlame(text);
    expect(v.lines).toEqual([0, 0]);
    expect(v.commits).toHaveLength(1);
    expect(v.commits[0]!.author).toBe('Kim');
  });

  it('제어 문자·너무 긴 작성자와 요약은 잘라서 한 줄 글로 만든다', () => {
    const text = join(`${H1} 1 1 1`, ...keys('K\u0007i‮m' + 'x'.repeat(300), 1, 's\u0000' + 'y'.repeat(500)), `${T}x`);
    const c = parseBlame(text).commits[0]!;
    expect(c.author.length).toBeLessThanOrEqual(80);
    expect(c.summary.length).toBeLessThanOrEqual(200);
    expect(/[\u0000-\u001f\u007f‪-‮]/.test(c.author + c.summary)).toBe(false);
  });

  it('줄이 상한을 넘으면 앞부분만 읽고 truncated 로 알린다', () => {
    const rows: string[] = [];
    for (let i = 1; i <= 7; i++) rows.push(...(i === 1 ? [`${H1} 1 1 7`, ...keys('Kim', 1, 's')] : [`${H1} ${i} ${i}`]), `${T}l${i}`);
    const v = parseBlame(join(...rows), 5);
    expect(v.lines).toHaveLength(5);
    expect(v.truncated).toBe(true);
    expect(BLAME_LINE_LIMIT).toBe(5000);
  });

  it('깨진 출력이나 빈 글은 빈 결과다', () => {
    expect(parseBlame('')).toEqual({ commits: [], lines: [], truncated: false });
    expect(parseBlame('garbage\nmore garbage\n').lines).toEqual([]);
    expect(parseBlame(`${H1} x y\n${T}z\n`).lines).toEqual([]);
  });

  it('줄 끝의 CR 은 작성자·요약에 남기지 않는다', () => {
    const text = `${H1} 1 1 1\r\nauthor Kim\r\nsummary hi\r\nfilename f\r\n${T}x\r\n`;
    const c = parseBlame(text).commits[0]!;
    expect(c.author).toBe('Kim');
    expect(c.summary).toBe('hi');
  });
});

describe('runStarts', () => {
  it('같은 커밋이 이어지는 줄은 첫 줄만 true 다', () => {
    expect(runStarts([0, 0, 1, 1, 1, 0])).toEqual([true, false, true, false, false, true]);
    expect(runStarts([])).toEqual([]);
  });
});

describe('blameArgs', () => {
  it('고정 인자 배열이다: porcelain, textconv 끔, 줄 상한, 경로는 -- 뒤', () => {
    const a = blameArgs('src/a b.ts');
    expect(a).toEqual(['blame', '--porcelain', '--no-textconv', '-L', `1,${BLAME_LINE_LIMIT + 1}`, '--', 'src/a b.ts']);
  });
});
