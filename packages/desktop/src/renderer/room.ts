import type { JobView } from '../shared/ipc.js';
import type { CharacterState } from './characters.js';

/** 생각하는 쪽 역할(조사·설계·점검)은 물음표·전구, 손을 쓰는 역할은 타자 말풍선 */
const THINKING = new Set(['router', 'surveyor', 'designer', 'planner', 'debugger', 'riskchecker', 'securitychecker', 'chief', 'intake']);

/** 작업 상태 → 방의 캐릭터가 보일 움직임 */
export function characterStateOf(job: Pick<JobView, 'status' | 'role'>): CharacterState {
  switch (job.status) {
    case 'queued':
      return 'rest';
    case 'waiting':
      return 'wait';
    case 'done':
      return 'done';
    case 'stopped':
      return 'stuck';
    case 'running':
      return job.role !== null && THINKING.has(job.role) ? 'think' : 'work';
  }
}

/** 걸린 시간 글. 1분 미만은 초만, 그 이상은 "4분 12초", 1시간 넘으면 "1시간 5분". */
export function elapsedText(startIso: string, endIso: string | null, nowMs: number): string {
  const end = endIso === null ? nowMs : Date.parse(endIso);
  const sec = Math.max(0, Math.floor((end - Date.parse(startIso)) / 1000));
  if (sec < 60) return `${sec}초`;
  if (sec < 3600) return `${Math.floor(sec / 60)}분 ${String(sec % 60).padStart(2, '0')}초`;
  return `${Math.floor(sec / 3600)}시간 ${Math.floor((sec % 3600) / 60)}분`;
}
