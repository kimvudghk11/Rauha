/**
 * 데스크톱 앱이 가져가는 좁은 입구(@rauha/core/jobs). SDK·sqlite 같은 무거운 의존성을 끌고 오지 않는다.
 */
export { Job, JOB_NOTE_LIMIT, type JobNote, type JobStatus } from './orchestration/domain/job.js';
export { DEFAULT_JOB_LIMIT, JobBoard } from './orchestration/domain/job-board.js';
export { JobRunner, type JobRunnerDeps, type JobReport, type JobWork } from './orchestration/application/job-runner.js';
export { MEMBER_ROLES, ROLE_INFO, type MemberRole, type RoleInfo } from './orchestration/domain/member-role.js';
export { type RuleBucket } from './orchestration/domain/rule-book.js';
