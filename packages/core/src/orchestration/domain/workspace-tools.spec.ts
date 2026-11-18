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

  it('경로는 저장소 안의 상대 경로만(.. 이나 절대 경로는 안 된다)', () => {
    expect(WorkspaceToolInput.path('.\\src\\a.ts')).toBe('src/a.ts');
    for (const bad of ['../x', 'C:/x', '/etc/passwd', '', 'a/../../b']) expect(() => WorkspaceToolInput.path(bad)).toThrow('relative');
  });

  it('커밋·glob 은 - 로 시작할 수 없다(git 옵션으로 읽히지 않게)', () => {
    expect(WorkspaceToolInput.revision('a1b2c3d')).toBe('a1b2c3d');
    expect(WorkspaceToolInput.revision('v1.2.0')).toBe('v1.2.0');
    expect(() => WorkspaceToolInput.revision('--output=x')).toThrow('commit must be');
    expect(WorkspaceToolInput.glob('*.ts')).toBe('*.ts');
    expect(() => WorkspaceToolInput.glob('--no-index')).toThrow('glob must be');
  });

  it('찾을 글은 1~200자, 실행 번호는 양의 정수', () => {
    expect(() => WorkspaceToolInput.pattern('')).toThrow('pattern must be');
    expect(WorkspaceToolInput.runId(12)).toBe(12);
    expect(() => WorkspaceToolInput.runId('12')).toThrow('run_id');
  });

  it('저장소 이름은 글 목록이고, 없으면 모든 저장소', () => {
    expect(WorkspaceToolInput.names(['a', 'b'])).toEqual(['a', 'b']);
    expect(WorkspaceToolInput.names(undefined)).toEqual([]);
    expect(() => WorkspaceToolInput.names('a')).toThrow('repos must be a list');
  });
});
