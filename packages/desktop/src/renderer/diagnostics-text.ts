import type { DiagnosticsResult } from '../shared/ipc.js';

/** "진단 정보 복사" 결과를 사용자에게 보일 글 한 줄로 */
export function diagnosticsText(result: DiagnosticsResult | null): string {
  if (result === null) return 'Could not copy the diagnostics.';
  if (!result.ok) return result.error;
  if (!result.copied) return `Diagnostics created (${result.lines} lines). Not placed on the clipboard in this run.`;
  return `Diagnostics copied (${result.lines} lines). Paste them as they are when reporting a problem. Emails, home paths and keys are masked.`;
}
