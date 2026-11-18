import { describe, expect, it } from 'vitest';
import { MEMBER_ROLES } from './member-role.js';
import { WORKSPACE_TOOL_NAMES, WorkspaceToolAccess, WorkspaceToolInput } from './workspace-tools.js';

describe('작업 공간 도구', () => {
  it('라우터·테스트·조사 팀원을 뺀 모든 팀원이 하는 일에 맞는 도구를 받는다', () => {
    const none = MEMBER_ROLES.filter((r) => !WorkspaceToolAccess.wants(r));
    expect(none).toEqual(['tester', 'router', 'surveyor']);
  });

  it('역할마다 하는 일에 필요한 도구만: 리뷰어는 코드 이력, 보안은 의존성, 마케팅은 회사가 정한 것', () => {
    expect(WorkspaceToolAccess.toolsFor('reviewer')).toEqual(['search_repos', 'file_history', 'show_commit', 'past_work']);
    expect(WorkspaceToolAccess.toolsFor('securitychecker')).toContain('dependencies');
    expect(WorkspaceToolAccess.toolsFor('marketer')).toContain('company_notes');
    expect(WorkspaceToolAccess.toolsFor('marketer')).not.toContain('ci_log');
    expect(WorkspaceToolAccess.toolsFor('answerer')).toEqual(WORKSPACE_TOOL_NAMES);
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
