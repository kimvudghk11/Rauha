import { mkdir, mkdtemp, readdir, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ReadResult, WriteRequest } from '../../shared/code-api.js';
import { CodeFiles } from './code-files.js';

let base = '';
let work = '';
let outside = '';
const secretNames = /(^|\/)(\.env(\..+)?|.*\.pem|id_rsa.*)$/;
const make = (): CodeFiles => new CodeFiles({ root: () => work, isSecret: (p) => secretNames.test(p) });

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'rauha-code-'));
  work = join(base, 'work');
  outside = join(base, 'outside');
  await mkdir(join(work, 'src'), { recursive: true });
  await mkdir(outside);
  await writeFile(join(outside, 'secret.txt'), 'top');
  await writeFile(join(work, 'src', 'a.ts'), 'const a = 1;\n');
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

const okRead = (r: ReadResult) => {
  if (!r.ok) throw new Error(`읽기 실패: ${r.reason}`);
  return r;
};
const req = (over: Partial<WriteRequest>): WriteRequest => ({ path: 'src/a.ts', text: 'x', eol: 'lf', bom: false, baseVersion: '', overwrite: false, ...over });

describe('코드 탭 파일 읽기', () => {
  it('작업 폴더 안 파일을 읽는다', async () => {
    const r = okRead(await make().read('src/a.ts'));
    expect(r.text).toBe('const a = 1;\n');
    expect(r.path).toBe('src/a.ts');
  });

  it('.. 와 절대 경로는 막는다', async () => {
    expect(await make().read('../outside/secret.txt')).toEqual({ ok: false, reason: 'bad-path' });
    expect(await make().read(join(outside, 'secret.txt'))).toEqual({ ok: false, reason: 'bad-path' });
  });

  it('작업 폴더 밖을 가리키는 바로가기로는 읽지 못한다', async () => {
    try {
      await symlink(join(outside, 'secret.txt'), join(work, 'link.txt'), 'file');
    } catch {
      return; // 권한이 없는 환경(Windows 일반 사용자)에서는 건너뛴다
    }
    expect(await make().read('link.txt')).toEqual({ ok: false, reason: 'outside' });
  });

  it('밖 폴더로 가는 바로가기(Windows는 junction)를 거쳐서도 읽지 못한다', async () => {
    await symlink(outside, join(work, 'portal'), 'junction');
    expect(await make().read('portal/secret.txt')).toEqual({ ok: false, reason: 'outside' });
    const tree = await make().tree('');
    if (!tree.ok) throw new Error('목록 실패');
    expect(tree.entries.find((e) => e.name === 'portal')).toMatchObject({ link: true, blocked: true });
  });

  it('안에 있는 폴더로 가는 바로가기는 열린다', async () => {
    await symlink(join(work, 'src'), join(work, 'inner'), 'junction');
    expect(okRead(await make().read('inner/a.ts')).text).toBe('const a = 1;\n');
  });

  it('비밀 파일은 열지 않는다', async () => {
    await writeFile(join(work, '.env'), 'KEY=1');
    await writeFile(join(work, 'server.pem'), 'x');
    expect(await make().read('.env')).toEqual({ ok: false, reason: 'secret' });
    expect(await make().read('server.pem')).toEqual({ ok: false, reason: 'secret' });
  });

  it('이름을 바꾼 바로가기로 비밀 파일을 여는 길도 막는다', async () => {
    await writeFile(join(work, '.env'), 'KEY=1');
    try {
      await symlink(join(work, '.env'), join(work, 'notes.txt'), 'file');
    } catch {
      return;
    }
    expect(await make().read('notes.txt')).toEqual({ ok: false, reason: 'secret' });
  });

  it('.git 안은 열지 않는다', async () => {
    await mkdir(join(work, '.git'));
    await writeFile(join(work, '.git', 'config'), '[core]');
    expect(await make().read('.git/config')).toEqual({ ok: false, reason: 'bad-path' });
  });

  it('1MB를 넘는 파일은 열지 않는다', async () => {
    await writeFile(join(work, 'big.txt'), 'a'.repeat(1024 * 1024 + 1));
    expect(await make().read('big.txt')).toEqual({ ok: false, reason: 'too-big' });
  });

  it('바이너리와 UTF-8이 아닌 글은 열지 않는다', async () => {
    await writeFile(join(work, 'a.bin'), Buffer.from([1, 2, 0, 3]));
    await writeFile(join(work, 'k.txt'), Buffer.from([0xb0, 0xa1, 0xb3, 0xaa]));
    expect(await make().read('a.bin')).toEqual({ ok: false, reason: 'binary' });
    expect(await make().read('k.txt')).toEqual({ ok: false, reason: 'encoding' });
  });

  it('없는 파일과 폴더를 구분해 알린다', async () => {
    expect(await make().read('nope.ts')).toEqual({ ok: false, reason: 'missing' });
    expect(await make().read('src')).toEqual({ ok: false, reason: 'not-file' });
  });

  it('작업 폴더를 안 골랐으면 알린다', async () => {
    const none = new CodeFiles({ root: () => null, isSecret: () => false });
    expect(await none.read('a')).toEqual({ ok: false, reason: 'no-folder' });
  });

  it('.editorconfig를 폴더를 거슬러 올라가며 읽는다', async () => {
    await writeFile(join(work, '.editorconfig'), 'root = true\n[*]\nindent_style = space\nindent_size = 2\n');
    await writeFile(join(work, 'src', '.editorconfig'), '[*.ts]\nindent_size = 4\n');
    expect(okRead(await make().read('src/a.ts')).editorConfig).toEqual({ indent_style: 'space', indent_size: '4' });
  });
});

