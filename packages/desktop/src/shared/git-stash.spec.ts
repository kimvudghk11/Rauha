import { describe, expect, it } from 'vitest';
import { classifyStashApply, parseStashes, STASH_FORMAT, stashDropMessage } from './git-stash.js';

const US = '\x1f';
const RS = '\x1e';
const row = (hash: string, subject: string, at: number) => `${hash}${US}${subject}${US}${at}${RS}\n`;
const H1 = '1'.repeat(40);
const H2 = '2'.repeat(40);

describe('parseStashes', () => {
  it('git 이 알려 준 순서대로 번호를 매기고, 내가 적은 메시지와 브랜치를 가른다', () => {
    const list = parseStashes(row(H1, 'On feature/pay: 결제 작업 중', 1700000000) + row(H2, 'WIP on main: abc1234 fix: 오타', 1690000000));
    expect(list).toEqual([
      { index: 0, hash: H1, message: '결제 작업 중', branch: 'feature/pay', at: 1700000000 },
      { index: 1, hash: H2, message: 'abc1234 fix: 오타', branch: 'main', at: 1690000000 },
    ]);
  });

  it('메시지에 콜론이 있어도 첫 "브랜치:" 만 가른다', () => {
    const [s] = parseStashes(row(H1, 'On main: a: b: c', 1));
    expect(s?.branch).toBe('main');
    expect(s?.message).toBe('a: b: c');
  });

  it('모르는 모양의 제목은 통째로 메시지이고 브랜치는 비어 있다', () => {
    const [s] = parseStashes(row(H1, 'custom text', 1));
    expect(s).toMatchObject({ message: 'custom text', branch: '' });
  });

  it('비어 있거나 해시가 아닌 줄은 건너뛴다', () => {
    expect(parseStashes('')).toEqual([]);
    expect(parseStashes(row('nothash', 'On main: x', 1))).toEqual([]);
  });

  it('형식 문자열은 해시·제목·시각을 구분 문자로 잇는다', () => {
    expect(STASH_FORMAT).toContain('%H');
    expect(STASH_FORMAT).toContain('%gs');
    expect(STASH_FORMAT).toContain('%ct');
  });
});

describe('classifyStashApply', () => {
  it('성공하면 stash 가 어떻게 되었는지를 알린다', () => {
    expect(classifyStashApply('apply', { code: 0, stdout: '', stderr: '' }, 'stash@{0}')).toEqual({ kind: 'done', message: 'Applied stash@{0}. The stash is kept.' });
    expect(classifyStashApply('pop', { code: 0, stdout: '', stderr: '' }, 'stash@{0}')).toEqual({ kind: 'done', message: 'Applied stash@{0} and removed it from the list.' });
  });

  it('충돌이 나면 충돌 탭으로 보내고, pop 이어도 stash 는 지워지지 않았다고 알린다', () => {
    const r = classifyStashApply('pop', { code: 1, stdout: 'CONFLICT (content): Merge conflict in a.txt\nThe stash entry is kept in case you need it again.', stderr: '' }, 'stash@{1}');
    expect(r.kind).toBe('conflict');
    expect(r.message).toContain('Conflicts found');
    expect(r.message).toContain('stash@{1} was kept');
  });

  it('지금 변경이 덮어써질 것 같으면 막고 git 이유를 그대로 보인다(강제로 하지 않는다)', () => {
    const r = classifyStashApply('apply', { code: 1, stdout: '', stderr: 'error: Your local changes to the following files would be overwritten by merge:\n\ta.txt\nPlease commit your changes or stash them before you merge.' }, 'stash@{0}');
    expect(r.kind).toBe('blocked');
    expect(r.message).toContain('would be overwritten');
  });
});

describe('stashDropMessage', () => {
  it('지운 stash 의 짧은 해시를 알려 되살릴 길을 남긴다', () => {
    expect(stashDropMessage('stash@{0}', 'Dropped refs/stash@{0} (1234567890abcdef1234567890abcdef12345678)')).toBe('Dropped stash@{0}. To bring it back right away: git stash apply 1234567');
  });

  it('해시를 못 읽으면 해시 안내 없이 알린다', () => {
    expect(stashDropMessage('stash@{0}', '')).toBe('Dropped stash@{0}.');
  });
});
