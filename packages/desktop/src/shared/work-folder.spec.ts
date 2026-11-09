import { describe, expect, it } from 'vitest';
import { workFolderProblem } from './work-folder.js';

describe('workFolderProblem', () => {
  it('폴더가 있으면 문제가 없다', () => {
    expect(workFolderProblem('/work', { exists: true, isDirectory: true })).toBeNull();
  });

  it('폴더가 지워졌거나 옮겨졌으면 설정에서 다시 고르라고 알려 준다', () => {
    const msg = workFolderProblem('/work/old', { exists: false, isDirectory: false });
    expect(msg).toContain('/work/old');
    expect(msg).toContain('설정');
    expect(msg).toContain('다시');
  });

  it('폴더가 아니라 파일이면 폴더가 아니라고 알려 준다', () => {
    expect(workFolderProblem('/work/a.txt', { exists: true, isDirectory: false })).toContain('폴더가 아니에요');
  });

  it('한글·공백이 든 경로도 그대로 보여 준다', () => {
    expect(workFolderProblem('/Users/김/내 문서', { exists: false, isDirectory: false })).toContain('/Users/김/내 문서');
  });
});
