import { describe, expect, it } from 'vitest';
import { loginShellArgs, mergePath, needsShellPath, parseShellPath, PATH_MARK } from './shell-path.js';

describe('parseShellPath', () => {
  it('표시 사이의 PATH만 꺼낸다 — rc 파일이 찍은 다른 글은 무시한다', () => {
    const out = `Last login: Sun\nwelcome!\n${PATH_MARK}/opt/homebrew/bin:/usr/bin${PATH_MARK}`;
    expect(parseShellPath(out)).toBe('/opt/homebrew/bin:/usr/bin');
  });

  it('표시가 없거나 비었으면 null이다', () => {
    expect(parseShellPath('아무 글')).toBeNull();
    expect(parseShellPath(`${PATH_MARK}${PATH_MARK}`)).toBeNull();
    expect(parseShellPath(`${PATH_MARK}/usr/bin`)).toBeNull();
  });
});

describe('mergePath', () => {
  it('셸의 폴더를 앞에 두고 겹치는 폴더는 한 번만 둔다', () => {
    expect(mergePath('/usr/bin:/bin', '/opt/homebrew/bin:/usr/bin', ':')).toBe('/opt/homebrew/bin:/usr/bin:/bin');
  });

  it('지금 PATH에만 있던 폴더도 남긴다', () => {
    expect(mergePath('/app/bin:/usr/bin', '/opt/homebrew/bin', ':')).toBe('/opt/homebrew/bin:/app/bin:/usr/bin');
  });

  it('셸 PATH를 못 읽었으면 지금 PATH 그대로다', () => {
    expect(mergePath('/usr/bin:/bin', null, ':')).toBe('/usr/bin:/bin');
  });

  it('빈 칸은 버린다', () => {
    expect(mergePath('/usr/bin::', '/x:', ':')).toBe('/x:/usr/bin');
  });
});

describe('needsShellPath · loginShellArgs', () => {
  it('맥과 리눅스만 셸 PATH를 읽고 Windows는 읽지 않는다', () => {
    expect(needsShellPath('darwin')).toBe(true);
    expect(needsShellPath('linux')).toBe(true);
    expect(needsShellPath('win32')).toBe(false);
  });

  it('로그인 셸에서 PATH를 찍는 명령이다', () => {
    const args = loginShellArgs();
    expect(args[0]).toBe('-ilc');
    expect(args[1]).toContain('$PATH');
  });
});
