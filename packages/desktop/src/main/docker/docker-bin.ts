import { accessSync, constants, statSync } from 'node:fs';
import { posix, win32 } from 'node:path';

const isRealFile = (path: string, platform: NodeJS.Platform): boolean => {
  try {
    if (!statSync(path).isFile()) return false;
    if (platform !== 'win32') accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/**
 * PATH 에서 실행 파일을 직접 찾는다. 절대 경로인 PATH 칸만 보고, 빈 칸·`.`·상대 경로는 건너뛴다.
 * 윈도우는 현재 폴더부터 찾기 때문에, docker 를 작업 폴더(cwd)에서 돌릴 때 그 폴더에 심어 둔 docker.exe 가 실행될 수 있다. 그 길을 막으려고
 * 부르기 전에 절대 경로로 정해 둔다. 윈도우는 .exe·.com 만 고른다(.cmd·.bat 스크립트는 셸을 거쳐야 해서 고르지 않는다).
 */
export function findOnPath(name: string, pathEnv: string, platform: NodeJS.Platform, isFile: (path: string) => boolean = (p) => isRealFile(p, platform)): string | null {
  const win = platform === 'win32';
  const p = win ? win32 : posix;
  const names = win ? [`${name}.exe`, `${name}.com`] : [name];
  for (const raw of pathEnv.split(win ? ';' : ':')) {
    const entry = raw.trim().replace(/^"|"$/g, '');
    if (entry === '' || !p.isAbsolute(entry)) continue;
    for (const n of names) {
      const full = p.join(entry, n);
      if (isFile(full)) return full;
    }
  }
  return null;
}
