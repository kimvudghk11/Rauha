/** 단축키 안내창에 보일 내용. 앱이 실제로 듣는 키만 적는다(코드: renderer/app.ts · code-view.ts · chat-view.ts · bug-shortcut.ts). */
export interface ShortcutRow {
  readonly keys: string;
  readonly label: string;
}
export interface ShortcutGroup {
  readonly title: string;
  readonly rows: readonly ShortcutRow[];
}

/** 왼쪽 막대 순서(위에서 아래, 설정이 맨 아래)의 탭 이름. 숫자 키는 열 개(1~9, 0)까지라 열한째 탭(Settings)은 Ctrl+, 로 적는다.
 * renderer/tabs.ts 의 TABS 와 같아야 하며 spec 이 확인한다. */
export const TAB_LABELS: readonly string[] = ['Chat', 'Repo', 'Todo', 'API', 'Docker', 'DB', 'Records', 'Git', 'Slash', 'Rules', 'Settings'];

export function shortcutSheet(platform: string): readonly ShortcutGroup[] {
  const mac = platform === 'darwin';
  const mod = mac ? '⌘' : 'Ctrl+';
  const shift = mac ? '⇧' : 'Shift+';
  return [
    { title: 'Switch tab', rows: TAB_LABELS.map((label, i) => ({ keys: i < 10 ? `${mod}${(i + 1) % 10}` : `${mod},`, label })) },
    {
      title: 'Anywhere',
      rows: [
        { keys: `${mod}${shift}B`, label: 'Write a report' },
        { keys: `${mod}${shift}/`, label: 'Show this list' },
      ],
    },
    {
      title: 'Repo tab',
      rows: [
        { keys: `${mod}P`, label: 'Open a file by name' },
        { keys: `${mod}${shift}F`, label: 'Search the work folder' },
        { keys: `${mod}F`, label: 'Find in the file' },
        { keys: 'F12', label: `Go to definition (also ${mod}click)` },
        { keys: `${shift}F12`, label: 'Find all references' },
        { keys: `${mod}${shift}M`, label: 'Show or hide Problems' },
        { keys: `${mod}${shift}E`, label: 'Send the selected code to chat' },
        { keys: `${mod}S`, label: 'Save' },
        { keys: `${mod}\``, label: 'Show or hide the terminal' },
        { keys: `${mod}${shift}\``, label: 'New terminal' },
        { keys: 'F2', label: 'Rename the selected item' },
      ],
    },
    {
      title: 'Terminal (when it has focus)',
      rows: [
        { keys: `${mod}F`, label: 'Find in the terminal' },
        { keys: mac ? '⌘C' : `${mod}${shift}C`, label: 'Copy the selection' },
        { keys: `${mod}V`, label: 'Paste' },
        { keys: `${mod}click`, label: 'Open a link or a file path' },
      ],
    },
    {
      title: 'Chat',
      rows: [
        { keys: 'Enter', label: 'Send' },
        { keys: `${shift}Enter`, label: 'New line' },
        { keys: '/', label: 'Pick a command' },
      ],
    },
  ];
}
