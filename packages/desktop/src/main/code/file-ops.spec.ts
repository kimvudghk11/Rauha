import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CodeFiles } from './code-files.js';
import { FileOps } from './file-ops.js';

let base = '';
let work = '';
let outside = '';
let trashDir = '';
let trashed: string[] = [];
let trashFails: string | null = null;
let revealed: string[] = [];
const secretNames = /(^|\/)(\.env(\..+)?|.*\.pem|id_rsa.*)$/;

const make = (platform: NodeJS.Platform = process.platform): FileOps => {
  const files = new CodeFiles({ root: () => work, isSecret: (p) => secretNames.test(p), platform });
  return new FileOps({
    files,
    platform,
    // 진짜 휴지통 대신 임시 폴더로 옮기는 가짜
    trash: async (abs) => {
      if (trashFails !== null) throw new Error(trashFails);
      trashed.push(abs);
      await rename(abs, join(trashDir, `${trashed.length}-${basename(abs)}`));
    },
    reveal: (abs) => revealed.push(abs),
    protectedRoots: () => [join(work, 'docs')],
  });
};

const exists = (p: string): Promise<boolean> =>
  stat(p).then(
    () => true,
    () => false,
  );

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'rauha-ops-'));
  work = join(base, 'work');
  outside = join(base, 'outside');
  trashDir = join(base, 'trash');
  trashed = [];
  trashFails = null;
  revealed = [];
  await mkdir(join(work, 'src', 'deep'), { recursive: true });
  await mkdir(join(work, 'lib'));
  await mkdir(join(work, 'docs'));
  await mkdir(join(work, 'app', '.git'), { recursive: true });
  await mkdir(join(work, 'app', 'node_modules', 'x'), { recursive: true });
  await mkdir(outside);
  await mkdir(trashDir);
  await writeFile(join(outside, 'secret.txt'), 'top');
  await writeFile(join(work, 'src', 'a.ts'), 'const a = 1;\n');
  await writeFile(join(work, 'src', 'deep', 'd.ts'), 'd\n');
  await writeFile(join(work, '.env'), 'KEY=1\n');
  await writeFile(join(work, 'app', 'node_modules', 'x', 'i.js'), 'x');
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

const fail = (r: { ok: boolean }): string => (r.ok ? 'ok' : ((r as unknown as { reason: string }).reason));

describe('새로 만들기', () => {
  it('폴더 안에 새 파일과 새 폴더를 만든다', async () => {
    expect(await make().create({ parent: 'src', name: 'new.ts', kind: 'file' })).toEqual({ ok: true, path: 'src/new.ts', kind: 'file' });
    expect(await readFile(join(work, 'src', 'new.ts'), 'utf8')).toBe('');
    expect(await make().create({ parent: '', name: 'pkg', kind: 'dir' })).toEqual({ ok: true, path: 'pkg', kind: 'dir' });
    expect((await stat(join(work, 'pkg'))).isDirectory()).toBe(true);
  });
  it('이미 있는 이름이면 덮어쓰지 않고 거절한다', async () => {
    expect(fail(await make().create({ parent: 'src', name: 'a.ts', kind: 'file' }))).toBe('exists');
    expect(await readFile(join(work, 'src', 'a.ts'), 'utf8')).toBe('const a = 1;\n');
  });
  it('쓸 수 없는 이름은 까닭과 함께 거절한다', async () => {
    for (const name of ['a/b', '..', 'CON', 'x.', '', 'a:b']) {
      const r = await make().create({ parent: 'src', name, kind: 'file' });
      expect(fail(r), name).toBe('bad-name');
      expect((r as { detail?: string }).detail, name).toBeTruthy();
    }
  });
  it('작업 폴더 밖·.git·node_modules 안에는 만들지 않는다', async () => {
    expect(fail(await make().create({ parent: '../outside', name: 'x', kind: 'file' }))).toBe('bad-path');
    expect(fail(await make().create({ parent: 'app/.git', name: 'x', kind: 'file' }))).toBe('bad-path');
    expect(fail(await make().create({ parent: 'app/node_modules/x', name: 'x', kind: 'file' }))).toBe('protected');
    expect(await exists(join(outside, 'x'))).toBe(false);
  });
  it('밖으로 새는 폴더 링크 안에는 만들지 않는다', async () => {
    await symlink(outside, join(work, 'portal'), 'junction');
    expect(fail(await make().create({ parent: 'portal', name: 'x', kind: 'file' }))).toBe('outside');
    expect(await exists(join(outside, 'x'))).toBe(false);
  });
  it('경로가 너무 길면 거절한다', async () => {
    expect(fail(await make().create({ parent: 'src', name: 'a'.repeat(250), kind: 'file' }))).toBe('too-long');
  });
});

