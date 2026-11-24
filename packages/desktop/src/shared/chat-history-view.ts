import { ROLE_INFO, type MemberRole } from '@rauha/core/jobs';
import type { RestoredEntry } from './chat-history.js';
import type { JobView } from './ipc.js';

/** 복원한 일을 화면이 그리는 모양으로. 단계·작업 로그 줄은 저장하지 않고, 팀 대화(팀원 말)만 다시 그린다. */
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
    notes: (entry.talk ?? []).map((t) => ({ role: t.role as MemberRole, roleName: ROLE_INFO[t.role as MemberRole].name, message: t.message, at: entry.queuedAt })),
    thread: entry.thread,
    inTask: entry.inTask,
  };
}
