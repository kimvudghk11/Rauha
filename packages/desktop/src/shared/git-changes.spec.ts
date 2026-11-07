import { describe, expect, it } from 'vitest';
import { ChangeSet } from './git-changes.js';

const NUL = '\0';
const z = (...records: string[]) => records.join(NUL) + NUL;

describe('ChangeSet.parse (git status --porcelain=v2 -z --branch)', () => {
  const text = z(
    '# branch.oid abc123',
    '# branch.head feature/x',
    '# branch.upstream origin/feature/x',
    '# branch.ab +3 -2',
    '1 M. N... 100644 100644 100644 aaa bbb src/staged.ts',
    '1 .M N... 100644 100644 100644 aaa bbb src/worktree.ts',
    '1 MM N... 100644 100644 100644 aaa bbb src/both.ts',
    '1 A. N... 000000 100644 100644 000 bbb src/new file.ts',
    '1 .D N... 100644 100644 000000 aaa bbb src/gone.ts',
    '2 R. N... 100644 100644 100644 aaa bbb R100 src/renamed.ts' + NUL + 'src/old.ts',
    'u UU N... 100644 100644 100644 100644 a b c src/conflict.ts',
    '? notes.txt',
  );
  const set = ChangeSet.parse(text);

  it('브랜치 이름과 원격, 앞섬·뒤처짐을 읽는다', () => {
    expect(set.branch).toBe('feature/x');
    expect(set.upstream).toBe('origin/feature/x');
    expect(set.ahead).toBe(3);
    expect(set.behind).toBe(2);
  });

  it('원격이 없으면 앞섬·뒤처짐은 null이다', () => {
    const none = ChangeSet.parse(z('# branch.oid abc', '# branch.head main', '? a.txt'));
    expect(none.upstream).toBeNull();
    expect(none.ahead).toBeNull();
  });

  it('분리된 HEAD는 브랜치가 null이다', () => {
    expect(ChangeSet.parse(z('# branch.oid abc', '# branch.head (detached)')).branch).toBeNull();
  });

  it('공백이 든 경로와 이름 바꾼 파일의 옛 경로를 읽는다', () => {
    expect(set.files.map((f) => f.path)).toContain('src/new file.ts');
    expect(set.files.find((f) => f.path === 'src/renamed.ts')?.oldPath).toBe('src/old.ts');
  });

  it('파일마다 스테이지된 쪽과 안 된 쪽 표시를 나눈다', () => {
    const by = (p: string) => set.files.find((f) => f.path === p)!;
    expect(by('src/staged.ts').isStaged()).toBe(true);
    expect(by('src/staged.ts').hasUnstaged()).toBe(false);
    expect(by('src/worktree.ts').isStaged()).toBe(false);
    expect(by('src/worktree.ts').hasUnstaged()).toBe(true);
    expect(by('src/both.ts').isStaged()).toBe(true);
    expect(by('src/both.ts').hasUnstaged()).toBe(true);
  });

  it('한 글자 표시는 M·A·D·R·?·충돌 순으로 정한다', () => {
    const by = (p: string) => set.files.find((f) => f.path === p)!;
    expect(by('src/staged.ts').label()).toBe('M');
    expect(by('src/new file.ts').label()).toBe('A');
    expect(by('src/gone.ts').label()).toBe('D');
    expect(by('src/renamed.ts').label()).toBe('R');
    expect(by('notes.txt').label()).toBe('?');
    expect(by('src/conflict.ts').label()).toBe('!');
  });

  it('충돌 파일과 추적 안 되는 파일을 가려낸다', () => {
    expect(set.conflicts().map((f) => f.path)).toEqual(['src/conflict.ts']);
    expect(set.files.find((f) => f.path === 'notes.txt')!.isUntracked()).toBe(true);
    expect(set.hasConflicts()).toBe(true);
  });

  it('.env 같은 비밀 파일은 기본으로 스테이지에서 제외한다', () => {
    const s = ChangeSet.parse(z('# branch.head main', '? .env.local', '? id_rsa', '? readme.md'));
    expect(s.files.filter((f) => f.looksSecret()).map((f) => f.path)).toEqual(['.env.local', 'id_rsa']);
  });
});