describe('이름 바꾸기', () => {
  it('파일과 폴더 이름을 바꾼다', async () => {
    expect(await make().rename({ path: 'src/a.ts', name: 'b.ts' })).toEqual({ ok: true, path: 'src/b.ts', kind: 'file' });
    expect(await exists(join(work, 'src', 'a.ts'))).toBe(false);
    expect(await readFile(join(work, 'src', 'b.ts'), 'utf8')).toBe('const a = 1;\n');
    expect(await make().rename({ path: 'src/deep', name: 'deeper' })).toEqual({ ok: true, path: 'src/deeper', kind: 'dir' });
    expect(await exists(join(work, 'src', 'deeper', 'd.ts'))).toBe(true);
  });
  it('겹치는 이름이면 덮어쓰지 않고 거절한다', async () => {
    await writeFile(join(work, 'src', 'b.ts'), 'keep');
    expect(fail(await make().rename({ path: 'src/a.ts', name: 'b.ts' }))).toBe('exists');
    expect(await readFile(join(work, 'src', 'b.ts'), 'utf8')).toBe('keep');
    expect(await readFile(join(work, 'src', 'a.ts'), 'utf8')).toBe('const a = 1;\n');
  });
  it('이름이 그대로거나 쓸 수 없으면 거절한다', async () => {
    expect(fail(await make().rename({ path: 'src/a.ts', name: 'a.ts' }))).toBe('bad-name');
    expect(fail(await make().rename({ path: 'src/a.ts', name: '../x.ts' }))).toBe('bad-name');
    expect(fail(await make().rename({ path: 'src/a.ts', name: 'NUL' }))).toBe('bad-name');
  });
  it('작업 폴더 루트와 레포 루트와 문서 폴더 자체는 바꾸지 않는다', async () => {
    expect(fail(await make().rename({ path: '', name: 'x' }))).toBe('protected');
    expect(fail(await make().rename({ path: 'app', name: 'app2' }))).toBe('protected'); // .git이 든 폴더 = 레포 루트
    expect(fail(await make().rename({ path: 'docs', name: 'docs2' }))).toBe('protected'); // 앱이 찾은 문서 폴더
    expect(await exists(join(work, 'app'))).toBe(true);
  });
  it('node_modules 안과 node_modules 자체는 바꾸지 않는다', async () => {
    expect(fail(await make().rename({ path: 'app/node_modules', name: 'nm' }))).toBe('protected');
    expect(fail(await make().rename({ path: 'app/node_modules/x/i.js', name: 'j.js' }))).toBe('protected');
  });
  it('.git 안과 작업 폴더 밖 경로는 다루지 않는다', async () => {
    expect(fail(await make().rename({ path: 'app/.git', name: 'g' }))).toBe('bad-path');
    expect(fail(await make().rename({ path: '../outside/secret.txt', name: 'x' }))).toBe('bad-path');
    expect(await exists(join(outside, 'secret.txt'))).toBe(true);
  });
  it('밖을 가리키는 링크는 링크 자체만 바꾸고 가리키는 파일은 건드리지 않는다', async () => {
    await symlink(outside, join(work, 'portal'), 'junction');
    expect(await make().rename({ path: 'portal', name: 'door' })).toMatchObject({ ok: true, path: 'door' });
    expect(await exists(join(outside, 'secret.txt'))).toBe(true);
    // 링크를 거쳐 밖의 파일을 바꾸는 길은 막는다
    expect(fail(await make().rename({ path: 'door/secret.txt', name: 'x.txt' }))).toBe('outside');
    expect(await exists(join(outside, 'secret.txt'))).toBe(true);
  });
  it('비밀 파일 이름은 비밀 이름끼리만 바꿀 수 있다(비밀 아닌 이름으로 바꾸면 내용이 열리게 된다)', async () => {
    expect(await make().rename({ path: '.env', name: '.env.local' })).toMatchObject({ ok: true, path: '.env.local' });
    expect(fail(await make().rename({ path: '.env.local', name: 'notes.txt' }))).toBe('secret');
    expect(await exists(join(work, '.env.local'))).toBe(true);
  });
  it.runIf(process.platform === 'win32')('대소문자만 바꾸는 이름 바꾸기는 대소문자를 가리지 않는 곳에서도 된다', async () => {
    expect(await make().rename({ path: 'src/a.ts', name: 'A.ts' })).toMatchObject({ ok: true, path: 'src/A.ts' });
    expect((await readdir(join(work, 'src'))).includes('A.ts')).toBe(true);
  });
  it.runIf(process.platform === 'win32')('대소문자를 가리지 않는 곳에서는 대소문자만 다른 다른 파일과도 겹친다', async () => {
    await writeFile(join(work, 'src', 'B.ts'), 'b');
    expect(fail(await make().rename({ path: 'src/a.ts', name: 'b.ts' }))).toBe('exists');
  });
});

