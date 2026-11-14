/**
 * 이어서 묻기: Main 말풍선에 답장하거나, 작업 상세에서 그 팀에 후속 질문을 하면
 * 같은 레포에서 새 작업을 만들고, 앞 요청·결과를 맥락으로 붙여 팀이 이어서 일하게 한다.
 */
export const FOLLOW_TEXT_MAX = 20_000;
export const FOLLOW_RESULT_MAX = 4_000;

/** 화면에서 받은 새 말: 다듬고, 비었거나 너무 길면 null */
export function followUpText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  return t === '' || t.length > FOLLOW_TEXT_MAX ? null : t;
}

/** 팀에 넘길 글: 앞 작업(요청·결과) 맥락 + 새 말 */
export function followUpPrompt(parent: { readonly request: string; readonly result: string | null }, text: string): string {
  const result = parent.result === null || parent.result.trim() === '' ? '(no result — that task was stopped or gave no answer)' : parent.result.length > FOLLOW_RESULT_MAX ? `${parent.result.slice(0, FOLLOW_RESULT_MAX)}\n(cut)` : parent.result;
  return [
    'This continues an earlier task in the same repo. Keep what was already done and build on it.',
    '',
    `Earlier request:\n${parent.request}`,
    '',
    `What the team reported back:\n${result}`,
    '',
    `Now the user says:\n${text}`,
  ].join('\n');
}
