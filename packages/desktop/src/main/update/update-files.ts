import { accessSync, constants } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AttemptStore } from './update-service.js';
import type { AttemptWriter } from './installer.js';

/**
 * 설치 시도의 흔적을 파일 둘로 둔다: 시도 기록(앱이 설치 전에 씀)과 결과 글(설치 스크립트가 끝에 씀).
 * 다시 켜진 앱이 둘을 읽어 알린 뒤 지운다. 로그 파일은 지우지 않는다.
 */
export class FileAttemptStore implements AttemptStore, AttemptWriter {
  constructor(
    private readonly attemptFile: string,
    private readonly resultFile: string,
  ) {}

  async begin(record: { from: string; to: string; target: string | null; at: string; log: string }): Promise<void> {
    await mkdir(dirname(this.attemptFile), { recursive: true });
    await rm(this.resultFile, { force: true });
    await writeFile(this.attemptFile, JSON.stringify(record, null, 2), 'utf8');
  }

  async read(): Promise<{ record: unknown; result: string | null }> {
    let record: unknown = null;
    try {
      record = JSON.parse(await readFile(this.attemptFile, 'utf8'));
    } catch {
      return { record: null, result: null };
    }
    const result = await readFile(this.resultFile, 'utf8').catch(() => null);
    return { record, result };
  }

  async clear(): Promise<void> {
    await rm(this.attemptFile, { force: true });
    await rm(this.resultFile, { force: true });
  }
}

/** 이 폴더에 쓸 수 있는지. 폴더가 아직 없으면 있는 가장 가까운 윗 폴더를 본다(스크립트가 mkdir -p로 만든다). */
export function canWriteDir(dir: string): boolean {
  let at = dir;
  for (;;) {
    try {
      accessSync(at, constants.W_OK);
      return true;
    } catch (e) {
      if ((e as { code?: string }).code !== 'ENOENT') return false;
      const up = dirname(at);
      if (up === at) return false;
      at = up;
    }
  }
}
