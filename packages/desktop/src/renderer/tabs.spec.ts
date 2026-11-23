import { describe, expect, it } from 'vitest';
import { resolveTab, resolveTarget, TABS } from './tabs.js';

describe('TABS', () => {
  it('탭 순서는 Chat·Repo·Todo·Docker·DB·AWS·Records·Git·Slash·Rules이고 (레포 탭은 Repo 탭에 합쳐졌고, API 탭은 자동 API 점검으로 바뀌어 없다) Settings는 맨 아래다', () => {
    expect(TABS.filter((t) => !t.bottom).map((t) => t.label)).toEqual(['Chat', 'Repo', 'Todo', 'Docker', 'DB', 'AWS', 'Records', 'Git', 'Slash', 'Rules', 'Extensions', 'Interview']);
    expect(TABS.filter((t) => t.bottom).map((t) => t.label)).toEqual(['Settings']);
  });

  it('모든 탭이 열린다(곧 표시 없음)', () => {
    expect(TABS.filter((t) => t.ready).map((t) => t.id)).toEqual(['chat', 'code', 'todo', 'docker', 'db', 'aws', 'records', 'git', 'commands', 'rules', 'extensions', 'interview', 'settings']);
  });

  it('저장돼 있던 레포 탭은 코드 탭으로 넘기고 모르는 이름은 null이다', () => {
    expect(resolveTab('repos')).toBe('code');
    expect(resolveTab('git')).toBe('git');
    expect(resolveTab('nope')).toBeNull();
    // 마지막으로 API 탭을 열어 두었어도 없는 탭이라 null(기본 탭으로 연다)
    expect(resolveTab('api')).toBeNull();
  });
});

describe('resolveTarget', () => {
  it('"탭#칸"은 그 탭을 열고 그 칸으로 간다', () => {
    expect(resolveTarget('settings#team')).toEqual({ tab: 'settings', section: 'team' });
  });

  it('칸이 없으면 탭만, 모르는 탭이면 null 이다', () => {
    expect(resolveTarget('repos')).toEqual({ tab: 'code', section: null });
    expect(resolveTarget('nope#team')).toBeNull();
  });
});
