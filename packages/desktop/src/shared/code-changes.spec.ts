import { describe, expect, it } from 'vitest';
import { allAdded, ChangeMap, parseHunks, parseStatusZ } from './code-changes.js';

describe('git status 읽기', () => {
  it('수정·추가·삭제·새 파일을 한 글자로 바꾼다', () => {
    const out = ' M src/a.ts\0A  src/b.ts\0 D old.ts\0?? new.ts\0?? tmp/\0';
    expect(parseStatusZ(out)).toEqual([
      { path: 'src/a.ts', code: 'M' },
      { path: 'src/b.ts', code: 'A' },
      { path: 'old.ts', code: 'D' },
      { path: 'new.ts', code: 'U' },
      { path: 'tmp/', code: 'U' },
    ]);
  });

  it('이름이 바뀐 항목은 새 이름만 담고 뒤따르는 옛 이름을 건너뛴다', () => {
    expect(parseStatusZ('R  new.ts\0old.ts\0 M b.ts\0')).toEqual([
      { path: 'new.ts', code: 'R' },
      { path: 'b.ts', code: 'M' },
    ]);
  });

  it('충돌은 ! 로 표시한다', () => {
    expect(parseStatusZ('UU a.ts\0AA b.ts\0')).toEqual([
      { path: 'a.ts', code: '!' },
      { path: 'b.ts', code: '!' },
    ]);
  });

  it('스테이지된 수정(M )도 M이다', () => {
    expect(parseStatusZ('M  a.ts\0')).toEqual([{ path: 'a.ts', code: 'M' }]);
  });

  it('빈 출력은 변경 없음', () => {
    expect(parseStatusZ('')).toEqual([]);
  });
});

describe('변경 지도', () => {
  const map = ChangeMap.of([
    { path: 'src/a.ts', code: 'M' },
    { path: 'tmp/', code: 'U' },
  ]);

  it('파일 상태를 돌려준다', () => {
    expect(map.statusOf('src/a.ts')).toBe('M');
    expect(map.statusOf('src/b.ts')).toBeNull();
  });

  it('추적 안 하는 폴더 안의 파일은 새 파일(U)이다', () => {
    expect(map.statusOf('tmp/x/y.ts')).toBe('U');
  });

  it('변경이 든 폴더를 알려 준다(위 폴더까지)', () => {
    expect(map.dirHasChange('src')).toBe(true);
    expect(map.dirHasChange('tmp')).toBe(true);
    expect(map.dirHasChange('docs')).toBe(false);
  });

  it('깊은 파일의 모든 위 폴더가 변경 폴더다', () => {
    const deep = ChangeMap.of([{ path: 'a/b/c.ts', code: 'M' }]);
    expect(deep.dirHasChange('a')).toBe(true);
    expect(deep.dirHasChange('a/b')).toBe(true);
  });
});

describe('git diff -U0 에서 바뀐 줄 뽑기', () => {
  it('줄이 새로 생기면 added', () => {
    expect(parseHunks('@@ -3,0 +4,2 @@ x\n+a\n+b\n')).toEqual([{ from: 4, to: 5, kind: 'added' }]);
  });

  it('줄을 고치면 modified', () => {
    expect(parseHunks('@@ -5 +5 @@\n-a\n+b\n')).toEqual([{ from: 5, to: 5, kind: 'modified' }]);
  });

  it('줄이 지워지면 그 다음 줄에 deleted', () => {
    expect(parseHunks('@@ -7,2 +6,0 @@\n-a\n-b\n')).toEqual([{ from: 7, to: 7, kind: 'deleted' }]);
  });

  it('고치면서 줄이 늘면 앞은 modified, 나머지는 added', () => {
    expect(parseHunks('@@ -2,1 +2,3 @@\n')).toEqual([
      { from: 2, to: 2, kind: 'modified' },
      { from: 3, to: 4, kind: 'added' },
    ]);
  });

  it('고치면서 줄이 줄면 modified와 deleted', () => {
    expect(parseHunks('@@ -2,3 +2,1 @@\n')).toEqual([
      { from: 2, to: 2, kind: 'modified' },
      { from: 3, to: 3, kind: 'deleted' },
    ]);
  });

  it('여러 덩어리를 모두 읽는다', () => {
    expect(parseHunks('@@ -1 +1 @@\n@@ -9,0 +10 @@\n')).toHaveLength(2);
  });

  it('새 파일은 전체가 added', () => {
    expect(allAdded(3)).toEqual([{ from: 1, to: 3, kind: 'added' }]);
    expect(allAdded(0)).toEqual([]);
  });
});
