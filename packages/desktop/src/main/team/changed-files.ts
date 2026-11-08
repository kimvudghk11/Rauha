import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** `git status --porcelain=v1 -z` 출력 → 경로별 상태("XY"). 이름이 바뀐 항목은 새 이름만 센다. */
export function parsePorcelainZ(out: string): Map<string, string> {
  const result = new Map<string, string>();
  const parts = out.split('\0');
  for (let i = 0; i < parts.length; i += 1) {
    const entry = parts[i]!;
    if (entry.length < 4) continue;
    const status = entry.slice(0, 2);
    result.set(entry.slice(3), status);
    if (status[0] === 'R' || status[0] === 'C') i += 1;
  }
  return result;
}

/** 일을 시작할 때와 끝났을 때를 견줘 새로 생기거나 상태가 달라진 파일만 돌려준다(원래부터 바뀌어 있던 것은 뺀다). */
export function newlyChanged(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): string[] {
  return [...after].filter(([path, status]) => before.get(path) !== status).map(([path]) => path);
}

/** 폴더의 바뀐 파일 목록. git이 없거나 레포가 아니면 null(모름). */
export async function snapshotChanges(cwd: string): Promise<Map<string, string> | null> {
  try {
    const { stdout } = await run('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd, maxBuffer: 16 * 1024 * 1024, windowsHide: true, timeout: 20_000 });
    return parsePorcelainZ(stdout);
  } catch {
    return null;
  }
}
