/** 키 이벤트에서 판단에 쓰는 사실만 */
export interface KeyFacts {
  readonly key: string;
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

/**
 * - copy: 선택한 글을 클립보드에 복사한다
 * - paste: xterm이 가로채지 않고 브라우저 기본 붙여넣기로 보낸다
 * - find: 터미널 찾기 줄을 연다
 * - toggle / new: 터미널 칸을 보이거나 접는다 / 새 터미널을 연다
 * - app: 셸로 보내지 않고 앱의 전체 단축키가 받게 둔다(xterm은 건드리지 않는다)
 * - null: 평소처럼 xterm이 셸로 보낸다
 */
export type TermKeyAction = 'copy' | 'paste' | 'find' | 'toggle' | 'new' | 'app' | null;

/**
 * 터미널 칸에 포커스가 있을 때 키를 어떻게 다룰지. 앱의 주 단축키(Ctrl/Cmd)는 맥에서 Cmd, 그 밖에서 Ctrl이다.
 * 맥에서는 Ctrl 조합이 모두 셸 것이고, Windows·리눅스에서 Ctrl+C는 선택이 있을 때만 복사(없으면 중단 신호)다.
 */
export function termKeyAction(e: KeyFacts, platform: string, hasSelection: boolean): TermKeyAction {
  const mac = platform === 'darwin';
  const mod = mac ? e.metaKey : e.ctrlKey;
  if (!mod || e.altKey) return null;
  const k = e.key.toLowerCase();
  if (k === 'c') return mac || e.shiftKey || hasSelection ? 'copy' : null;
  if (k === 'v') return 'paste';
  if (k === 'f' && !e.shiftKey) return 'find';
  if (e.code === 'Backquote') return e.shiftKey ? 'new' : 'toggle';
  if (/^[0-9]$/.test(e.key) || e.code === 'Comma' || (e.shiftKey && (e.code === 'Slash' || k === 'b'))) return 'app';
  return null;
}
