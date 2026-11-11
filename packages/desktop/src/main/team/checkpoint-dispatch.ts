import { CHECKPOINT_FUNCTIONS, type CheckpointFn, type CheckpointReply } from '../../shared/checkpoint-api.js';
import { RepoPath } from '../../shared/git-guard.js';
import type { CheckpointKeeper } from './checkpoint-keeper.js';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const MAX_PATHS = 500;

function jobIdOf(arg: Record<string, unknown>): string {
  const id = arg['jobId'];
  if (typeof id !== 'string' || id === '' || id.length > 200 || /[\u0000-\u001f]/.test(id)) throw new Error('The job id is not valid.');
  return id;
}

function pathsOf(arg: Record<string, unknown>): string[] | undefined {
  const raw = arg['paths'];
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_PATHS || raw.some((p) => typeof p !== 'string')) throw new Error('The file list is not valid.');
  return (raw as string[]).map((p) => RepoPath.parse(p).value);
}

/**
 * 화면 IPC → 체크포인트 서비스. 화면이 보낸 값은 여기서 모두 검사한다(작업 id·파일 경로). 레포 폴더는 화면이 정하지 않고 저장된 기록이 정한다.
 * 어떤 실패든 이유를 글로 돌려준다(던지지 않는다).
 */
export async function dispatchCheckpoint(keeper: CheckpointKeeper, fn: unknown, arg: unknown): Promise<CheckpointReply> {
  try {
    if (typeof fn !== 'string' || !(CHECKPOINT_FUNCTIONS as readonly string[]).includes(fn)) throw new Error('That action is not available.');
    if (!isObject(arg)) throw new Error('The request is not valid.');
    const jobId = jobIdOf(arg);
    switch (fn as CheckpointFn) {
      case 'changes':
        return { ok: true, data: await keeper.changes(jobId) };
      case 'diff': {
        if (typeof arg['path'] !== 'string') throw new Error('The file path is not valid.');
        return { ok: true, data: await keeper.diff(jobId, arg['path']) };
      }
      case 'preview':
        return { ok: true, data: await keeper.preview(jobId, pathsOf(arg)) };
      case 'revert':
        return { ok: true, data: await keeper.revert(jobId, pathsOf(arg)) };
      case 'undoRevert':
        return { ok: true, data: await keeper.undoRevert(jobId) };
      case 'discardBranch':
        return { ok: true, data: await keeper.discardBranch(jobId) };
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Something went wrong.' };
  }
}
