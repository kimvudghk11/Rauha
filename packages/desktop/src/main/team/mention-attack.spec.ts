import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSecretPolicy } from '@rauha/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CodeFiles } from '../code/code-files.js';
import { resolveMentions } from './mention-context.js';

// 시험용 가짜 비밀: 조각을 이어 붙인다(진짜 비밀 모양을 저장소에 두지 않는다)
const FAKE = ['sk', 'live', 'NOT-A-REAL-KEY'].join('-');

let base = '';
let work = '';
let outside = '';

const mentionAll = async (...paths: string[]) => {
  const policy = loadSecretPolicy(work);
  const files = new CodeFiles({ root: () => work, isSecret: (p) => policy.isSecret(p) });
  return resolveMentions(paths.map((p) => `@${p}`).join(' '), files);
};

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'rauha-mention-'));
  work = join(base, 'work');
  outside = join(base, 'outside');
  await mkdir(join(work, 'src'), { recursive: true });
  await mkdir(join(work, 'config'), { recursive: true });
  await mkdir(outside);
  await writeFile(join(outside, 'host.txt'), FAKE);
  await writeFile(join(work, 'src', 'a.ts'), 'export const a = 1;\n');
  await writeFile(join(work, '.env'), `TOKEN=${FAKE}\n`);
  await writeFile(join(work, 'config', '.env.production'), `TOKEN=${FAKE}\n`);
  await writeFile(join(work, 'config', 'server.pem'), FAKE);
  await writeFile(join(work, 'src', 'plain.txt'), 'ok\n');
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

const leaked = (found: { head: string | null }[]) => found.some((f) => f.head?.includes(FAKE) === true);

describe('@파일 언급이 비밀을 새게 하지 않는다', () => {
  it('보통 파일은 읽고, 비밀 파일은 어떤 이름 모양으로 가리켜도 읽지 않는다', async () => {
    const found = await mentionAll('src/a.ts', '.env', 'config/.env.production', 'config/server.pem', '.ENV', 'config/.ENV.PRODUCTION', 'config/SERVER.PEM', '.env.', 'config/server.pem.');
    expect(found.map((f) => f.path)).toEqual(['src/a.ts']);
    expect(leaked(found)).toBe(false);
  });

  it('윈도우식 끝 점·공백·대체 스트림 이름으로도 비밀 파일을 읽지 못한다', async () => {
    const found = await mentionAll('.env::$DATA', '.env.....', 'config/.env.production::$DATA', '.env%20');
    expect(leaked(found)).toBe(false);
  });

  it('작업 폴더 안 링크가 비밀 파일이나 폴더 밖 파일을 가리켜도 읽지 않는다', async () => {
    try {
      await symlink(join(work, '.env'), join(work, 'src', 'notes.txt'));
      await symlink(join(outside, 'host.txt'), join(work, 'src', 'hosts.txt'));
      await symlink(outside, join(work, 'src', 'lnkdir'), 'junction');
    } catch {
      return; // 링크를 만들 수 없는 환경
    }
    const found = await mentionAll('src/notes.txt', 'src/hosts.txt', 'src/lnkdir/host.txt');
    expect(found).toEqual([]);
  });

  it('.git 안쪽은 짧은 이름·보이지 않는 글자·끝 점으로 가리켜도 읽지 않는다', async () => {
    const found = await mentionAll('.git/config', 'GIT~1/config', '.git./config', '.GIT/config', '.g‌it/config', 'sub/../.git/config');
    expect(found).toEqual([]);
  });

  it('제어 문자가 든 이름은 언급으로 받지 않는다', async () => {
    const found = await mentionAll('src/a\u0007.ts', 'src/a\u0085.ts', 'src/a\u001b[31m.ts');
    expect(found).toEqual([]);
  });

  it('윈도우 장치 이름은 읽으려 하지 않는다', async () => {
    const found = await mentionAll('src/CON', 'src/nul.txt', 'COM1.txt', 'LPT1.log');
    expect(found).toEqual([]);
  });
});