describe('복제', () => {
  it('같은 폴더에 "이름 복사본"으로 만들고 원본은 그대로다', async () => {
    expect(await make().duplicate({ path: 'src/a.ts' })).toEqual({ ok: true, path: 'src/a 복사본.ts', kind: 'file' });
    expect(await readFile(join(work, 'src', 'a 복사본.ts'), 'utf8')).toBe('const a = 1;\n');
    expect(await make().duplicate({ path: 'src/a.ts' })).toMatchObject({ ok: true, path: 'src/a 복사본 2.ts' });
  });
  it('폴더는 안까지 통째로 복제한다', async () => {
    expect(await make().duplicate({ path: 'src' })).toEqual({ ok: true, path: 'src 복사본', kind: 'dir' });
    expect(await readFile(join(work, 'src 복사본', 'deep', 'd.ts'), 'utf8')).toBe('d\n');
  });
  it('다른 폴더에 붙여넣을 수도 있다(없는 이름이면 그대로, 있으면 복사본)', async () => {
    expect(await make().duplicate({ path: 'src/a.ts', destDir: 'lib' })).toMatchObject({ ok: true, path: 'lib/a.ts' });
    expect(await make().duplicate({ path: 'src/a.ts', destDir: 'lib' })).toMatchObject({ ok: true, path: 'lib/a 복사본.ts' });
  });
  it('비밀 파일 내용은 복제하지 않는다', async () => {
    expect(fail(await make().duplicate({ path: '.env' }))).toBe('secret');
    expect(await exists(join(work, '.env 복사본'))).toBe(false);
  });
  it('비밀 파일이 들어 있는 폴더·링크·.git·node_modules가 든 폴더는 복제하지 않는다', async () => {
    await writeFile(join(work, 'src', 'deep', 'server.pem'), 'k');
    expect(fail(await make().duplicate({ path: 'src' }))).toBe('secret');
    expect(await exists(join(work, 'src 복사본'))).toBe(false);
    expect(fail(await make().duplicate({ path: 'app' }))).toBe('protected');
    await symlink(outside, join(work, 'lib', 'portal'), 'junction');
    expect(fail(await make().duplicate({ path: 'lib' }))).toBe('link');
    expect(fail(await make().duplicate({ path: 'lib/portal' }))).toBe('link');
  });
  it('폴더를 자기 안에 붙여넣을 수 없다', async () => {
    expect(fail(await make().duplicate({ path: 'src', destDir: 'src/deep' }))).toBe('into-self');
    expect(await exists(join(work, 'src', 'deep', 'src'))).toBe(false);
  });
  it('조작 금지 구역에는 붙여넣지 않는다', async () => {
    expect(fail(await make().duplicate({ path: 'src/a.ts', destDir: 'app/node_modules/x' }))).toBe('protected');
  });
});

