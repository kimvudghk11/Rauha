/** 채팅 화면의 작은 규칙들(순수 함수). 화면은 이 값을 그리기만 한다. */

const COMPOSER_MIN = 40;
const COMPOSER_MAX = 160;

/** 입력칸 높이: 내용 높이만큼 늘어나되 기본(한 줄)보다 작지 않고 최대를 넘지 않는다. */
export function composerHeight(contentHeight: number, min = COMPOSER_MIN, max = COMPOSER_MAX): number {
  return Math.min(max, Math.max(min, Math.ceil(contentHeight)));
}

/** 「다르게 해 줘」는 어떻게 바꿀지 적었을 때만 누를 수 있다(빈 글로 보내면 팀원이 뭘 바꿀지 모른다). */
export function canRevise(note: string): boolean {
  return note.trim() !== '';
}

/** 결과 말풍선의 이름표: 여러 일이 쌓였을 때 어느 요청에 대한 답인지 알 수 있게 요청 앞부분을 붙인다. */
export function replyWho(lead: string, request: string, max = 24): string {
  const flat = request.replace(/\s+/g, ' ').trim();
  const shown = flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
  return `${lead} · "${shown}"`;
}
