import { describe, expect, it } from 'vitest';
import { parseStatus } from './git-status.js';

describe('parseStatus', () => {
  it('브랜치와 앞섬·뒤처짐, 바뀐 파일 수를 읽는다', () => {
    expect(parseStatus('## main...origin/main [ahead 2, behind 1]\n M a.ts\n?? b.ts\n')).toEqual({ branch: 'main', ahead: 2, behind: 1, changed: 2 });
  });

  it('원격과 같으면 앞섬·뒤처짐은 0이다', () => {
    expect(parseStatus('## main...origin/main\n')).toEqual({ branch: 'main', ahead: 0, behind: 0, changed: 0 });
  });

  it('원격이 없는 브랜치는 앞섬·뒤처짐을 모른다', () => {
    expect(parseStatus('## feature/x\n M a.ts\n')).toEqual({ branch: 'feature/x', ahead: null, behind: null, changed: 1 });
  });

  it('분리된 HEAD는 브랜치가 없다', () => {
    expect(parseStatus('## HEAD (no branch)\n').branch).toBeNull();
  });

  it('첫 커밋 전 레포도 읽는다', () => {
    expect(parseStatus('## No commits yet on main\n').branch).toBe('main');
  });

  it('빈 출력은 아무것도 모른다', () => {
    expect(parseStatus('')).toEqual({ branch: null, ahead: null, behind: null, changed: 0 });
  });
});
