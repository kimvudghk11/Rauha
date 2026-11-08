import { describe, expect, it } from 'vitest';
import { fuzzyScore, rankFiles } from './quick-open.js';

describe('빠른 열기 이름 맞추기', () => {
  it('글자가 차례대로 들어 있으면 맞다', () => {
    expect(fuzzyScore('apts', 'src/app.test.ts')).not.toBeNull();
    expect(fuzzyScore('zzz', 'src/app.ts')).toBeNull();
  });

  it('순서가 다르면 안 맞는다', () => {
    expect(fuzzyScore('tsa', 'src/a.ts')).toBeNull();
  });

  it('검색어가 비면 모두 같은 점수', () => {
    expect(fuzzyScore('', 'a/b.ts')).toBe(0);
  });

  it('대소문자와 역슬래시를 가리지 않는다', () => {
    expect(fuzzyScore('SRC\\APP', 'src/app.ts')).not.toBeNull();
  });

  it('파일 이름이 그대로 맞으면 폴더 이름에서 맞은 것보다 앞선다', () => {
    const r = rankFiles('app', ['app/readme.md', 'src/app.ts', 'src/other/zapper.ts'], 3);
    expect(r[0]).toBe('src/app.ts');
  });

  it('이어진 글자·단어 시작을 앞세운다', () => {
    const r = rankFiles('cv', ['src/code-view.ts', 'src/cache-vault-x.ts', 'src/xcxxvx.ts'], 3);
    expect(r[0]).toBe('src/code-view.ts');
  });

  it('최대 개수만 돌려주고 안 맞는 것은 뺀다', () => {
    expect(rankFiles('a', ['a1', 'a2', 'a3', 'b'], 2)).toHaveLength(2);
    expect(rankFiles('zz', ['a1'], 5)).toEqual([]);
  });

  it('검색어가 비면 짧은 경로부터 보여 준다', () => {
    expect(rankFiles('', ['a/b/c.ts', 'a.ts'], 2)).toEqual(['a.ts', 'a/b/c.ts']);
  });
});
