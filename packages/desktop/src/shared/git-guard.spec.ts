import { describe, expect, it } from 'vitest';
import { BranchName, compareUrl, GitInputError, ProtectedBranches, RepoPath, StashMessage, StashRef } from './git-guard.js';

describe('BranchName.parse', () => {
  it('보통 이름은 받는다', () => {
    expect(BranchName.parse('feature/idem-key_2').value).toBe('feature/idem-key_2');
    expect(BranchName.parse('  fix  ').value).toBe('fix');
  });

  it.each(['', '-rf', '--force', 'a b', 'a..b', 'a~1', 'a^', 'a:b', 'a?', 'a*', 'a[', 'a\\b', '/a', 'a/', 'a.lock', '@', 'a@{1}', 'a//b', '.hidden', 'x\n'])('%j 는 거절한다', (n) => {
    expect(() => BranchName.parse(n)).toThrow();
  });

  it('원격 이름에서 브랜치 부분만 뽑는다', () => {
    expect(BranchName.parse('origin/feature/x').withoutRemote('origin')).toBe('feature/x');
  });
});

describe('ProtectedBranches', () => {
  const p = ProtectedBranches.of(['main', 'qa', 'release', 'release/*']);

  it('목록과 와일드카드로 보호 여부를 가린다', () => {
    expect(p.has('main')).toBe(true);
    expect(p.has('release/1.2')).toBe(true);
    expect(p.has('feature/main')).toBe(false);
  });

  it('원격 이름(origin/main)도 같은 브랜치로 본다', () => {
    expect(p.has('origin/main')).toBe(true);
  });
});

describe('RepoPath.parse', () => {
  it('레포 안의 상대 경로만 받는다', () => {
    expect(RepoPath.parse('src/a.ts').value).toBe('src/a.ts');
    expect(RepoPath.parse('src\\a.ts').value).toBe('src/a.ts');
  });

  it.each(['', '../x', 'a/../../x', '/etc/passwd', 'C:/x', '-rf', '.git/config', 'a/.git/hooks/x'])('%j 는 거절한다', (p) => {
    expect(() => RepoPath.parse(p)).toThrow();
  });
});

describe('compareUrl', () => {
  it.each([
    ['https://github.com/acme/app.git', 'https://github.com/acme/app/compare/main...feature/x?expand=1'],
    ['git@github.com:acme/app.git', 'https://github.com/acme/app/compare/main...feature/x?expand=1'],
    ['ssh://git@github.com/acme/app', 'https://github.com/acme/app/compare/main...feature/x?expand=1'],
    ['https://user:tok@github.com/acme/app.git', 'https://github.com/acme/app/compare/main...feature/x?expand=1'],
  ])('%s', (remote, url) => {
    expect(compareUrl(remote, 'main', 'feature/x')).toBe(url);
  });

  it('GitHub가 아니면 null이다', () => {
    expect(compareUrl('https://gitlab.com/a/b.git', 'main', 'x')).toBeNull();
    expect(compareUrl('', 'main', 'x')).toBeNull();
  });

  it('브랜치 이름의 특수 문자는 주소에 맞게 바꾼다', () => {
    expect(compareUrl('git@github.com:a/b.git', 'main', 'fix#1')).toContain('fix%231');
  });
});

describe('StashRef.parse', () => {
  const hash = 'a'.repeat(40);

  it('몇 번째 stash 인지와 그 stash 의 커밋 해시를 함께 받아 stash@{N} 이름을 만든다', () => {
    const ref = StashRef.parse({ index: 2, hash });
    expect(ref.name).toBe('stash@{2}');
    expect(ref.hash).toBe(hash);
  });

  it.each([-1, 1.5, '1', null, undefined, Number.NaN, 10_000, '--all'])('번호 %j 는 거절한다', (index) => {
    expect(() => StashRef.parse({ index, hash })).toThrow(GitInputError);
  });

  it.each(['', 'abc', '--all', 'g'.repeat(40), `${hash};rm`, 'a'.repeat(41), 5, null])('해시 %j 는 거절한다(목록이 바뀐 줄 모르고 엉뚱한 stash 를 건드리지 않게)', (bad) => {
    expect(() => StashRef.parse({ index: 0, hash: bad })).toThrow(GitInputError);
  });

  it('대문자 해시는 소문자로 맞춘다', () => {
    expect(StashRef.parse({ index: 0, hash: 'A'.repeat(40) }).hash).toBe('a'.repeat(40));
  });
});

describe('StashMessage.parse', () => {
  it('앞뒤 공백을 지우고, 비어 있으면 git 기본 메시지를 쓰도록 빈 글이다', () => {
    expect(StashMessage.parse('  wip: 결제  ').value).toBe('wip: 결제');
    expect(StashMessage.parse('   ').value).toBe('');
    expect(StashMessage.parse(undefined).value).toBe('');
  });

  it('줄바꿈 같은 제어 문자와 100자 넘는 글은 거절한다', () => {
    expect(() => StashMessage.parse('a\nb')).toThrow(GitInputError);
    expect(() => StashMessage.parse('a\u0000b')).toThrow(GitInputError);
    expect(() => StashMessage.parse('x'.repeat(101))).toThrow(GitInputError);
    expect(StashMessage.parse('x'.repeat(100)).value).toHaveLength(100);
  });

  it('글자가 아닌 값은 거절한다', () => {
    expect(() => StashMessage.parse(5)).toThrow(GitInputError);
  });
});

describe('RepoPath.parse 공격 이름', () => {
  it.each([
    '.git.',
    '.git ',
    'a/.git. /x',
    'a/.GIT/config',
    'GIT~1/config',
    'sub/git~2/hooks',
    '.g‌it/config',
    '.​git/config',
    '.git﻿/config',
    'a//b',
    './a',
    'a/./b',
    'a\nb.txt',
    'a\u0007b',
  ])('%j 는 .git 이나 이상한 경로로 읽힐 수 있어 거절한다', (p) => {
    expect(() => RepoPath.parse(p)).toThrow();
  });

  it('Windows 에서는 대체 데이터 스트림과 예약 장치 이름도 거절한다', () => {
    for (const p of ['a.txt:stream', '.git::$INDEX_ALLOCATION/config', 'src/CON', 'aux.txt', 'LPT1', 'nul.', 'src/com3.log']) {
      expect(() => RepoPath.parse(p, true), p).toThrow();
    }
  });

  it('Windows 가 아니면 콜론·장치 이름은 평범한 이름이다', () => {
    expect(RepoPath.parse('docs/aux.txt', false).value).toBe('docs/aux.txt');
    expect(RepoPath.parse('docs/a:b.txt', false).value).toBe('docs/a:b.txt');
  });

  it('보통 이름은 계속 받는다', () => {
    for (const p of ['src/a.ts', 'git.md', 'my.git/readme', '.github/workflows/ci.yml', '.gitignore', '한글/파일 이름.txt']) {
      expect(RepoPath.parse(p, true).value).toBe(p);
    }
  });
});
