import { describe, expect, it } from 'vitest';
import { GitAccounts, githubAuthor, parseWorkLog, resumeNote, summarizeWork } from './my-work.js';

const accounts = GitAccounts.from([
  { label: 'Personal', emails: ['me@gmail.com', ' ME@Gmail.com '] },
  { label: 'Company', emails: ['kim@corp.com'] },
]);

describe('내 계정들', () => {
  it('이메일은 소문자로 한 번만, 빈 계정·이상한 이메일은 버린다', () => {
    expect(accounts.list).toEqual([
      { label: 'Personal', emails: ['me@gmail.com'] },
      { label: 'Company', emails: ['kim@corp.com'] },
    ]);
    expect(GitAccounts.from([{ label: '', emails: ['a@b.c'] }, { label: 'X', emails: ['nope'] }, 'junk']).list).toEqual([]);
  });
  it('작성자 이메일로 어느 계정인지(대소문자 무시), 모르면 null', () => {
    expect(accounts.labelOf('Kim@Corp.com')).toBe('Company');
    expect(accounts.labelOf('other@x.com')).toBeNull();
  });
});

const US = '\u001f';
const log = [
  `@@${['h1', 'Me', 'me@gmail.com', '1714521600', 'feat: login'].join(US)}`, // 2024-05-01
  '10\t2\tsrc/a.ts',
  '-\t-\timg.png',
  `@@${['h2', 'Kim', 'kim@corp.com', '1717200000', 'fix: pay retry'].join(US)}`, // 2024-06-01
  '3\t1\tsrc/pay.ts',
  `@@${['h3', 'Lee', 'lee@corp.com', '1717200000', 'chore: deps'].join(US)}`,
].join('\n');

describe('GitHub 로그인 묶기', () => {
  it('계정에 GitHub 로그인을 묶으면 GitHub 에서 읽은 커밋(github:<로그인>)을 그 계정으로 센다', () => {
    const a = GitAccounts.from([{ label: 'Company', emails: [], github: ['Kim-Corp', 'bad login!', 'kim-corp'] }]);
    expect(a.list).toEqual([{ label: 'Company', emails: [], github: ['kim-corp'] }]);
    expect(a.labelOf(githubAuthor('Kim-Corp'))).toBe('Company');
    expect(a.labelOf('github:someone')).toBeNull();
    expect(a.logins).toEqual(['kim-corp']);
  });
  it('이메일도 로그인도 없는 계정은 버린다', () => {
    expect(GitAccounts.from([{ label: 'X', emails: [], github: [] }]).list).toEqual([]);
  });
});

describe('커밋 기록 읽기', () => {
  it('커밋마다 해시·작성자·시각·제목과 늘고 준 줄 수(바이너리는 0)', () => {
    expect(parseWorkLog(log, 'shop')).toEqual([
      { repo: 'shop', hash: 'h1', name: 'Me', email: 'me@gmail.com', at: 1714521600, subject: 'feat: login', added: 10, removed: 2, files: 2, langs: { TypeScript: 12 } },
      { repo: 'shop', hash: 'h2', name: 'Kim', email: 'kim@corp.com', at: 1717200000, subject: 'fix: pay retry', added: 3, removed: 1, files: 1, langs: { TypeScript: 4 } },
      { repo: 'shop', hash: 'h3', name: 'Lee', email: 'lee@corp.com', at: 1717200000, subject: 'chore: deps', added: 0, removed: 0, files: 0, langs: {} },
    ]);
  });
});

describe('내 작업 묶기', () => {
  const commits = parseWorkLog(log, 'shop');
  it('내 계정 커밋만, 계정별 → 월별 → 레포별로 센다', () => {
    const s = summarizeWork(commits, accounts);
    expect(s.total).toBe(2);
    expect(s.accounts.map((a) => [a.label, a.commits, a.added, a.removed])).toEqual([
      ['Company', 1, 3, 1],
      ['Personal', 1, 10, 2],
    ]);
    expect(s.accounts[0]!.months[0]).toMatchObject({ month: '2024-06', repos: [{ repo: 'shop', commits: 1, subjects: ['fix: pay retry'] }] });
  });
  it('계정마다 내가 바꾼 언어(줄 수, 많은 순)', () => {
    expect(summarizeWork(commits, accounts).accounts[1]!.langs).toEqual([{ lang: 'TypeScript', lines: 12 }]);
  });
  it('메모에 기록 기간, 바꾼 언어 비중, 내가 커밋한 레포의 설정 파일 스택이 들어간다(남의 레포 스택은 빼고)', () => {
    const note = resumeNote(summarizeWork(commits, accounts, [{ repo: 'shop', stack: ['React', 'Vitest'], architecture: ['layered folders: domain, application'] }, { repo: 'other', stack: ['Django'], architecture: [] }]));
    expect(note).toMatch(/TypeScript 100%/);
    expect(note).toContain('shop: React, Vitest');
    expect(note).toContain('layered folders: domain, application');
    expect(note).not.toContain('Django');
    expect(note).toMatch(/2024-05 ~ 2024-06/);
  });
  it('남의 커밋 작성자는 "아직 고르지 않은 작성자"로 세어 준다', () => {
    expect(summarizeWork(commits, accounts).others).toEqual([{ name: 'Lee', email: 'lee@corp.com', commits: 1 }]);
  });
  it('이력서 초안용 메모는 커밋 제목과 숫자만(코드 없음), 상한까지', () => {
    const note = resumeNote(summarizeWork(commits, accounts));
    expect(note).toContain('fix: pay retry');
    expect(note).toContain('Company');
    expect(note).not.toContain('src/pay.ts');
  });

  it('면접용 짧은 메모는 레포·월마다 제목을 몇 개만 남기고 나머지는 개수로 적어, 뒤 계정이 잘리지 않는다', () => {
    const many = Array.from({ length: 400 }, (_, i) => [`@@${[`p${i}`, 'Me', 'me@gmail.com', String(1714521600 + i), `feat: personal change number ${i} with a fairly long subject line`].join(US)}`, '1\t1\tsrc/a.ts'].join('\n'));
    const corp = `@@${['c1', 'Kim', 'kim@corp.com', '1717200000', 'fix: pay retry'].join(US)}\n3\t1\tsrc/pay.ts`;
    const summary = summarizeWork(parseWorkLog([...many, corp].join('\n'), 'shop'), accounts);
    const short = resumeNote(summary, { subjectsPerRow: 5, max: 4000 });
    expect(short.length).toBeLessThanOrEqual(4000 + 10);
    expect(short).toContain('fix: pay retry');
    expect(short).toContain('Personal account');
    expect(short).toMatch(/\(\+\d+ more\)/);
    expect(short.length).toBeLessThan(resumeNote(summary).length);
  });
});