describe('옮기기', () => {
  it('다른 폴더로 옮긴다', async () => {
    expect(await make().move({ path: 'src/a.ts', destDir: 'lib' })).toEqual({ ok: true, path: 'lib/a.ts', kind: 'file' });
    expect(await exists(join(work, 'src', 'a.ts'))).toBe(false);
    expect(await readFile(join(work, 'lib', 'a.ts'), 'utf8')).toBe('const a = 1;\n');
    expect(await make().move({ path: 'src/deep', destDir: '' })).toMatchObject({ ok: true, path: 'deep' });
  });
  it('같은 이름이 있으면 덮어쓰지 않는다', async () => {
    await writeFile(join(work, 'lib', 'a.ts'), 'keep');
    expect(fail(await make().move({ path: 'src/a.ts', destDir: 'lib' }))).toBe('exists');
    expect(await readFile(join(work, 'lib', 'a.ts'), 'utf8')).toBe('keep');
    expect(await exists(join(work, 'src', 'a.ts'))).toBe(true);
  });
  it('폴더를 자기 안으로, 같은 폴더로는 옮기지 않는다', async () => {
    expect(fail(await make().move({ path: 'src', destDir: 'src/deep' }))).toBe('into-self');
    expect(fail(await make().move({ path: 'src/a.ts', destDir: 'src' }))).toBe('same-folder');
  });
  it('밖으로 새는 링크 폴더로는 옮기지 않는다', async () => {
    await symlink(outside, join(work, 'portal'), 'junction');
    expect(fail(await make().move({ path: 'src/a.ts', destDir: 'portal' }))).toBe('outside');
    expect(fail(await make().move({ path: 'src/a.ts', destDir: '../outside' }))).toBe('bad-path');
    expect(await exists(join(outside, 'a.ts'))).toBe(false);
  });
  it('조작 금지 구역·레포 루트는 옮기지 않고 그 안으로도 옮기지 않는다', async () => {
    expect(fail(await make().move({ path: 'app', destDir: 'lib' }))).toBe('protected');
    expect(fail(await make().move({ path: 'src/a.ts', destDir: 'app/node_modules' }))).toBe('protected');
    expect(fail(await make().move({ path: 'app/node_modules/x/i.js', destDir: 'lib' }))).toBe('protected');
    expect(fail(await make().move({ path: 'src/a.ts', destDir: 'app/.git' }))).toBe('bad-path');
  });
  it('비밀 파일은 옮겨도 비밀로 남는 곳(이름)이어야 한다', async () => {
    expect(await make().move({ path: '.env', destDir: 'lib' })).toMatchObject({ ok: true, path: 'lib/.env' });
  });
});

