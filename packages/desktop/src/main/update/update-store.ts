import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { UpdateStore } from './update-service.js';

/** 마지막 확인 결과를 JSON 파일 하나에 둔다(이 PC에만). 없거나 깨진 파일은 null이다. */
export class FileUpdateStore implements UpdateStore {
  constructor(private readonly file: string) {}

  async load(): Promise<unknown> {
    try {
      return JSON.parse(await readFile(this.file, 'utf8'));
    } catch {
      return null;
    }
  }

  async save(json: unknown): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(json, null, 2), 'utf8');
  }
}