describe('코드 탭 폴더 목록', () => {
  it('폴더가 먼저, .git은 숨기고, 생성물 폴더와 비밀 파일을 표시한다', async () => {
    await mkdir(join(work, '.git'));
    await mkdir(join(work, 'node_modules'));
    await writeFile(join(work, '.env'), 'K=1');
    await writeFile(join(work, 'readme.md'), '#');
    const r = await make().tree('');
    if (!r.ok) throw new Error('목록 실패');
    expect(r.entries.map((e) => e.name)).toEqual(['node_modules', 'src', '.env', 'readme.md']);
    expect(r.entries[0]).toMatchObject({ kind: 'dir', heavy: true });
    expect(r.entries[2]).toMatchObject({ kind: 'file', locked: true });
    expect(r.truncated).toBe(false);
  });

  it('하위 폴더 경로는 작업 폴더 기준으로 돌려준다', async () => {
    const r = await make().tree('src');
    if (!r.ok) throw new Error('목록 실패');
    expect(r.entries[0]).toMatchObject({ name: 'a.ts', path: 'src/a.ts' });
  });

  it('작업 폴더 밖은 목록도 안 준다', async () => {
    expect(await make().tree('..')).toEqual({ ok: false, reason: 'bad-path' });
  });
});

describe('코드 탭 저장', () => {
  it('저장하면 새 version을 주고 임시 파일을 남기지 않는다', async () => {
    const read = okRead(await make().read('src/a.ts'));
    const w = await make().write(req({ text: 'const a = 2;\n', baseVersion: read.version }));
    expect(w.ok).toBe(true);
    expect(await readFile(join(work, 'src', 'a.ts'), 'utf8')).toBe('const a = 2;\n');
    expect(await readdir(join(work, 'src'))).toEqual(['a.ts']);
  });

  it('CRLF와 BOM을 되살려 쓴다', async () => {
    const read = okRead(await make().read('src/a.ts'));
    await make().write(req({ text: 'a\nb\n', eol: 'crlf', bom: true, baseVersion: read.version }));
    expect([...(await readFile(join(work, 'src', 'a.ts'))).subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect((await readFile(join(work, 'src', 'a.ts'), 'utf8')).replace(/^﻿/, '')).toBe('a\r\nb\r\n');
  });

  it('디스크에서 바뀐 파일은 충돌로 돌려주고 건드리지 않는다', async () => {
    const read = okRead(await make().read('src/a.ts'));
    await writeFile(join(work, 'src', 'a.ts'), 'changed elsewhere');
    await utimes(join(work, 'src', 'a.ts'), new Date(), new Date(Date.now() + 5000));
    expect(await make().write(req({ text: 'mine', baseVersion: read.version }))).toEqual({ ok: false, reason: 'conflict' });
    expect(await readFile(join(work, 'src', 'a.ts'), 'utf8')).toBe('changed elsewhere');
  });

  it('덮어쓰기를 고르면 충돌이어도 쓴다', async () => {
    const read = okRead(await make().read('src/a.ts'));
    await writeFile(join(work, 'src', 'a.ts'), 'changed elsewhere!!');
    expect((await make().write(req({ text: 'mine', baseVersion: read.version, overwrite: true }))).ok).toBe(true);
    expect(await readFile(join(work, 'src', 'a.ts'), 'utf8')).toBe('mine');
  });

  it('지워진 파일은 알리고, 덮어쓰기를 고르면 다시 만든다', async () => {
    const read = okRead(await make().read('src/a.ts'));
    await rm(join(work, 'src', 'a.ts'));
    expect(await make().write(req({ baseVersion: read.version }))).toEqual({ ok: false, reason: 'deleted' });
    expect((await make().write(req({ baseVersion: read.version, overwrite: true }))).ok).toBe(true);
    expect(await readFile(join(work, 'src', 'a.ts'), 'utf8')).toBe('x');
  });

  it('비밀 파일·밖 경로·.git 에는 쓰지 않는다', async () => {
    await writeFile(join(work, '.env'), 'K=1');
    expect(await make().write(req({ path: '.env', overwrite: true }))).toEqual({ ok: false, reason: 'secret' });
    expect(await make().write(req({ path: '../outside/new.txt', overwrite: true }))).toEqual({ ok: false, reason: 'bad-path' });
    expect(await make().write(req({ path: '.git/config', overwrite: true }))).toEqual({ ok: false, reason: 'bad-path' });
    expect(await readFile(join(work, '.env'), 'utf8')).toBe('K=1');
  });

  it('모양이 틀린 저장 요청은 받지 않는다', async () => {
    expect(await make().write({ path: 'src/a.ts' })).toEqual({ ok: false, reason: 'bad-path' });
    expect(await make().write(null)).toEqual({ ok: false, reason: 'bad-path' });
  });

  it('1MB를 넘는 글은 저장하지 않는다', async () => {
    const read = okRead(await make().read('src/a.ts'));
    const w = await make().write(req({ text: '가'.repeat(400_000), baseVersion: read.version }));
    expect(w).toEqual({ ok: false, reason: 'too-big' });
    expect(await readFile(join(work, 'src', 'a.ts'), 'utf8')).toBe('const a = 1;\n');
  });

  it('열어 둔 파일의 디스크 version을 묻는다', async () => {
    const read = okRead(await make().read('src/a.ts'));
    const s = await make().stat(['src/a.ts', 'nope.ts', '../x']);
    expect(s).toEqual({ 'src/a.ts': read.version, 'nope.ts': null, '../x': null });
  });
});
