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

/** 멈춘 일의 이유를 사람이 읽는 한국어로. 한국어 이유는 그대로, 알려진 영어 오류는 풀어 쓰고, 나머지는 원문을 괄호로 남긴다. */
export function stopReasonText(reason: string | null): string {
  const text = (reason ?? '').trim();
  if (text === '') return '이유를 알 수 없어요.';
  if (/[가-힣]/.test(text)) return text;
  if (/usage limit|rate[ _-]?limit|\b429\b|overloaded|quota/i.test(text)) return '사용 한도에 걸렸어요. 한도가 풀린 뒤에 다시 맡겨 주세요.';
  if (/\b401\b|\b403\b|authentication|unauthori[sz]ed|invalid x-api-key|not logged in|login/i.test(text)) return '로그인이 풀렸어요. 설정의 계정 칸에서 로그인한 뒤 다시 맡겨 주세요.';
  if (/ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|fetch failed|network|socket hang up/i.test(text)) return '네트워크 연결이 끊겼어요. 연결을 확인하고 다시 맡겨 주세요.';
  return `예상하지 못한 오류로 멈췄어요. (${text.length > 120 ? `${text.slice(0, 119)}…` : text})`;
}
