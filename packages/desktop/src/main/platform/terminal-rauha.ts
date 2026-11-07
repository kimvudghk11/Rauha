import { readFile, readdir, stat, unlink } from 'node:fs/promises';
import { delimiter, join } from 'node:path';

/** 터미널 rauha 실행 파일을 찾아볼 폴더들. 맥은 흔한 설치 폴더를 먼저, 그다음 PATH의 폴더를 본다. 겹치면 한 번만. */
export function candidateDirs(p: { platform: NodeJS.Platform; home: string; pathEnv: string; separator?: string }): string[] {
  const common = p.platform === 'darwin' ? [join(p.home, '.local', 'bin'), '/usr/local/bin', '/opt/homebrew/bin'] : [];
  const fromPath = p.pathEnv.split(p.separator ?? (p.platform === 'win32' ? ';' : delimiter)).filter((d) => d !== '');
  return [...new Set([...common, ...fromPath])];
}

/** 한 폴더에서 이름만 보고 후보로 삼을 파일. Windows는 `rauha setup`이 두는 세 가지다. */
export function candidateNames(platform: NodeJS.Platform): readonly string[] {
  return platform === 'win32' ? ['rauha.cmd', 'rauha.ps1', 'rauha'] : ['rauha'];
}

/**
 * `rauha setup`이 둔 파일인지 내용으로 판정한다: rauha 저장소의 packages/cli/dist/main.js를 부르는 것만.
 * 이름만 rauha인 다른 프로그램은 건드리지 않는다. 큰 파일(실행 파일 등)은 후보에서 뺀다.
 */
export function isTerminalRauha(content: string): boolean {
  return content.length < 4096 && /packages[\\/]+cli[\\/]+dist[\\/]+main\.js/.test(content);
}

export interface TerminalRauhaFile {
  readonly path: string;
  /** 어느 저장소의 dist/main.js를 부르는지(사용자에게 보여 주려고) */
  readonly entry: string;
}

/** 후보 폴더들에서 터미널 rauha 파일을 찾는다. 없는 폴더·못 읽는 파일은 건너뛴다. 아무것도 지우지 않는다. */
export async function findTerminalRauha(p: { platform: NodeJS.Platform; home: string; pathEnv: string; separator?: string }): Promise<TerminalRauhaFile[]> {
  const found: TerminalRauhaFile[] = [];
  for (const dir of candidateDirs(p)) {
    try {
      await readdir(dir);
    } catch {
      continue;
    }
    for (const name of candidateNames(p.platform)) {
      const path = join(dir, name);
      try {
        const info = await stat(path);
        if (!info.isFile() || info.size > 4096) continue;
        const content = await readFile(path, 'utf8');
        if (!isTerminalRauha(content)) continue;
        const m = /["']?([^"'\s]*packages[\\/]+cli[\\/]+dist[\\/]+main\.js)/.exec(content);
        found.push({ path, entry: m?.[1] ?? '' });
      } catch {
        /* 없거나 못 읽는 파일은 건너뛴다 */
      }
    }
  }
  return found;
}

/** 사용자가 확인한 파일만 지운다. 판정을 한 번 더 한다(그 사이 바뀐 파일을 지우지 않게). 지운 경로를 돌려준다. */
export async function removeTerminalRauha(files: readonly TerminalRauhaFile[]): Promise<string[]> {
  const removed: string[] = [];
  for (const f of files) {
    try {
      if (!isTerminalRauha(await readFile(f.path, 'utf8'))) continue;
      await unlink(f.path);
      removed.push(f.path);
    } catch {
      /* 이미 없거나 지울 수 없으면 건너뛴다 */
    }
  }
  return removed;
}
