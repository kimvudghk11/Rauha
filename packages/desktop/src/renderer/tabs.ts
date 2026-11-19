export type TabId = 'chat' | 'code' | 'todo' | 'api' | 'docker' | 'db' | 'records' | 'git' | 'commands' | 'rules' | 'extensions' | 'interview' | 'settings';

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
  tab('chat', 'Chat', 'M4 5h16v11H9l-5 4z', true),
  tab('code', 'Repo', 'M3 7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M10 11l-2 2 2 2 M14 11l2 2-2 2', true),
  tab('todo', 'Todo', 'M4 4h16v16H4z M8 12l3 3 5-6', true),
  // API 탭은 뺐다(2026-11-17): API 시험은 팀이 API 를 만들면 rauha 가 알아서 한다(main/api/auto-api-check.ts). 코드는 내부 기능으로 남긴다
  tab('docker', 'Docker', 'M3 7l9-4 9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10', true),
  tab('db', 'DB', 'M5 6c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3z M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6 M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3', true),
  tab('records', 'Records', 'M5 4h11l3 3v13H5z M9 10h6 M9 14h6', true),
  tab('git', 'Git', 'M6 4a2 2 0 1 0 0 4a2 2 0 1 0 0-4 M6 16a2 2 0 1 0 0 4a2 2 0 1 0 0-4 M18 8a2 2 0 1 0 0 4a2 2 0 1 0 0-4 M6 8v8 M18 12c0 3-5 3-12 4', true),
  tab('commands', 'Slash', 'M5 7l5 5-5 5 M12 17h7', true),
  tab('rules', 'Rules', 'M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z M9 12l2 2 4-4', true),
  // 커넥터·MCP·플러그인·스킬(설정에서 따로 뺐다)
  tab('extensions', 'Extensions', 'M9 4h6v3a2 2 0 1 0 0 4h3v6h-3a2 2 0 1 0-4 0H6v-6h3a2 2 0 1 0 0-4z', true),
  tab('interview', 'Interview', 'M4 6h11v8H8l-4 3z M15 9h5v8l-3-2h-6v-1', true),
  tab('settings', 'Settings', 'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6 M12 3v3 M12 18v3 M3 12h3 M18 12h3 M5.6 5.6l2.1 2.1 M16.3 16.3l2.1 2.1 M5.6 18.4l2.1-2.1 M16.3 7.7l2.1-2.1', true, true),
];

/** 예전에 저장된 탭 이름(레포 탭은 코드 탭에 합쳐졌다)을 지금 이름으로. 모르는 이름이면 null. */
export function resolveTab(id: string): TabId | null {
  const name = id === 'repos' ? 'code' : id;
  return TABS.find((t) => t.id === name)?.id ?? null;
}

/** 명령이 가리키는 곳("settings#team" = 설정 탭의 팀 설정 칸). 칸이 없으면 탭만, 모르는 탭이면 null */
export function resolveTarget(target: string): { readonly tab: TabId; readonly section: string | null } | null {
  const at = target.indexOf('#');
  const tab = resolveTab(at < 0 ? target : target.slice(0, at));
  if (tab === null) return null;
  const section = at < 0 ? '' : target.slice(at + 1);
  return { tab, section: section === '' ? null : section };
}
