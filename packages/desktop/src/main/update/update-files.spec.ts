import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canWriteDir, FileAttemptStore } from './update-files.js';

const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'rauha-att-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const record = { from: '0.1.4', to: '0.1.5', target: '/Applications/Rauha.app', at: '2026-11-09T00:00:00.000Z', log: '/x/log' };

describe('설치 시도 흔적 파일', () => {
  it('기록을 남기고 읽으면 스크립트 결과 글과 함께 돌려주고, 지우면 사라진다', async () => {
    const d = tmp();
    const store = new FileAttemptStore(join(d, 'a.json'), join(d, 'r.txt'));
    await store.begin(record);
    expect(await store.read()).toEqual({ record, result: null });
    writeFileSync(join(d, 'r.txt'), 'fail swap\n');
    expect((await store.read()).result).toBe('fail swap\n');
    await store.clear();
    expect(await store.read()).toEqual({ record: null, result: null });
  });

  it('새 시도를 시작하면 지난 결과 글을 지운다', async () => {
    const d = tmp();
    const store = new FileAttemptStore(join(d, 'a.json'), join(d, 'r.txt'));
    writeFileSync(join(d, 'r.txt'), 'ok\n');
    await store.begin(record);
    expect((await store.read()).result).toBeNull();
  });

  it('깨진 기록 파일은 기록 없음으로 읽는다', async () => {
    const d = tmp();
    writeFileSync(join(d, 'a.json'), '{broken');
    expect(await new FileAttemptStore(join(d, 'a.json'), join(d, 'r.txt')).read()).toEqual({ record: null, result: null });
  });
});

describe('쓸 수 있는 폴더인지', () => {
  it('있는 폴더와, 없지만 윗 폴더가 쓸 수 있는 폴더는 true', () => {
    const d = tmp();
    expect(canWriteDir(d)).toBe(true);
    expect(canWriteDir(join(d, 'Applications'))).toBe(true);
    mkdirSync(join(d, 'x'));
    expect(canWriteDir(join(d, 'x', 'y', 'z'))).toBe(true);
  });
});
