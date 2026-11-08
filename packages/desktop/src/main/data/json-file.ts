import { appendFile, copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export type JsonRead = { readonly kind: 'missing' } | { readonly kind: 'ok'; readonly value: unknown } | { readonly kind: 'broken' };

/**
 * 앱 데이터 JSON 파일 하나. 저장은 "임시 파일에 쓰고 이름 바꾸기"라서 쓰는 도중에 꺼져도 예전 파일이 그대로 남는다.
 * 깨진 파일은 덮어쓰기 전에 옆에 따로 복사해 둔다(데이터가 말없이 사라지지 않게).
 */
export class JsonFile {
  constructor(readonly file: string) {}

  async read(): Promise<JsonRead> {
    let raw: string;
    try {
      raw = await readFile(this.file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' };
      return { kind: 'broken' };
    }
    try {
      return { kind: 'ok', value: JSON.parse(raw) };
    } catch {
      return { kind: 'broken' };
    }
  }

  async write(value: unknown): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp-${process.pid}`;
    try {
      await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
      await rename(tmp, this.file);
    } catch (error) {
      await rm(tmp, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  /** 지금 파일을 `<이름>.broken-<시각>`으로 복사해 둔다. 복사할 파일이 없으면 아무 일 없다. */
  async keepCopy(stamp: string): Promise<string | null> {
    const to = `${this.file}.broken-${stamp.replace(/[^0-9A-Za-z-]/g, '')}`;
    try {
      await copyFile(this.file, to);
      return to;
    } catch {
      return null;
    }
  }

  /** 한 줄 JSON을 끝에 덧붙인다(보관 파일용) */
  async append(line: unknown): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    await appendFile(this.file, `${JSON.stringify(line)}\n`, 'utf8');
  }
}
