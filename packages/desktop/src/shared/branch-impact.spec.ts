import { describe, expect, it } from 'vitest';
import { autoDeployFor, classifyDiffLine, parseLeftRight, parseNumstat } from './branch-impact.js';

describe('parseNumstat', () => {
  it('바뀐 파일마다 추가·삭제 줄 수를 읽는다', () => {
    expect(parseNumstat('3\t1\tsrc/a.ts\n10\t0\tsrc/b.ts\n')).toEqual([
      { path: 'src/a.ts', additions: 3, deletions: 1 },
      { path: 'src/b.ts', additions: 10, deletions: 0 },
    ]);
  });

  it('이진 파일은 줄 수를 모른다고 쓴다', () => {
    expect(parseNumstat('-\t-\timg/logo.png')).toEqual([{ path: 'img/logo.png', additions: null, deletions: null }]);
  });

  it('빈 출력은 빈 목록이다', () => {
    expect(parseNumstat('')).toEqual([]);
  });
});

describe('parseLeftRight', () => {
  it('왼쪽과 오른쪽 커밋 수를 읽고 모양이 틀리면 null이다', () => {
    expect(parseLeftRight('2\t5\n')).toEqual([2, 5]);
    expect(parseLeftRight('이상한 글')).toBeNull();
  });
});

describe('autoDeployFor', () => {
  const workflow = (branches: string, extra = 'run: ./deploy.sh') => ({ path: '.github/workflows/cd.yml', text: `on:\n  push:\n    branches: [${branches}]\njobs:\n  x:\n    steps:\n      - ${extra}` });

  it('CI 설정이 하나도 없으면 모른다', () => {
    expect(autoDeployFor('main', [])).toBe('unknown');
  });

  it('그 브랜치가 적힌 배포 워크플로가 있으면 자동 배포다', () => {
    expect(autoDeployFor('main', [workflow('main')])).toBe('yes');
  });

  it('다른 브랜치만 적혀 있으면 아니다', () => {
    expect(autoDeployFor('qa', [workflow('main')])).toBe('no');
  });

  it('이름이 비슷한 브랜치는 같은 것으로 보지 않는다', () => {
    expect(autoDeployFor('main', [workflow('main-old')])).toBe('no');
    expect(autoDeployFor('main', [workflow('feature/main')])).toBe('no');
  });

  it('배포와 상관없는 워크플로는 자동 배포로 보지 않는다', () => {
    expect(autoDeployFor('main', [{ path: '.github/workflows/test.yml', text: 'on:\n  push:\n    branches: [main]\nsteps:\n  - run: yarn test' }])).toBe('no');
  });
});

describe('classifyDiffLine', () => {
  it('추가·삭제·구간·머리말·그대로인 줄을 가른다', () => {
    expect(classifyDiffLine('+const a = 1;')).toBe('add');
    expect(classifyDiffLine('-const a = 0;')).toBe('del');
    expect(classifyDiffLine('@@ -1,2 +1,2 @@')).toBe('hunk');
    expect(classifyDiffLine('+++ b/pay.ts')).toBe('meta');
    expect(classifyDiffLine('--- a/pay.ts')).toBe('meta');
    expect(classifyDiffLine('diff --git a/x b/x')).toBe('meta');
    expect(classifyDiffLine(' 그대로')).toBe('ctx');
  });
});
