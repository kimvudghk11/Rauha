import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AttachmentStore } from './attachment-store.js';

const tmp = (): string => mkdtempSync(join(tmpdir(), 'rauha-att-'));
const png = (n: number): { ext: string; bytes: Uint8Array } => ({ ext: 'png', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, n]) });

describe('AttachmentStore', () => {
  let base = '';
  afterEach(() => undefined);

  it('이미지가 없으면 아무것도 만들지 않는다', async () => {
    base = tmp();
    expect(await new AttachmentStore(join(base, 'att')).stage([])).toBeNull();
    expect(existsSync(join(base, 'att'))).toBe(false);
  });

  it('이미지를 기본 폴더 아래 번호 붙은 이름으로 둔다(사용자가 정한 이름은 쓰지 않는다)', async () => {
    base = tmp();
    const staged = await new AttachmentStore(join(base, 'att'), () => 'job1').stage([png(1), { ext: 'jpg', bytes: new Uint8Array([0xff, 0xd8, 0xff, 9]) }]);
    expect(staged?.paths.map((p) => p.slice(join(base, 'att').length + 1).replace(/\\/g, '/'))).toEqual(['job1/1.png', 'job1/2.jpg']);
    expect(readFileSync(staged!.paths[0]!)[4]).toBe(1);
  });

  it('파일은 이 사용자만 읽게 둔다(맥·리눅스)', async () => {
    if (process.platform === 'win32') return;
    base = tmp();
    const staged = await new AttachmentStore(join(base, 'att'), () => 'j').stage([png(1)]);
    expect(statSync(staged!.paths[0]!).mode & 0o077).toBe(0);
  });

  it('일이 끝나면 그 일의 폴더만 지운다', async () => {
    base = tmp();
    const store = new AttachmentStore(join(base, 'att'), (() => { let n = 0; return () => `j${++n}`; })());
    const a = await store.stage([png(1)]);
    const b = await store.stage([png(2)]);
    await store.cleanup(a!.dir);
    expect(existsSync(a!.dir)).toBe(false);
    expect(existsSync(b!.dir)).toBe(true);
  });

  it('기본 폴더 밖이거나 기본 폴더 자체인 경로는 지우지 않는다', async () => {
    base = tmp();
    const outside = join(base, 'keep');
    writeFileSync(join(base, 'keep.txt'), 'x');
    const store = new AttachmentStore(join(base, 'att'), () => 'j');
    await store.stage([png(1)]);
    await store.cleanup(join(base, 'att'));
    await store.cleanup(base);
    await store.cleanup(join(base, 'att', 'j', '..', '..'));
    await store.cleanup(join(base, 'att', 'j', '1.png'));
    expect(existsSync(join(base, 'att', 'j', '1.png'))).toBe(true);
    expect(existsSync(join(base, 'keep.txt'))).toBe(true);
    void outside;
  });

  it('앱이 켜질 때 꺼지다 남은 폴더를 모두 치운다', async () => {
    base = tmp();
    const store = new AttachmentStore(join(base, 'att'), (() => { let n = 0; return () => `j${++n}`; })());
    await store.stage([png(1)]);
    await store.stage([png(2)]);
    await store.sweep();
    expect(readdirSync(join(base, 'att'))).toEqual([]);
  });

  it('기본 폴더가 아직 없어도 sweep 은 조용히 넘어간다', async () => {
    base = tmp();
    await expect(new AttachmentStore(join(base, 'nope')).sweep()).resolves.toBeUndefined();
  });

  it('sweep 은 기본 폴더 안의 링크를 따라가 밖의 파일을 지우지 않는다', async () => {
    base = tmp();
    const outside = join(base, 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, 'keep.txt'), 'keep');
    mkdirSync(join(base, 'att'));
    try {
      symlinkSync(outside, join(base, 'att', 'lnk'), 'junction');
    } catch {
      return; // 링크를 만들 수 없는 환경
    }
    await new AttachmentStore(join(base, 'att')).sweep();
    expect(readFileSync(join(outside, 'keep.txt'), 'utf8')).toBe('keep');
  });

  it('cleanup 은 .. 로 기본 폴더 밖이나 기본 폴더 자체를 가리켜도 지우지 않는다', async () => {
    base = tmp();
    const store = new AttachmentStore(join(base, 'att'), () => 'j1');
    const staged = await store.stage([png(1)]);
    await store.cleanup(join(base, 'att', 'j1', '..'));
    await store.cleanup(join(base, 'att', '..', 'att'));
    await store.cleanup(join(base, 'att', 'j1', '..', '..'));
    expect(existsSync(staged!.paths[0]!)).toBe(true);
  });
});
