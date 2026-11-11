import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DockerLogEvent } from '../../shared/docker-api.js';
import { resolveComposeFile } from './compose-find.js';
import { findOnPath } from './docker-bin.js';
import { streamDocker } from './docker-run.js';
import { DockerService } from './docker-service.js';
import type { RunOutcome, StreamHandle } from './docker-run.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rauha-docker-atk-'));
});
afterEach(() => {
  delete process.env['RAUHA_DOCKER_BIN'];
  rmSync(dir, { recursive: true, force: true });
});

describe('docker 실행 파일 찾기(작업 폴더에 심은 docker.exe 방지)', () => {
  const only =
    (...files: string[]) =>
    (p: string): boolean =>
      files.includes(p);

  it('윈도우: PATH 의 절대 경로에서만 찾고, 현재 폴더(.)나 빈 칸은 건너뛴다', () => {
    const found = findOnPath('docker', 'C:\\evil;.;;C:\\Program Files\\Docker\\resources\\bin', 'win32', only('.\\docker.exe', 'docker.exe', 'C:\\Program Files\\Docker\\resources\\bin\\docker.exe'));
    expect(found).toBe('C:\\Program Files\\Docker\\resources\\bin\\docker.exe');
  });
  it('윈도우: 상대 경로 PATH 칸에만 있으면 못 찾은 것으로 본다(이름 그대로 두지 않고 null)', () => {
    expect(findOnPath('docker', '.;relative\\bin', 'win32', () => true)).toBeNull();
  });
  it('윈도우: .exe 뿐 아니라 .com 도 찾지만 .cmd·.bat 같은 스크립트는 고르지 않는다', () => {
    expect(findOnPath('docker', 'C:\\a', 'win32', only('C:\\a\\docker.com'))).toBe('C:\\a\\docker.com');
    expect(findOnPath('docker', 'C:\\a', 'win32', only('C:\\a\\docker.cmd', 'C:\\a\\docker.bat'))).toBeNull();
  });
  it('맥·리눅스: PATH 의 절대 경로에서 찾고, 빈 칸(= 현재 폴더)은 건너뛴다', () => {
    expect(findOnPath('docker', '/evil/../x::/usr/local/bin:.', 'darwin', only('docker', './docker', '/usr/local/bin/docker'))).toBe('/usr/local/bin/docker');
    expect(findOnPath('docker', ':', 'linux', () => true)).toBeNull();
  });
});

