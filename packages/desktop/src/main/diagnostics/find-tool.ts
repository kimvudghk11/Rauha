import { posix, win32 } from 'node:path';

/**
 * PATH에서 실행 파일 하나를 찾는다(which). `usable`이 파일 있음(맥은 실행 권한까지)을 알려 준다.
 * 윈도는 PATHEXT 확장자를 붙여 본다. 못 찾으면 null.
 */
export function findOnPath(name: string, pathEnv: string, platform: string, usable: (path: string) => boolean, env: Readonly<Record<string, string | undefined>>): string | null {
  const win = platform === 'win32';
  const path = win ? win32 : posix;
  const extensions = win ? (env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD').split(';').filter((e) => e !== '') : [''];
  for (const raw of pathEnv.split(win ? ';' : ':')) {
    const dir = raw.trim().replace(/^"(.*)"$/, '$1');
    if (dir === '') continue;
    for (const ext of extensions) {
      const candidate = path.join(dir, `${name}${ext}`);
      if (usable(candidate)) return candidate;
    }
  }
  return null;
}
