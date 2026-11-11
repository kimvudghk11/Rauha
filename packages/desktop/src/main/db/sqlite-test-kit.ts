// 시험 전용 도우미(앱 번들에는 들어가지 않는다): 자식 프로세스 코드를 esbuild 로 만들고, 임시 폴더에 시험용 SQLite 파일을 만든다.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { loadSqlite } from './sqlite-engine.js';

export const hasSqlite = (): boolean => loadSqlite() !== null;

let source: string | null = null;
/** sqlite-child.ts 를 한 줄짜리 CJS 코드로 묶는다(앱 빌드와 같은 방식) */
export function childSource(): string {
  if (source === null) {
    const entry = fileURLToPath(new URL('./sqlite-child.ts', import.meta.url));
    const out = buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', minify: true, write: false, logLevel: 'silent' });
    source = out.outputFiles[0]!.text;
  }
  return source;
}

export function tempDir(): { readonly dir: string; cleanup(): void } {
  const dir = mkdtempSync(join(tmpdir(), 'rauha-dbtest-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

interface Db {
  exec(sql: string): void;
  close(): void;
}
/** 시험용 SQLite 파일을 만든다. seed 는 SQL 문장들 */
export function makeDb(file: string, seed: string): string {
  const sqlite = loadSqlite() as unknown as { DatabaseSync: new (p: string) => Db };
  const db = new sqlite.DatabaseSync(file);
  db.exec(seed);
  db.close();
  return file;
}

export const SHOP_SEED = `
CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, age INTEGER DEFAULT 20, note TEXT);
INSERT INTO users (id, name, age, note) VALUES (1, 'Ada', 36, NULL), (2, 'Linus', 55, 'x'), (3, '김평화', 30, 'ß');
CREATE TABLE "weird ""table" (a, "b c");
INSERT INTO "weird ""table" VALUES (1, 2);
CREATE TABLE blobs (id INTEGER PRIMARY KEY, data BLOB, big INTEGER);
INSERT INTO blobs VALUES (1, x'00FF10', 9223372036854775807);
CREATE VIEW adults AS SELECT name FROM users WHERE age >= 30;
`;