describe('compose 파일 경로 탈출', () => {
  it('작업 폴더 안의 진짜 파일이면 허용한다', () => {
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub', 'compose.yaml'), 'services: {}\n');
    expect(resolveComposeFile(dir, 'sub/compose.yaml')).not.toBeNull();
  });
  it('없는 파일이나 폴더는 거절한다', () => {
    mkdirSync(join(dir, 'compose.yaml'));
    expect(resolveComposeFile(dir, 'compose.yaml')).toBeNull();
    expect(resolveComposeFile(dir, 'nope/compose.yaml')).toBeNull();
  });
  it('작업 폴더 밖을 가리키는 심볼릭 링크(파일·폴더)는 거절한다', () => {
    const outside = mkdtempSync(join(tmpdir(), 'rauha-docker-out-'));
    try {
      writeFileSync(join(outside, 'compose.yaml'), 'services: {}\n');
      try {
        symlinkSync(join(outside, 'compose.yaml'), join(dir, 'docker-compose.yml'));
        symlinkSync(outside, join(dir, 'linked'), 'junction');
      } catch {
        return; // 심볼릭 링크를 만들 권한이 없는 환경(윈도우 일반 계정)에서는 건너뛴다
      }
      expect(resolveComposeFile(dir, 'docker-compose.yml')).toBeNull();
      expect(resolveComposeFile(dir, 'linked/compose.yaml')).toBeNull();
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
  it('서비스는 compose 파일 확인이 실패하면 docker 를 부르지 않는다', async () => {
    let ran = 0;
    const service = new DockerService({
      run: async (): Promise<RunOutcome> => (ran++, { code: 0, stdout: '', stderr: '', timedOut: false, cancelled: false, tooLarge: false }),
      stream: () => ({ stop: () => undefined }),
      workDir: () => dir,
      findCompose: () => [],
      resolveCompose: () => null,
      newId: () => 's',
      emit: () => undefined,
    });
    const r = await service.compose({ file: 'compose.yaml', op: 'up' });
    expect(r.ok).toBe(false);
    expect(ran).toBe(0);
  });
});

describe('로그 따라가기', () => {
  it('동시에 따라가는 로그 흐름 수에 상한이 있다(IPC 로 프로세스를 무한히 만들 수 없다)', async () => {
    let n = 0;
    const started: StreamHandle[] = [];
    const service = new DockerService({
      run: async () => ({ code: 0, stdout: '', stderr: '', timedOut: false, cancelled: false, tooLarge: false }),
      stream: () => {
        const h = { stop: () => undefined };
        started.push(h);
        return h;
      },
      workDir: () => dir,
      findCompose: () => [],
      newId: () => `s${++n}`,
      emit: () => undefined,
    });
    const results = [];
    for (let i = 0; i < 20; i++) results.push(await service.logs({ id: 'web', follow: true }));
    expect(started.length).toBeLessThan(20);
    expect(results.filter((r) => !r.ok)).not.toHaveLength(0);
    // 하나를 멈추면 다시 열 수 있다
    const firstOk = results.find((r) => r.ok);
    if (firstOk?.ok === true) service.logsStop(firstOk.data.streamId);
    expect((await service.logs({ id: 'web', follow: true })).ok).toBe(true);
  });
});

describe('로그 출력 읽기', () => {
  it('여러 바이트 글자(한글·이모지)가 두 조각에 걸쳐 와도 깨지지 않는다', async () => {
    const script = join(dir, 'split.cjs');
    writeFileSync(
      script,
      `const b = Buffer.from('안녕😀 end\\n', 'utf8');
for (let i = 0; i < b.length; i++) setTimeout(() => process.stdout.write(b.subarray(i, i + 1)), i * 5);
setTimeout(() => process.exit(0), b.length * 5 + 50);`,
    );
    process.env['RAUHA_DOCKER_BIN'] = script;
    const events: DockerLogEvent[] = [];
    let text = '';
    await new Promise<void>((done) => {
      streamDocker(['logs', 'web'], { data: (c) => (text += c), end: () => done() });
    });
    void events;
    expect(text).toBe('안녕😀 end\n');
    expect(text).not.toContain('\uFFFD');
  });
});

describe('위험 동작 확인을 IPC 로 건너뛰기', () => {
  const service = (calls: string[][]): DockerService =>
    new DockerService({
      run: async (args) => (calls.push([...args]), { code: 0, stdout: '', stderr: '', timedOut: false, cancelled: false, tooLarge: false }),
      stream: () => ({ stop: () => undefined }),
      workDir: () => dir,
      findCompose: () => [],
      newId: () => 's',
      emit: () => undefined,
    });

  it('confirm 이 true 가 아닌 값("true"·1·{}·배열)이면 지우기·down 이 실행되지 않는다', async () => {
    const calls: string[][] = [];
    const s = service(calls);
    for (const confirm of ['true', 1, {}, [true], null, undefined]) {
      expect((await s.remove({ id: 'web', confirm })).ok).toBe(false);
      expect((await s.imageRemove({ ref: 'nginx', confirm })).ok).toBe(false);
      expect((await s.volumeRemove({ name: 'v', confirm })).ok).toBe(false);
      expect((await s.networkRemove({ name: 'n', confirm })).ok).toBe(false);
      expect((await s.compose({ file: 'compose.yaml', op: 'down', confirm })).ok).toBe(false);
      expect((await s.compose({ file: 'compose.yaml', op: 'down', removeVolumes: true, confirm })).ok).toBe(false);
    }
    expect(calls).toEqual([]);
  });
  it('removeVolumes 를 "true" 문자열로 보내도 볼륨 삭제로 이어지지 않는다', async () => {
    const calls: string[][] = [];
    const s = service(calls);
    await s.compose({ file: 'compose.yaml', op: 'down', removeVolumes: 'true', confirm: true });
    expect(calls[0]).toEqual(['compose', '-f', 'compose.yaml', 'down']);
  });
  it('이름·이미지에 옵션이나 셸 글자를 넣으면 docker 를 부르지 않는다', async () => {
    const calls: string[][] = [];
    const s = service(calls);
    for (const bad of ['--privileged', '-v', 'a b', 'a;rm', 'a$(id)', 'a`id`', 'a\nb', '../x', 'a|b', 'a&b', '', ' ', 5, null, {}, ['x']]) {
      await s.start(bad);
      await s.stop(bad);
      await s.restart(bad);
      await s.inspect(bad);
      await s.logs({ id: bad });
      await s.exec({ id: bad, line: 'ls' });
      await s.imagePull({ ref: bad });
    }
    await s.imagePull({ ref: 'a@sha256:../..' });
    await s.imagePull({ ref: 'evil//x' });
    await s.exec({ id: 'web', line: 'ls\nrm -rf /' });
    expect(calls).toEqual([]);
  });
  it('compose 파일 이름에 옵션·경로 탈출·드라이브·널 문자를 넣으면 부르지 않는다', async () => {
    const calls: string[][] = [];
    const s = service(calls);
    for (const file of ['-f', '--help', '../compose.yaml', 'a/../../compose.yaml', '/etc/compose.yaml', 'C:\\x\\compose.yaml', 'C:compose.yaml', 'compose.yaml\0.txt', 'compose.yml.sh', 'sub//compose.yaml', './compose.yaml', 'a\\..\\..\\compose.yaml', '\\\\server\\share\\compose.yaml', 'x:y/compose.yaml', 7, null]) {
      expect((await s.compose({ file, op: 'ps' })).ok).toBe(false);
    }
    expect(calls).toEqual([]);
  });
  it('tail 값은 정수 1..5000 만 받는다', async () => {
    const calls: string[][] = [];
    const s = service(calls);
    for (const tail of [0, -1, 5001, 1.5, NaN, Infinity, '10', '--follow']) expect((await s.logs({ id: 'web', tail })).ok).toBe(false);
    expect(calls).toEqual([]);
  });
});
