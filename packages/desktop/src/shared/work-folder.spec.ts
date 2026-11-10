import { describe, expect, it } from 'vitest';
import { startsAsNewProject, workFolderProblem } from './work-folder.js';

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

describe('startsAsNewProject', () => {
  const base = { exists: true, isDirectory: true, insideRepo: false, entries: [] as string[] };

  it('git 저장소 밖의 빈 폴더는 새 프로젝트로 보고 git을 시작해 준다', () => {
    expect(startsAsNewProject(base)).toBe(true);
  });

  it('맥이 만든 .DS_Store 같은 시스템 파일만 있으면 빈 폴더로 본다', () => {
    expect(startsAsNewProject({ ...base, entries: ['.DS_Store', 'Thumbs.db', 'desktop.ini'] })).toBe(true);
  });

  it('파일이 하나라도 있는 폴더는 사용자의 것이라 건드리지 않는다', () => {
    expect(startsAsNewProject({ ...base, entries: ['notes.txt'] })).toBe(false);
  });

  it('이미 git 저장소 안이면 새로 시작하지 않는다', () => {
    expect(startsAsNewProject({ ...base, insideRepo: true })).toBe(false);
  });

  it('없는 폴더나 파일에는 시작하지 않는다', () => {
    expect(startsAsNewProject({ ...base, exists: false })).toBe(false);
    expect(startsAsNewProject({ ...base, isDirectory: false })).toBe(false);
  });
});
