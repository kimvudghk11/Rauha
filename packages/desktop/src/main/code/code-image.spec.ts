import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_IMAGE_BYTES } from '../../shared/preview-kind.js';
import { CodeFiles } from './code-files.js';

let base = '';
let work = '';
let outside = '';
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3]);
const make = (root: string | null = work): CodeFiles => new CodeFiles({ root: () => root, isSecret: (p) => /(^|\/)(secret\.png|\.env.*)$/.test(p) });

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'rauha-img-'));
  work = join(base, 'work');
  outside = join(base, 'outside');
  await mkdir(join(work, 'assets'), { recursive: true });
  await mkdir(outside);
  await writeFile(join(work, 'assets', 'logo.png'), PNG);
  await writeFile(join(work, 'dot.SVG'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await writeFile(join(work, 'notes.txt'), 'x');
  await writeFile(join(outside, 'evil.png'), PNG);
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('코드 탭 이미지 읽기', () => {
  it('작업 폴더 안 그림을 data: URL로 돌려준다', async () => {
    const r = await make().readImage('assets/logo.png');
    expect(r).toEqual({ ok: true, path: 'assets/logo.png', mime: 'image/png', bytes: PNG.length, dataUrl: `data:image/png;base64,${PNG.toString('base64')}` });
  });
  it('확장자 대소문자와 상관없이 종류를 알아본다', async () => {
    const r = await make().readImage('dot.SVG');
    expect(r.ok && r.mime).toBe('image/svg+xml');
  });
  it('그림이 아닌 확장자는 열지 않는다', async () => {
    expect(await make().readImage('notes.txt')).toEqual({ ok: false, reason: 'not-image' });
    expect(await make().readImage('.env')).toEqual({ ok: false, reason: 'not-image' });
  });
  it('.. 와 절대 경로는 막는다', async () => {
    expect(await make().readImage('../outside/evil.png')).toEqual({ ok: false, reason: 'bad-path' });
    expect(await make().readImage(join(outside, 'evil.png'))).toEqual({ ok: false, reason: 'bad-path' });
  });
  it('작업 폴더 밖으로 가는 바로가기로는 읽지 못한다', async () => {
    try {
      await symlink(outside, join(work, 'portal'), 'junction');
    } catch {
      return;
    }
    expect(await make().readImage('portal/evil.png')).toEqual({ ok: false, reason: 'outside' });
  });
  it('비밀 파일 이름이면 그림이어도 열지 않는다', async () => {
    await writeFile(join(work, 'secret.png'), PNG);
    expect(await make().readImage('secret.png')).toEqual({ ok: false, reason: 'secret' });
  });
  it('5MB를 넘는 그림은 열지 않는다', async () => {
    await writeFile(join(work, 'big.png'), Buffer.alloc(MAX_IMAGE_BYTES + 1));
    expect(await make().readImage('big.png')).toEqual({ ok: false, reason: 'image-too-big' });
    await writeFile(join(work, 'edge.png'), Buffer.alloc(MAX_IMAGE_BYTES));
    expect((await make().readImage('edge.png')).ok).toBe(true);
  });
  it('폴더이거나 없는 파일이거나 작업 폴더가 없으면 까닭을 알린다', async () => {
    await mkdir(join(work, 'dir.png'));
    expect(await make().readImage('dir.png')).toEqual({ ok: false, reason: 'not-file' });
    expect(await make().readImage('none.png')).toEqual({ ok: false, reason: 'missing' });
    expect(await make(null).readImage('assets/logo.png')).toEqual({ ok: false, reason: 'no-folder' });
  });
  it('이상한 입력은 거절한다', async () => {
    expect(await make().readImage(42)).toEqual({ ok: false, reason: 'bad-path' });
    expect(await make().readImage('a\0.png')).toEqual({ ok: false, reason: 'bad-path' });
    expect(await make().readImage('.git/x.png')).toEqual({ ok: false, reason: 'bad-path' });
  });
});
