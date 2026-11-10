const normalize = (root: string) => root.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const MAX_ROOT_LENGTH = 1024;

/** 화면이 보낸 "대화 초기화" 요청의 경계: 검증하고 어떤 레포를 비울지 정한다 */
export class ConversationResetDto {
  private constructor(private readonly root: string | null) {}

  /** { root: 글자 | null }. null은 작업 폴더의 레포 전부 */
  static from(input: unknown): ConversationResetDto {
    if (typeof input !== 'object' || input === null || !('root' in input)) throw new Error('The reset request is malformed.');
    const root = (input as { root: unknown }).root;
    if (root === null) return new ConversationResetDto(null);
    if (typeof root !== 'string' || root.trim() === '' || root.length > MAX_ROOT_LENGTH) throw new Error('The repo path to reset is not valid.');
    return new ConversationResetDto(root);
  }

  /** 앱이 아는 레포(known) 가운데 비울 것 */
  targets(known: readonly string[]): string[] {
    if (this.root === null) return [...known];
    const wanted = normalize(this.root);
    return known.filter((k) => normalize(k) === wanted);
  }
}

/** 화면에 돌려주는 결과 */
export type ConversationResetResult = { readonly ok: true; readonly cleared: number } | { readonly ok: false; readonly error: string };

/**
 * 확인 대화상자 글(화면 글은 영어). 단추는 작업 폴더의 레포 전부를 한 번에 비운다(레포 하나만 비우는 단추는 없다).
 * 저장된 채팅 말풍선도 함께 비워지므로 다시 켜도 돌아오지 않는다.
 */
export const RESET_CONFIRM = {
  title: 'Reset the chat for this work folder?',
  body: 'The earlier conversation of every repo in this work folder, the carried-over file list and the saved chat bubbles are removed. This cannot be undone. Memory, learned notes and your files stay.',
  okLabel: 'Reset chat',
} as const;

/** 끝난 뒤 짧은 안내 글 */
export function resetNotice(result: ConversationResetResult): string {
  if (!result.ok) return result.error;
  return result.cleared === 0 ? 'No repo with a conversation was found.' : 'Chat cleared. The next task starts a new conversation.';
}
