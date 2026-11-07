import { describe, expect, it } from 'vitest';
import { classifyFolder, SKIPPED_FOLDERS } from './folder-kind.js';

describe('classifyFolder', () => {
  it('.git이 있으면 파일이 무엇이든 레포다', () => {
    expect(classifyFolder({ hasGit: true, extensions: ['md', 'md'] })).toBe('repo');
  });

  it('파일 대부분이 문서면 문서 폴더다', () => {
    expect(classifyFolder({ hasGit: false, extensions: ['md', 'pdf', 'docx', 'png'] })).toBe('docs');
  });

  it('문서가 절반이면 문서 폴더가 아니다(절반 넘어야 한다)', () => {
    expect(classifyFolder({ hasGit: false, extensions: ['md', 'png'] })).toBe('other');
  });

  it('파일이 없으면 기타다', () => {
    expect(classifyFolder({ hasGit: false, extensions: [] })).toBe('other');
  });
});

describe('SKIPPED_FOLDERS', () => {
  it('생성물·의존성 폴더는 들어가지 않는다', () => {
    for (const name of ['node_modules', 'dist', 'build', '.venv', '.next', 'target']) expect(SKIPPED_FOLDERS.has(name)).toBe(true);
    expect(SKIPPED_FOLDERS.has('src')).toBe(false);
  });
});
