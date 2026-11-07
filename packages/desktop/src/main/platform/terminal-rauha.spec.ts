import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { candidateDirs, candidateNames, findTerminalRauha, isTerminalRauha, removeTerminalRauha } from './terminal-rauha.js';

const SHIM_SH = '#!/bin/sh\nINIT_CWD="$PWD" exec node "/Users/me/code/rauha/packages/cli/dist/main.js" "$@"\n';
const SHIM_CMD = '@echo off\r\nsetlocal\r\nset "INIT_CWD=%CD%"\r\nnode "E:\\rauha\\packages\\cli\\dist\\main.js" %*\r\n';

describe('isTerminalRauha', () => {
  it('rauha 저장소의 dist/main.js를 부르는 셸 스크립트와 .cmd는 rauha 것이다', () => {
    expect(isTerminalRauha(SHIM_SH)).toBe(true);
    expect(isTerminalRauha(SHIM_CMD)).toBe(true);
  });

  it('이름만 rauha인 다른 프로그램은 아니다', () => {
    expect(isTerminalRauha('#!/bin/sh\nexec python /opt/rauha-tool/run.py "$@"\n')).toBe(false);
    expect(isTerminalRauha('#!/bin/sh\nexec node /opt/tool/dist/main.js\n')).toBe(false);
  });

  it('큰 파일(실행 파일 등)은 후보에서 뺀다', () => {
    expect(isTerminalRauha(`${SHIM_SH}${'x'.repeat(5000)}`)).toBe(false);
  });
});

describe('candidateDirs · candidateNames', () => {
  it('맥은 흔한 설치 폴더를 먼저 보고 PATH 폴더를 더하며 겹치면 한 번만 본다', () => {
    const dirs = candidateDirs({ platform: 'darwin', home: '/Users/me', pathEnv: '/usr/local/bin:/usr/bin:/opt/homebrew/bin', separator: ':' });
    expect(dirs.slice(0, 3)).toEqual([join('/Users/me', '.local', 'bin'), '/usr/local/bin', '/opt/homebrew/bin']);
    expect(dirs).toEqual([join('/Users/me', '.local', 'bin'), '/usr/local/bin', '/opt/homebrew/bin', '/usr/bin']);
  });

  it('Windows는 PATH 폴더만 본다', () => {
    expect(candidateDirs({ platform: 'win32', home: 'C:\\Users\\me', pathEnv: 'C:\\a;C:\\b' })).toEqual(['C:\\a', 'C:\\b']);
  });

  it('Windows는 rauha.cmd·rauha.ps1·rauha, 맥은 rauha만 본다', () => {
    expect(candidateNames('win32')).toEqual(['rauha.cmd', 'rauha.ps1', 'rauha']);
    expect(candidateNames('darwin')).toEqual(['rauha']);
  });
});

describe('찾아서 지우기', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const bin = () => {
    const d = mkdtempSync(join(tmpdir(), 'rauha-bin-'));
    dirs.push(d);
    return d;
  };

  it('rauha 것만 찾고 이름만 같은 파일은 건드리지 않는다', async () => {
    const a = bin();
    const b = bin();
    writeFileSync(join(a, 'rauha'), SHIM_SH);
    writeFileSync(join(b, 'rauha'), '#!/bin/sh\necho other\n');
    const found = await findTerminalRauha({ platform: 'darwin', home: join(a, 'nohome'), pathEnv: [a, b, join(a, '없는폴더')].join('|'), separator: '|' });
    expect(found.map((f) => f.path)).toEqual([join(a, 'rauha')]);
    expect(found[0]!.entry).toContain('packages/cli/dist/main.js');
    expect(existsSync(join(b, 'rauha'))).toBe(true);
  });

  it('찾기만으로는 아무것도 지우지 않고, 확인한 파일만 지운다', async () => {
    const a = bin();
    writeFileSync(join(a, 'rauha'), SHIM_SH);
    const found = await findTerminalRauha({ platform: 'darwin', home: join(a, 'nohome'), pathEnv: a, separator: '|' });
    expect(existsSync(join(a, 'rauha'))).toBe(true);
    expect(await removeTerminalRauha(found)).toEqual([join(a, 'rauha')]);
    expect(existsSync(join(a, 'rauha'))).toBe(false);
  });

  it('찾은 뒤에 다른 내용으로 바뀐 파일은 지우지 않는다', async () => {
    const a = bin();
    writeFileSync(join(a, 'rauha'), SHIM_SH);
    const found = await findTerminalRauha({ platform: 'darwin', home: join(a, 'nohome'), pathEnv: a, separator: '|' });
    writeFileSync(join(a, 'rauha'), '#!/bin/sh\necho 내가 새로 만든 프로그램\n');
    expect(await removeTerminalRauha(found)).toEqual([]);
    expect(existsSync(join(a, 'rauha'))).toBe(true);
  });

  it('후보 폴더가 하나도 없어도 빈 목록이다', async () => {
    mkdirSync(join(bin(), 'x'));
    expect(await findTerminalRauha({ platform: 'darwin', home: '/없음', pathEnv: '', separator: '|' })).toEqual([]);
  });
});
