import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JsonFile } from './json-file.js';

let dir = '';
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rauha-json-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('앱 데이터 JSON 파일', () => {
  it('없는 파일은 "없음"으로 읽힌다', async () => {
    expect(await new JsonFile(join(dir, 'a.json')).read()).toEqual({ kind: 'missing' });
  });

  it('쓴 값을 그대로 읽고, 없는 폴더도 만들어 쓴다', async () => {
    const file = new JsonFile(join(dir, 'x', 'y', 'a.json'));
    await file.write({ a: 1 });
    expect(await file.read()).toEqual({ kind: 'ok', value: { a: 1 } });
  });

  it('덮어써도 임시 파일이 남지 않는다', async () => {
    const file = new JsonFile(join(dir, 'a.json'));
    await file.write({ n: 1 });
    await file.write({ n: 2 });
    expect(await readdir(dir)).toEqual(['a.json']);
    expect(await file.read()).toEqual({ kind: 'ok', value: { n: 2 } });
  });

  it('깨진 파일은 "깨짐"으로 읽히고, 복사본을 옆에 남길 수 있다', async () => {
    const path = join(dir, 'a.json');
    await writeFile(path, '{ 깨짐', 'utf8');
    const file = new JsonFile(path);
    expect(await file.read()).toEqual({ kind: 'broken' });
    const copy = await file.keepCopy('2026-11-08T10:00:00Z');
    expect(copy).not.toBeNull();
    expect(await readFile(copy!, 'utf8')).toBe('{ 깨짐');
  });

  it('복사할 파일이 없으면 null', async () => {
    expect(await new JsonFile(join(dir, 'none.json')).keepCopy('x')).toBeNull();
  });

  it('덧붙이기는 한 줄씩 쌓인다', async () => {
    const file = new JsonFile(join(dir, 'log.jsonl'));
    await file.append({ a: 1 });
    await file.append({ b: 2 });
    expect((await readFile(join(dir, 'log.jsonl'), 'utf8')).trim().split('\n')).toEqual(['{"a":1}', '{"b":2}']);
  });
});
