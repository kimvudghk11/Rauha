import { describe, expect, it } from 'vitest';
import { recentFolderRows } from './recent-folders.js';

describe('recentFolderRows', () => {
  it('지금 작업 폴더는 빼고 최근 순서 그대로 보인다', () => {
    const rows = recentFolderRows(['/w/a', '/w/b', '/w/c'], { '/w/a': true, '/w/b': true, '/w/c': true }, '/w/a');
    expect(rows.map((r) => r.path)).toEqual(['/w/b', '/w/c']);
  });

  it('이름은 폴더 이름이고 전체 경로는 따로 둔다(맥·윈도우 구분자 모두)', () => {
    const win = 'C:\\dev\\blog\\';
    const rows = recentFolderRows(['/Users/me/work/shop', win], { '/Users/me/work/shop': true, [win]: true }, null);
    expect(rows.map((r) => r.name)).toEqual(['shop', 'blog']);
  });

  it('사라졌거나 확인하지 못한 폴더는 열 수 없다고 표시한다', () => {
    const rows = recentFolderRows(['/w/a', '/w/b'], { '/w/a': false }, null);
    expect(rows.map((r) => r.missing)).toEqual([true, true]);
    expect(recentFolderRows(['/w/a'], { '/w/a': true }, null)[0]?.missing).toBe(false);
  });

  it('목록이 비어 있으면 아무것도 보이지 않는다', () => {
    expect(recentFolderRows([], {}, '/w/a')).toEqual([]);
  });
});
