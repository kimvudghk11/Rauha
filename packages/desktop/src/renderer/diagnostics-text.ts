import type { DiagnosticsResult } from '../shared/ipc.js';

/** "진단 정보 복사" 결과를 사용자에게 보일 글 한 줄로 */
export function diagnosticsText(result: DiagnosticsResult | null): string {
  if (result === null) return '진단 정보를 복사하지 못했어요.';
  if (!result.ok) return result.error;
  if (!result.copied) return `진단 정보를 만들었어요(${result.lines}줄). 이 실행에서는 클립보드에 넣지 않았어요.`;
  return `진단 정보를 복사했어요(${result.lines}줄). 문제를 알릴 때 그대로 붙여 넣어 주세요. 이메일·홈 경로·키는 가려져 있어요.`;
}
