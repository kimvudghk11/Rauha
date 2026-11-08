import type { JobView } from '../../shared/ipc.js';
import type { RecordInput } from '../../shared/record-book.js';
import type { Trail } from './job-trail.js';

/**
 * 끝난 작업(화면용 JobView)과 작업 중 모아 둔 것(Trail)을 기록 입력으로 모은다. 끝나지 않은 작업이면 null.
 * 비밀 가리기·길이 줄이기는 여기가 아니라 RecordEntry가 한다(여기서는 있는 그대로 모아 건넨다).
 */
export function recordInputOf(job: JobView, trail: Trail, now: string): RecordInput | null {
  if (job.status !== 'done' && job.status !== 'stopped') return null;
  const roles: string[] = [];
  for (const note of job.notes) if (note.roleName !== null && !roles.includes(note.roleName)) roles.push(note.roleName);
  return {
    id: job.id,
    request: job.request,
    result: job.result,
    status: job.status,
    stopReason: job.stopReason,
    roles,
    stages: job.steps.map((s) => s.label),
    queuedAt: job.queuedAt,
    endedAt: job.endedAt ?? now,
    repo: trail.repo,
    files: trail.files ?? [],
    approvals: trail.approvals,
    direction: null,
  };
}