describe('삭제(휴지통)', () => {
  it('파일을 영구 삭제하지 않고 휴지통으로 보낸다', async () => {
    expect(await make().trash({ path: 'src/a.ts' })).toEqual({ ok: true, path: 'src/a.ts', kind: 'file' });
    expect(trashed).toHaveLength(1);
    expect(trashed[0]!.endsWith('a.ts')).toBe(true);
    expect(await exists(join(work, 'src', 'a.ts'))).toBe(false);
    expect(await readFile(join(trashDir, '1-a.ts'), 'utf8')).toBe('const a = 1;\n');
  });
  it('폴더도 통째로 휴지통으로 보낸다', async () => {
    expect(await make().trash({ path: 'src/deep' })).toMatchObject({ ok: true, kind: 'dir' });
    expect(await exists(join(work, 'src', 'deep'))).toBe(false);
  });
  it('휴지통이 안 되면 지우지 않고 까닭을 알린다', async () => {
    trashFails = '휴지통을 쓸 수 없는 드라이브';
    const r = await make().trash({ path: 'src/a.ts' });
    expect(r).toMatchObject({ ok: false, reason: 'trash-failed' });
    expect((r as { detail?: string }).detail).toContain('휴지통을 쓸 수 없는');
    expect(await exists(join(work, 'src', 'a.ts'))).toBe(true);
  });
  it('작업 폴더 루트·레포 루트·node_modules는 지우지 않는다', async () => {
    expect(fail(await make().trash({ path: '' }))).toBe('protected');
    expect(fail(await make().trash({ path: 'app' }))).toBe('protected');
    expect(fail(await make().trash({ path: 'docs' }))).toBe('protected');
    expect(fail(await make().trash({ path: 'app/node_modules/x/i.js' }))).toBe('protected');
    expect(fail(await make().trash({ path: 'app/.git' }))).toBe('bad-path');
    expect(trashed).toEqual([]);
  });
  it('작업 폴더 밖과 링크 너머의 파일은 지우지 않고, 링크 자체는 지울 수 있다', async () => {
    expect(fail(await make().trash({ path: '../outside/secret.txt' }))).toBe('bad-path');
    await symlink(outside, join(work, 'portal'), 'junction');
    expect(fail(await make().trash({ path: 'portal/secret.txt' }))).toBe('outside');
    expect(await exists(join(outside, 'secret.txt'))).toBe(true);
  });
  it('비밀 파일은 삭제할 수 있다(내용을 읽지 않는다)', async () => {
    expect(await make().trash({ path: '.env' })).toMatchObject({ ok: true });
    expect(await exists(join(work, '.env'))).toBe(false);
  });
});

describe('삭제 전 확인에 쓰는 정보', () => {
  it('폴더면 안의 파일 수를 세고 링크는 따라가지 않는다', async () => {
    await symlink(outside, join(work, 'src', 'portal'), 'junction');
    expect(await make().inspect({ path: 'src' })).toMatchObject({ ok: true, kind: 'dir', files: 2, locked: false });
    expect(await make().inspect({ path: 'src/a.ts' })).toMatchObject({ ok: true, kind: 'file', files: 1 });
  });
  it('조작 금지 대상은 locked로 알려 준다', async () => {
    expect(await make().inspect({ path: '' })).toMatchObject({ ok: true, locked: true });
    expect(await make().inspect({ path: 'app' })).toMatchObject({ ok: true, locked: true });
    expect(await make().inspect({ path: 'app/node_modules' })).toMatchObject({ ok: true, locked: true });
    expect(await make().inspect({ path: '.env' })).toMatchObject({ ok: true, secret: true, locked: false });
  });
});

describe('파일 관리자에서 보기', () => {
  it('안전한 경로만 실제 경로로 보여 준다', async () => {
    expect(await make().reveal({ path: 'src/a.ts' })).toEqual({ ok: true });
    expect(revealed[0]!.endsWith('a.ts')).toBe(true);
    expect(await make().reveal({ path: '../outside' })).toEqual({ ok: false });
    expect(revealed).toHaveLength(1);
  });
});

describe('화면에서 온 요청은 모양부터 다시 검사한다', () => {
  it('모양이 틀린 요청은 거절한다', async () => {
    const ops = make();
    for (const bad of [null, 'x', 5, {}, { path: 3, name: 3, parent: 3, destDir: 3, kind: 'link' }]) {
      expect(fail(await ops.rename(bad as never)), JSON.stringify(bad)).toBe('bad-path');
      expect(fail(await ops.create(bad as never)), JSON.stringify(bad)).toBe('bad-path');
      expect(fail(await ops.trash(bad as never)), JSON.stringify(bad)).toBe('bad-path');
      expect(fail(await ops.duplicate(bad as never)), JSON.stringify(bad)).toBe('bad-path');
      expect(fail(await ops.move(bad as never)), JSON.stringify(bad)).toBe('bad-path');
    }
  });
  it('작업 폴더를 고르지 않았으면 아무것도 하지 않는다', async () => {
    const files = new CodeFiles({ root: () => null, isSecret: () => false });
    const ops = new FileOps({ files, trash: async () => undefined, reveal: () => undefined, protectedRoots: () => [] });
    expect(fail(await ops.create({ parent: '', name: 'a', kind: 'file' }))).toBe('no-folder');
  });
});
