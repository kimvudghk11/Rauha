import { describe, expect, it } from 'vitest';
import { LOG_FORMAT, parseBranches, parseLog } from './git-lists.js';

const US = '\x1f';
const RS = '\x1e';

describe('parseLog', () => {
  it('해시·제목·작성자·시각을 읽는다', () => {
    const text =
      ['a'.repeat(40), 'aaaaaaa', '김평화', '1700000000', '제목: 하나', 'HEAD -> main, origin/main'].join(US) + RS + '\n' + ['b'.repeat(40), 'bbbbbbb', 'Bob', '1700000100', '둘', ''].join(US) + RS + '\n';
    const rows = parseLog(text);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ short: 'aaaaaaa', author: '김평화', subject: '제목: 하나', at: 1700000000 });
    expect(rows[0]!.refs).toEqual(['HEAD -> main', 'origin/main']);
    expect(rows[1]!.refs).toEqual([]);
  });

  it('형식 문자열은 필드 구분자를 쓴다', () => {
    expect(LOG_FORMAT).toContain('%x1f');
  });
});

describe('parseBranches', () => {
  const row = (...c: string[]) => c.join(US);
  const text = [
    row('refs/heads/main', 'main', '*', 'origin/main', '[ahead 1]'),
    row('refs/heads/rauha/job-3f2a', 'rauha/job-3f2a', ' ', '', ''),
    row('refs/remotes/origin/main', 'origin/main', ' ', '', ''),
    row('refs/remotes/origin/HEAD', 'origin', ' ', '', ''),
  ].join('\n');
  const list = parseBranches(text);

  it('로컬과 원격을 나누고 origin/HEAD는 뺀다', () => {
    expect(list.map((b) => [b.name, b.remote])).toEqual([['main', false], ['rauha/job-3f2a', false], ['origin/main', true]]);
  });

  it('현재 브랜치와 팀원 작업 브랜치를 표시한다', () => {
    expect(list[0]!.current).toBe(true);
    expect(list[1]!.isTeamJob()).toBe(true);
    expect(list[0]!.isTeamJob()).toBe(false);
  });
});
