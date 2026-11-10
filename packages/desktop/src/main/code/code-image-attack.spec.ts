import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SecretPolicy } from '@rauha/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CodeFiles } from './code-files.js';

let base = '';
let work = '';
let outside = '';
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3]);
const policy = SecretPolicy.defaults();
const make = (): CodeFiles => new CodeFiles({ root: () => work, isSecret: (p) => policy.isSecret(p) });

/** 파일 바로가기는 Windows에서 권한이 없으면 못 만든다. 못 만들면 그 시험은 건너뛴다. */
async function tryLink(target: string, path: string, type?: 'file' | 'dir' | 'junction'): Promise<boolean> {
  try {
    await symlink(target, path, type);
    return true;
  } catch {
    return false;
  }
}

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'rauha-imgatk-'));
  work = join(base, 'work');
  outside = join(base, 'outside');
  await mkdir(join(work, 'assets'), { recursive: true });
  await mkdir(outside);
  await writeFile(join(outside, 'evil.png'), PNG);
  await writeFile(join(outside, 'photo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  await writeFile(join(work, '.env'), 'TOKEN=' + 'x'.repeat(10));
  await writeFile(join(work, 'server.pem'), 'x');
  await writeFile(join(work, 'assets', 'ok.png'), PNG);
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('이미지 읽기 공격', () => {
  it('폴더 연결(정션·심볼릭)로 작업 폴더 밖 그림을 읽을 수 없다', async () => {
    if (!(await tryLink(outside, join(work, 'portal'), 'junction'))) return;
    expect(await make().readImage('portal/evil.png')).toEqual({ ok: false, reason: 'outside' });
    expect(await make().readImage('portal/photo.svg')).toEqual({ ok: false, reason: 'outside' });
  });

  it('그림 이름의 바로가기가 밖의 파일을 가리켜도 읽을 수 없다', async () => {
    if (!(await tryLink(join(outside, 'evil.png'), join(work, 'link.png'), 'file'))) return;
    expect(await make().readImage('link.png')).toEqual({ ok: false, reason: 'outside' });
  });

  it('그림 이름의 바로가기가 비밀 파일(.env, pem)을 가리키면 읽을 수 없다', async () => {
    if (!(await tryLink(join(work, '.env'), join(work, 'looks-fine.png'), 'file'))) return;
    await tryLink(join(work, 'server.pem'), join(work, 'cert.png'), 'file');
    expect(await make().readImage('looks-fine.png')).toEqual({ ok: false, reason: 'secret' });
    expect(await make().readImage('cert.png')).toEqual({ ok: false, reason: 'secret' });
  });

  it('비밀 파일 이름에 그림 확장자를 붙여도 열리지 않는다', async () => {
    await writeFile(join(work, '.env.png'), 'x');
    await writeFile(join(work, 'id_rsa.png'), 'x');
    await writeFile(join(work, 'my.pem.png'), 'x');
    await writeFile(join(work, 'my.key'), 'x');
    expect((await make().readImage('.env.png')).ok).toBe(false);
    expect((await make().readImage('id_rsa.png')).ok).toBe(false);
    expect((await make().readImage('.ENV.PNG')).ok).toBe(false);
  });

  it('경로에 널 문자·상위 이동·절대 경로·그림이 아닌 값이 있으면 거절한다', async () => {
    const files = make();
    for (const bad of ['a\0.png', '../outside/evil.png', '..\outside\evil.png', join(outside, 'evil.png'), 'assets/../../outside/evil.png', '', '.', 'assets', 'assets/', 'x.png::$DATA', 'assets/ok.png:hidden']) {
      const r = await files.readImage(bad);
      expect(r.ok, bad).toBe(false);
    }
    for (const weird of [null, undefined, 7, {}, [], ['assets/ok.png'], { toString: () => 'assets/ok.png' }]) {
      expect((await files.readImage(weird)).ok).toBe(false);
    }
  });

  it('폴더를 그림 이름으로 만들어도 읽지 않는다', async () => {
    await mkdir(join(work, 'dir.png'));
    expect(await make().readImage('dir.png')).toEqual({ ok: false, reason: 'not-file' });
  });

  it('SVG는 내용을 해석하지 않고 image/svg+xml data URL로만 넘긴다(<img>로만 그려서 스크립트가 돌지 않는다)', async () => {
    await writeFile(join(work, 'evil.svg'), '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script><image href="https://evil.example/x"/></svg>');
    const r = await make().readImage('evil.svg');
    expect(r.ok && r.mime).toBe('image/svg+xml');
    expect(r.ok && r.dataUrl.startsWith('data:image/svg+xml;base64,')).toBe(true);
  });

  it('위장한 그림(확장자만 png인 HTML)도 그림 mime으로만 나가고 text/html이 되지 않는다', async () => {
    await writeFile(join(work, 'fake.png'), '<html><script>alert(1)</script></html>');
    const r = await make().readImage('fake.png');
    expect(r.ok && r.mime).toBe('image/png');
    expect(r.ok && /^data:image\/png;base64,/.test(r.dataUrl)).toBe(true);
  });
});
