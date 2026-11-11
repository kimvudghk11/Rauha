import { describe, expect, it } from 'vitest';
import { DomainError } from '../../shared/domain-error.js';
import { WorkspaceState } from './workspace-state.js';

describe('WorkspaceState', () => {
  it('git 저장소가 아니면 시작하지 않는다', () => {
    expect(() => WorkspaceState.of(null).assertReady(true)).toThrow(DomainError);
    expect(() => WorkspaceState.of(null).assertReady(true)).toThrow(/git 저장소/);
  });

  it('git 저장소가 아니면 어떻게 하면 되는지(git init, 비밀 파일 제외)까지 알려 준다', () => {
    expect(() => WorkspaceState.of(null).assertReady(false)).toThrow(/git init/);
    expect(() => WorkspaceState.of(null).assertReady(false)).toThrow(/.gitignore/);
  });

  it('커밋하지 않은 변경이 있으면 시작하지 않는다', () => {
    expect(() => WorkspaceState.of(['src/a.ts']).assertReady(true)).toThrow(/src\/a\.ts/);
  });

  it('깨끗한 작업 트리면 시작한다', () => {
    expect(() => WorkspaceState.of([]).assertReady(true)).not.toThrow();
  });

  it('깨끗할 필요가 없으면 변경이 있어도 시작한다', () => {
    expect(() => WorkspaceState.of(['a']).assertReady(false)).not.toThrow();
  });
});

describe('WorkspaceState — 대화 세션에서 이어 일하기', () => {
  const carried = new Map([['src/a.ts', 'h1']]);

  it('세션 중 rauha가 남긴 파일은 그대로면 시작을 막지 않는다', () => {
    expect(() => WorkspaceState.of(['src/a.ts'], carried, new Map([['src/a.ts', 'h1']])).assertReady(true)).not.toThrow();
  });

  it('rauha가 남긴 파일을 직접 고쳤으면 알린다', () => {
    expect(() => WorkspaceState.of(['src/a.ts'], carried, new Map([['src/a.ts', 'h2']])).assertReady(true)).toThrow(/직접 고친/);
  });

  it('세션 전부터 있던 변경은 막는다', () => {
    const current = new Map([['src/a.ts', 'h1'], ['src/b.ts', 'x']]);
    expect(() => WorkspaceState.of(['src/a.ts', 'src/b.ts'], carried, current).assertReady(true)).toThrow(/src\/b\.ts/);
  });
});

describe('WorkspaceState — 사용자가 커밋하지 않은 변경 위에서 일하기', () => {
  it('시작 전에 사용자가 커밋하지 않은 파일을 돌려준다', () => {
    expect(WorkspaceState.of(['README.md', 'src/a.ts']).userFiles()).toEqual(['README.md', 'src/a.ts']);
  });

  it('세션에서 rauha가 남긴 파일은 사용자 파일이 아니다', () => {
    const carried = new Map([['src/a.ts', 'h1']]);
    expect(WorkspaceState.of(['src/a.ts', 'README.md'], carried, new Map([['src/a.ts', 'h1']])).userFiles()).toEqual(['README.md']);
  });

  it('git 저장소가 아니면 사용자 파일이 없다', () => {
    expect(WorkspaceState.of(null).userFiles()).toEqual([]);
  });

  it('rauha가 사용자가 고치던 파일을 또 바꿨으면 섞인 파일로 알린다', () => {
    expect(WorkspaceState.of(['README.md', 'src/a.ts']).mixedWith(['src/a.ts', 'src/b.ts'])).toEqual(['src/a.ts']);
  });

  it('사용자 파일을 건드리지 않았으면 섞인 파일이 없다', () => {
    expect(WorkspaceState.of(['README.md']).mixedWith(['src/b.ts'])).toEqual([]);
  });
});
