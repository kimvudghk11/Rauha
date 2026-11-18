import { describe, expect, it } from 'vitest';
import { WorkspaceToolAccess, WorkspaceToolInput } from './workspace-tools.js';

describe('작업 공간 도구', () => {
  it('답변·문서·디버깅·기획 팀원은 받고, 라우터·테스트·구현 팀원은 받지 않는다', () => {
    for (const r of ['answerer', 'writer', 'debugger', 'planner'] as const) expect(WorkspaceToolAccess.wants(r)).toBe(true);
    for (const r of ['router', 'tester', 'implementer'] as const) expect(WorkspaceToolAccess.wants(r)).toBe(false);
  });

  it('since 는 YYYY-MM-DD 이거나 비어 있어야 한다', () => {
    expect(WorkspaceToolInput.since('2026-11-01')).toBe('2026-11-01');
    expect(WorkspaceToolInput.since(undefined)).toBeNull();
    expect(() => WorkspaceToolInput.since('어제')).toThrow('since must be a date');
  });

  it('저장소 이름은 글 목록이고, 없으면 모든 저장소', () => {
    expect(WorkspaceToolInput.names(['a', 'b'])).toEqual(['a', 'b']);
    expect(WorkspaceToolInput.names(undefined)).toEqual([]);
    expect(() => WorkspaceToolInput.names('a')).toThrow('repos must be a list');
  });
});
