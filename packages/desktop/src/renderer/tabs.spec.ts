import { describe, expect, it } from 'vitest';
import { resolveTab, TABS } from './tabs.js';

describe('TABS', () => {
  it('탭 순서는 Chat·Repo·Todo·Records·Git·Slash·Rules이고 (레포 탭은 Repo 탭에 합쳐졌다) Settings는 맨 아래다', () => {
    expect(TABS.filter((t) => !t.bottom).map((t) => t.label)).toEqual(['Chat', 'Repo', 'Todo', 'Records', 'Git', 'Slash', 'Rules']);
    expect(TABS.filter((t) => t.bottom).map((t) => t.label)).toEqual(['Settings']);
  });

  it('모든 탭이 열린다(곧 표시 없음)', () => {
    expect(TABS.filter((t) => t.ready).map((t) => t.id)).toEqual(['chat', 'code', 'todo', 'records', 'git', 'commands', 'rules', 'settings']);
  });

  it('저장돼 있던 레포 탭은 코드 탭으로 넘기고 모르는 이름은 null이다', () => {
    expect(resolveTab('repos')).toBe('code');
    expect(resolveTab('git')).toBe('git');
    expect(resolveTab('nope')).toBeNull();
  });
});
