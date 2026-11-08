import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CodeFiles } from './code-files.js';
import { FileOps } from './file-ops.js';

// 악의적 점검에서 찾은 우회들의 회귀 시험. Windows 전용 시험은 그 OS에서만 돈다(8.3 짧은 이름·대체 데이터 스트림).
const win = process.platform === 'win32';
// 이름이 아니라 폴더 위치로 비밀을 가리는 규칙(.env류 + private/ 아래 전부)
const secretRule = /(^|\/)(\.env(\..+)?|.*\.pem)$|^private\//;

let base = '';
let work = '';
let trashed: string[] = [];

const make = (): FileOps => {
  const files = new CodeFiles({ root: () => work, isSecret: (p) => secretRule.test(p) });
  return new FileOps({
    files,
    trash: async (abs) => {
      trashed.push(abs);
      await rename(abs, join(base, 'trash', `${trashed.length}-${basename(abs)}`));
    },
    reveal: () => undefined,
    protectedRoots: () => [],
  });
};
const exists = (p: string): Promise<boolean> =>
  stat(p).then(
    () => true,
    () => false,
  );
/** dir /x 로 짧은 이름(8.3)을 알아낸다. 짧은 이름이 꺼진 볼륨이면 null */
const shortName = (dir: string, long: string): string | null => {
  try {
    const out = execFileSync('cmd.exe', ['/d', '/c', 'dir', '/x', '/a', dir], { encoding: 'latin1' });
    const line = out.split(/\r?\n/).find((l) => l.trimEnd().endsWith(long));
    const m = line?.match(/\s(\S+~\d)\s+\S+$/);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
};

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'rauha-atk-'));
  work = join(base, 'work');
  trashed = [];
  await mkdir(join(base, 'trash'));
  await mkdir(join(work, 'app', '.git'), { recursive: true });
  await mkdir(join(work, 'app', 'node_modules', 'x'), { recursive: true });
  await mkdir(join(work, 'private', 'sub'), { recursive: true });
  await writeFile(join(work, 'private', 'token.txt'), 'x');
  await writeFile(join(work, 'private', 'sub', 'y.txt'), 'y');
  await writeFile(join(work, 'app', '.env'), 'K=v');
  await writeFile(join(work, 'plain.txt'), 'p');
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe.skipIf(!win)('Windows 이름 우회', () => {
  it('대체 데이터 스트림 이름(.git::$INDEX_ALLOCATION)으로 .git을 휴지통에 보내지 못한다', async () => {
    const r = await make().trash({ path: 'app/.git::$INDEX_ALLOCATION' });
    expect(r.ok).toBe(false);
    expect(await exists(join(work, 'app', '.git'))).toBe(true);
  });

  it('대체 데이터 스트림 이름(node_modules::$INDEX_ALLOCATION)으로 node_modules를 지우지 못한다', async () => {
    const r = await make().trash({ path: 'app/node_modules::$INDEX_ALLOCATION' });
    expect(r.ok).toBe(false);
    expect(await exists(join(work, 'app', 'node_modules'))).toBe(true);
  });

  it('짧은 이름(GIT~1)으로 .git을 지우거나 옮기지 못한다', async () => {
    const short = shortName(join(work, 'app'), '.git');
    if (short === null) return; // 이 볼륨은 짧은 이름이 꺼져 있다
    const ops = make();
    expect((await ops.trash({ path: `app/${short}` })).ok).toBe(false);
    expect((await ops.rename({ path: `app/${short}`, name: 'gone' })).ok).toBe(false);
    expect((await ops.move({ path: `app/${short}`, destDir: '' })).ok).toBe(false);
    expect(await exists(join(work, 'app', '.git'))).toBe(true);
  });

  it('짧은 이름(NODE_M~1)으로 node_modules를 지우지 못한다', async () => {
    const short = shortName(join(work, 'app'), 'node_modules');
    if (short === null) return;
    expect((await make().trash({ path: `app/${short}` })).ok).toBe(false);
    expect(await exists(join(work, 'app', 'node_modules'))).toBe(true);
  });

  it('짧은 이름(ENV~1)이나 ::$DATA 이름으로 비밀 파일을 비밀이 아닌 이름으로 바꾸거나 복제하지 못한다', async () => {
    const ops = make();
    const short = shortName(join(work, 'app'), '.env');
    for (const alias of [...(short === null ? [] : [short]), '.env::$DATA']) {
      expect((await ops.rename({ path: `app/${alias}`, name: 'env.txt' })).ok, alias).toBe(false);
      expect((await ops.duplicate({ path: `app/${alias}` })).ok, alias).toBe(false);
    }
    expect(await exists(join(work, 'app', '.env'))).toBe(true);
    expect(await exists(join(work, 'app', 'env.txt'))).toBe(false);
  });

  it('콜론이 든 경로는 읽지도 쓰지도 않는다', async () => {
    const files = new CodeFiles({ root: () => work, isSecret: (p) => secretRule.test(p) });
    expect((await files.read('app/.env::$DATA')).ok).toBe(false);
    expect((await files.read('plain.txt:hidden')).ok).toBe(false);
    expect((await files.write({ path: 'plain.txt:hidden', text: 'x', baseVersion: '', overwrite: true, eol: 'lf', bom: false })).ok).toBe(false);
  });

  it('예약 장치 이름(CON·NUL)은 읽지 않는다', async () => {
    const files = new CodeFiles({ root: () => work, isSecret: () => false });
    expect((await files.read('CON')).ok).toBe(false);
    expect((await files.read('plain.txt/NUL')).ok).toBe(false);
  });
});

describe('링크 너머 비밀·부피', () => {
  it('바로가기 폴더를 거쳐도 실제 위치가 비밀 폴더면 파일을 복제하지 못한다', async () => {
    await symlink(join(work, 'private'), join(work, 'lnk'), 'junction');
    const r = await make().duplicate({ path: 'lnk/token.txt' });
    expect(r.ok).toBe(false);
    expect(await exists(join(work, 'lnk', 'token 복사본.txt'))).toBe(false);
  });

  it('바로가기 폴더를 거쳐도 실제 위치가 비밀 폴더면 폴더 복제도 막는다', async () => {
    await symlink(join(work, 'private'), join(work, 'lnk'), 'junction');
    const r = await make().duplicate({ path: 'lnk/sub' });
    expect(r.ok).toBe(false);
    expect(await exists(join(work, 'private', 'sub 복사본'))).toBe(false);
  });

  it('빈 폴더만 수천 개인 폴더는 복제하지 않는다(폴더 수도 센다)', async () => {
    for (let i = 0; i < 2100; i++) await mkdir(join(work, 'many', `d${i}`), { recursive: true });
    const r = await make().duplicate({ path: 'many' });
    expect(r).toMatchObject({ ok: false, reason: 'too-many' });
    expect(await exists(join(work, 'many 복사본'))).toBe(false);
  }, 30_000);

  it.skipIf(win)('이름 붙은 파이프(FIFO)는 복제하지 않는다(읽다가 멈추지 않는다)', async () => {
    execFileSync('mkfifo', [join(work, 'pipe')]);
    const r = await make().duplicate({ path: 'pipe' });
    expect(r.ok).toBe(false);
  }, 10_000);
});
