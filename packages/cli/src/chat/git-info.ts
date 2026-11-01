import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/** 지금 브랜치 이름. git이 없거나 실패하면 null. */
export async function currentBranch(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await promisify(execFile)('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/** 저장소의 파일 목록(추적 중이거나 아직 추적하지 않지만 무시되지 않은 것). git이 없거나 실패하면 빈 목록. */
export async function listFiles(cwd: string): Promise<string[]> {
  try {
    const { stdout } = await promisify(execFile)('git', ['ls-files', '-co', '--exclude-standard'], { cwd, maxBuffer: 32 * 1024 * 1024 });
    return stdout.split(/\r?\n/).filter((l) => l !== '');
  } catch {
    return [];
  }
}
