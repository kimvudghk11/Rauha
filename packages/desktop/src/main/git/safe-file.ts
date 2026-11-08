import { lstat } from 'node:fs/promises';
import { GitFailure } from './git-run.js';

/**
 * 레포 안 파일을 앱이 직접 읽고 쓰기 전에 확인한다. 심볼릭 링크는 레포 밖(비밀 파일 등)을 가리킬 수 있어 따라가지 않는다.
 * 파일이 아직 없으면(새로 쓰는 경우) 통과한다.
 */
export async function assertPlainFile(path: string): Promise<void> {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  if (info.isSymbolicLink()) throw new GitFailure('BLOCKED', '링크 파일은 앱에서 직접 열거나 고치지 않아요. 터미널에서 풀어 주세요.');
}
