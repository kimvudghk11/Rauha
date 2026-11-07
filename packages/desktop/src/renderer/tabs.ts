export type TabId = 'chat' | 'code' | 'todo' | 'records' | 'repos' | 'commands' | 'rules' | 'settings';

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
  tab('code', '코드', 'M6 3h8l4 4v14H6z M10 13l-2 2 2 2 M14 13l2 2-2 2'),
  tab('todo', '할 일', 'M4 4h16v16H4z M8 12l3 3 5-6'),
  tab('records', '기록', 'M5 4h11l3 3v13H5z M9 10h6 M9 14h6'),
  tab('repos', '레포', 'M7 4a2 2 0 1 0 0 4a2 2 0 1 0 0-4 M7 16a2 2 0 1 0 0 4a2 2 0 1 0 0-4 M17 7a2 2 0 1 0 0 4a2 2 0 1 0 0-4 M7 8v8 M17 11c0 4-6 3-10 5'),
  tab('commands', '명령어', 'M5 7l5 5-5 5 M12 17h7'),
  tab('rules', '규칙', 'M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z M9 12l2 2 4-4'),
  tab('settings', '설정', 'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6 M12 3v3 M12 18v3 M3 12h3 M18 12h3 M5.6 5.6l2.1 2.1 M16.3 16.3l2.1 2.1 M5.6 18.4l2.1-2.1 M16.3 7.7l2.1-2.1', false, true),
];
