import { SecretPolicy } from '@rauha/core';
import { describe, expect, it } from 'vitest';
import { CarryPaths, MAX_CARRY_FILES } from './carry-paths.js';

const policy = SecretPolicy.defaults();

describe('옮길 파일 경로(CarryPaths)', () => {
  it('레포 안의 상대 경로는 슬래시로 맞춰 통과시킨다', () => {
    expect(CarryPaths.of(['src\\a.ts', 'docs/b.md'], policy).allowed()).toEqual(['src/a.ts', 'docs/b.md']);
  });

  it('비밀 파일(.env 등)은 옮기지 않는다', () => {
    expect(CarryPaths.of(['.env', 'config/.env.local', 'src/a.ts'], policy).allowed()).toEqual(['src/a.ts']);
  });

  it('레포 밖으로 나가는 경로(..)와 절대 경로는 옮기지 않는다', () => {
    expect(CarryPaths.of(['../x.ts', 'a/../../x.ts', '/etc/passwd', 'C:\\x.ts', 'C:x.ts', '\\\\srv\\x'], policy).allowed()).toEqual([]);
  });

  it('.git 아래 경로와 빈 경로·널 문자가 든 경로는 옮기지 않는다', () => {
    expect(CarryPaths.of(['.git/config', 'sub/.git/hooks/x', '', 'a\0b'], policy).allowed()).toEqual([]);
  });

  it('같은 경로는 한 번만, 최대 개수까지만 옮긴다', () => {
    const many = Array.from({ length: MAX_CARRY_FILES + 20 }, (_, i) => `f${i}.ts`);
    expect(CarryPaths.of(['a.ts', 'a.ts', './a.ts'], policy).allowed()).toEqual(['a.ts']);
    expect(CarryPaths.of(many, policy).allowed()).toHaveLength(MAX_CARRY_FILES);
  });
});
