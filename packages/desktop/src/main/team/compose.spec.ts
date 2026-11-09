import { describe, expect, it } from 'vitest';
import { scopeDeps } from './compose.js';

const a = { name: 'api', root: 'C:/w/api' };
const b = { name: 'web', root: 'C:/w/web' };

describe('scopeDeps', () => {
  it('레포가 둘 이상이면 작업 공간 루트와 레포 목록을 팀에 알린다', () => {
    expect(scopeDeps({ workspaceRoot: 'C:/w', repos: [a, b], also: [] }).folder).toEqual({ root: 'C:/w', repos: [a, b] });
  });

  it('레포가 하나뿐이면 작업 공간 정보를 넘기지 않는다', () => {
    expect(scopeDeps({ workspaceRoot: 'C:/w', repos: [a], also: [] }).folder).toBeUndefined();
  });

  it('요청이 가리킨 다른 레포는 고칠 수 없는 읽기 전용으로 넘긴다', () => {
    const { also } = scopeDeps({ workspaceRoot: 'C:/w', repos: [a, b], also: [b] });
    expect(also.map(({ name, root, knowledge }) => ({ name, root, knowledge }))).toEqual([{ name: 'web', root: 'C:/w/web', knowledge: null }]);
    expect(also[0]!.work).toBeUndefined();
  });

  it('다른 레포의 근거 파일은 그 레포 안에서만 읽는 함수를 함께 넘긴다', () => {
    const { also } = scopeDeps({ workspaceRoot: 'C:/w', repos: [a, b], also: [b] });
    expect(typeof also[0]!.read).toBe('function');
  });
});
