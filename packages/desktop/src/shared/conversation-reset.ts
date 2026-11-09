const normalize = (root: string) => root.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const MAX_ROOT_LENGTH = 1024;

/** 화면이 보낸 "대화 초기화" 요청의 경계: 검증하고 어떤 레포를 비울지 정한다 */
export class ConversationResetDto {
  private constructor(private readonly root: string | null) {}

  /** { root: 글자 | null }. null은 작업 폴더의 레포 전부 */
  static from(input: unknown): ConversationResetDto {
    if (typeof input !== 'object' || input === null || !('root' in input)) throw new Error('대화 초기화 요청 모양이 올바르지 않아요.');
    const root = (input as { root: unknown }).root;
    if (root === null) return new ConversationResetDto(null);
    if (typeof root !== 'string' || root.trim() === '' || root.length > MAX_ROOT_LENGTH) throw new Error('초기화할 레포 경로가 올바르지 않아요.');
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

/** 확인 대화상자 글: 되돌릴 수 없고 기억은 남는다는 것을 한 문장으로 */
export const RESET_CONFIRM = {
  title: '이 작업 폴더의 앞 대화를 비울까요?',
  body: '앞 대화와 이어 일할 파일 목록이 지워지고 되돌릴 수 없어요. 기억과 배운 내용, 내 파일은 그대로예요.',
  okLabel: '대화 초기화',
} as const;

/** 끝난 뒤 짧은 안내 글 */
export function resetNotice(result: ConversationResetResult): string {
  if (!result.ok) return result.error;
  return result.cleared === 0 ? '비울 대화가 있는 레포를 찾지 못했어요.' : '앞 대화를 비웠어요. 다음 일부터 새 대화로 시작해요.';
}
