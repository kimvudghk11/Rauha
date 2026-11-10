import type { MemberRole } from '@rauha/core/jobs';
import type { RestoredEntry } from './chat-history.js';
import type { JobView } from './ipc.js';

/** 복원한 일을 화면이 그리는 모양으로. 단계·기록 줄은 저장하지 않으므로 비어 있다. */
export function restoredView(entry: RestoredEntry): JobView {
  return {
    id: entry.id,
    request: entry.request,
    status: entry.status,
    stopReason: entry.stopReason,
    queuedAt: entry.queuedAt,
    endedAt: entry.endedAt,
    role: null,
    roleName: null,
    cast: entry.cast.length === 0 ? ['intake'] : (entry.cast as readonly MemberRole[]),
    steps: [],
    lastLine: null,
    result: entry.result,
    canGoDeeper: false,
    knowledgeMissing: false,
    toolsLine: entry.toolsLine,
    notes: [],
  };
}
