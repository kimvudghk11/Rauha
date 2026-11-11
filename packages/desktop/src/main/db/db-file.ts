import { open, realpath, stat } from 'node:fs/promises';
import { failure, type DbFailure } from '../../shared/db-api.js';
import type { DbFilePath } from '../../shared/db-names.js';

export type FileCheck = { readonly ok: true; readonly real: string } | { readonly ok: false; readonly failure: DbFailure };

const HEADER = Buffer.from('SQLite format 3\0', 'latin1');
const MIN_SIZE = 512;

/**
 * 화면이 알려 준 경로가 "진짜 SQLite 파일"인지 파일을 직접 보고 확인한다(렌더러 입력을 믿지 않는다).
 * 심볼릭 링크는 실제 파일로 풀어서(realpath) 그 경로로 연다. 일반 파일이어야 하고(장치·파이프·폴더 거절), 머리 16바이트가 SQLite 표시여야 한다.
 * 확인과 열기 사이에 파일이 바뀔 수 있는 아주 짧은 틈은 남지만, 읽기 전용으로 열고 SQLite 가 파일 형식을 한 번 더 확인한다.
 */
export async function checkSqliteFile(path: DbFilePath): Promise<FileCheck> {
  let real: string;
  try {
    real = await realpath(path.value);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return { ok: false, failure: failure('no-file', 'File not found', code === 'ENOENT' || code === 'ENOTDIR' ? 'That file does not exist (it may have been moved or deleted).' : 'That file cannot be read.', 'Check the path, or remove it from the list.') };
  }
  try {
    const info = await stat(real);
    if (!info.isFile()) return { ok: false, failure: failure('bad-input', 'Not a file', 'That path is not a regular file (it is a folder or a special file).') };
    if (info.size < MIN_SIZE) return { ok: false, failure: failure('not-sqlite', 'Not a usable SQLite file', info.size === 0 ? 'The file is empty.' : 'The file is too small to be a SQLite database.') };
    const handle = await open(real, 'r');
    try {
      const head = Buffer.alloc(HEADER.length);
      const { bytesRead } = await handle.read(head, 0, HEADER.length, 0);
      if (bytesRead < HEADER.length || !head.equals(HEADER)) return { ok: false, failure: failure('not-sqlite', 'Not a SQLite file', 'The file does not start with the SQLite header, so it was not opened.', 'Pick a .db, .sqlite or .sqlite3 file.') };
    } finally {
      await handle.close();
    }
    return { ok: true, real };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return { ok: false, failure: failure('no-file', 'Cannot read the file', code === 'EACCES' || code === 'EPERM' ? 'Rauha has no permission to read that file.' : 'The file could not be read.') };
  }
}
