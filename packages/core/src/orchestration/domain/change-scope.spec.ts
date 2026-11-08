import { describe, expect, it } from 'vitest';
import { ChangeScope } from './change-scope.js';

describe('ChangeScope', () => {
  it('코드 파일이 바뀌면 그 파일과 관련된 테스트만 돌린다', () => {
    const scope = ChangeScope.of(['src/money.ts', 'src/util/format.tsx']);
    expect(scope.testSelection()).toEqual({ kind: 'related', files: ['src/money.ts', 'src/util/format.tsx'] });
  });

  it('테스트 파일이 바뀌면 그 테스트도 관련 테스트에 들어간다', () => {
    expect(ChangeScope.of(['src/money.spec.ts']).testSelection()).toEqual({ kind: 'related', files: ['src/money.spec.ts'] });
  });

  it('윈도우식 경로 구분자는 슬래시로 바꿔서 다룬다', () => {
    expect(ChangeScope.of(['src\\money.ts']).testSelection()).toEqual({ kind: 'related', files: ['src/money.ts'] });
  });

  it('package.json·lockfile·tsconfig·테스트 도구 설정이 바뀌면 전체 테스트를 돌린다', () => {
    for (const file of ['package.json', 'yarn.lock', 'apps/api/tsconfig.base.json', 'vitest.config.ts', 'vite.config.mts', 'jest.config.js', '.eslintrc.json', 'eslint.config.js']) {
      expect(ChangeScope.of(['src/a.ts', file]).testSelection()).toEqual({ kind: 'full' });
    }
  });

  it('코드가 바뀐 곳이 없으면(문서·이미지만) 관련 테스트는 없다', () => {
    expect(ChangeScope.of(['README.md', 'logo.png']).testSelection()).toEqual({ kind: 'none' });
    expect(ChangeScope.of([]).testSelection()).toEqual({ kind: 'none' });
  });

  it('같은 파일이 두 번 들어와도 한 번만 센다', () => {
    expect(ChangeScope.of(['src/a.ts', 'src/a.ts']).testSelection()).toEqual({ kind: 'related', files: ['src/a.ts'] });
  });
});
