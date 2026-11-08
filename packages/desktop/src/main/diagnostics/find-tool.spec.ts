import { describe, expect, it } from 'vitest';
import { findOnPath } from './find-tool.js';

describe('PATH에서 도구 찾기', () => {
  it('PATH 앞쪽 폴더부터 보고 처음 찾은 경로를 돌려준다(맥)', () => {
    const files = new Set(['/opt/homebrew/bin/git', '/usr/bin/git']);
    expect(findOnPath('git', '/opt/homebrew/bin:/usr/bin', 'darwin', (p) => files.has(p), {})).toBe('/opt/homebrew/bin/git');
  });

  it('없으면 null', () => {
    expect(findOnPath('aws', '/usr/bin:/bin', 'darwin', () => false, {})).toBeNull();
  });

  it('윈도는 PATHEXT 확장자를 붙여 찾는다', () => {
    const files = new Set(['C:\\Program Files\\Git\\cmd\\git.EXE']);
    expect(findOnPath('git', 'C:\\Windows;C:\\Program Files\\Git\\cmd', 'win32', (p) => files.has(p), { PATHEXT: '.COM;.EXE;.CMD' })).toBe('C:\\Program Files\\Git\\cmd\\git.EXE');
  });

  it('빈 PATH 칸과 따옴표는 건너뛰거나 벗긴다', () => {
    const files = new Set(['/a/node']);
    expect(findOnPath('node', '::"/a"', 'linux', (p) => files.has(p), {})).toBe('/a/node');
  });
});
