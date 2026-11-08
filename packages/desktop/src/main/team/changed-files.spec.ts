import { describe, expect, it } from 'vitest';
import { newlyChanged, parsePorcelainZ } from './changed-files.js';

describe('git status 읽기', () => {
  it('상태와 경로를 읽고, 이름이 바뀐 항목은 새 이름만 센다', () => {
    const out = [' M src/a.ts', '?? new file.ts', 'R  src/new.ts', 'src/old.ts', 'A  b.ts', ''].join('\0');
    expect([...parsePorcelainZ(out)]).toEqual([
      ['src/a.ts', ' M'],
      ['new file.ts', '??'],
      ['src/new.ts', 'R '],
      ['b.ts', 'A '],
    ]);
  });

  it('빈 출력은 빈 목록', () => {
    expect(parsePorcelainZ('').size).toBe(0);
  });
});

describe('일하는 동안 바뀐 파일', () => {
  it('원래부터 바뀌어 있던 파일은 빼고, 새로 생기거나 상태가 달라진 것만 돌려준다', () => {
    const before = new Map([['keep.ts', ' M'], ['staged.ts', ' M']]);
    const after = new Map([['keep.ts', ' M'], ['staged.ts', 'M '], ['fresh.ts', '??']]);
    expect(newlyChanged(before, after)).toEqual(['staged.ts', 'fresh.ts']);
  });
});
