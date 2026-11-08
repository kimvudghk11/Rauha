export type TabId = 'chat' | 'code' | 'todo' | 'records' | 'git' | 'commands' | 'rules' | 'settings';

export interface Tab {
  readonly id: TabId;
  readonly label: string;
  /** 지금 열리는 탭. 아니면 "곧" 화면을 보인다. */
  readonly ready: boolean;
  /** 왼쪽 막대 맨 아래에 둔다 */
  readonly bottom: boolean;
  /** 24×24 SVG path */
  readonly icon: string;
}

const tab = (id: TabId, label: string, icon: string, ready = false, bottom = false): Tab => ({ id, label, ready, bottom, icon });

export const TABS: readonly Tab[] = [
  tab('chat', '채팅', 'M4 5h16v11H9l-5 4z', true),
  tab('code', '코드', 'M6 3h8l4 4v14H6z M10 13l-2 2 2 2 M14 13l2 2-2 2', true),
  tab('todo', '할 일', 'M4 4h16v16H4z M8 12l3 3 5-6', true),
  tab('records', '기록', 'M5 4h11l3 3v13H5z M9 10h6 M9 14h6', true),
  tab('git', 'git', 'M6 4a2 2 0 1 0 0 4a2 2 0 1 0 0-4 M6 16a2 2 0 1 0 0 4a2 2 0 1 0 0-4 M18 8a2 2 0 1 0 0 4a2 2 0 1 0 0-4 M6 8v8 M18 12c0 3-5 3-12 4', true),
  tab('commands', '명령어', 'M5 7l5 5-5 5 M12 17h7', true),
  tab('rules', '규칙', 'M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z M9 12l2 2 4-4', true),
  tab('settings', '설정', 'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6 M12 3v3 M12 18v3 M3 12h3 M18 12h3 M5.6 5.6l2.1 2.1 M16.3 16.3l2.1 2.1 M5.6 18.4l2.1-2.1 M16.3 7.7l2.1-2.1', true, true),
];

/** 예전에 저장된 탭 이름(레포 탭은 코드 탭에 합쳐졌다)을 지금 이름으로. 모르는 이름이면 null. */
export function resolveTab(id: string): TabId | null {
  const name = id === 'repos' ? 'code' : id;
  return TABS.find((t) => t.id === name)?.id ?? null;
}
