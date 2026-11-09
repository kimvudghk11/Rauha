import { describe, expect, it } from 'vitest';
import { ChangeMap } from '../shared/code-changes.js';
import { changeTitle, folderMark } from './tree-mark.js';

const map = ChangeMap.of([
  { path: 'src/a.ts', code: 'M' },
  { path: 'tmp/', code: 'U' },
]);

describe('폴더 줄 상태 표시', () => {
  it('바뀐 파일이 없는 폴더에는 아무 표시도 하지 않는다', () => {
    expect(folderMark(map, 'docs')).toBeNull();
  });

  it('안에 바뀐 파일만 있는 폴더는 글자 배지 없이 이름 색과 설명만 준다', () => {
    const mark = folderMark(map, 'src');
    expect(mark).not.toBeNull();
    expect(mark?.badge).toBeNull();
    expect(mark?.title).toBe('안에 바뀐 파일이 있어요');
  });

  it('폴더 자체가 추적 안 하는 새 폴더면 U 배지와 설명을 준다', () => {
    expect(folderMark(map, 'tmp')).toEqual({ badge: 'U', title: '새 폴더(추적 안 함)' });
  });

  it('점 모양 표시(●)를 어떤 경우에도 만들지 않는다', () => {
    for (const p of ['src', 'tmp', 'docs']) expect(JSON.stringify(folderMark(map, p))).not.toContain('●');
  });

  it('파일 상태 글자마다 설명을 준다', () => {
    expect(changeTitle('M')).toBe('수정됨');
    expect(changeTitle('D')).toBe('삭제됨');
    expect(changeTitle('U')).toBe('새 파일(추적 안 함)');
  });
});
