import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DockerLogEvent } from '../../shared/docker-api.js';
import { runDocker, streamDocker } from './docker-run.js';
import { DockerService } from './docker-service.js';

let dir: string;
let events: DockerLogEvent[];
let work: string | null;
const FAKE = join(__dirname, 'fake-docker.cjs');

const make = (): DockerService => new DockerService({ run: runDocker, stream: streamDocker, workDir: () => work, findCompose: () => [{ path: 'compose.yaml', folder: 'Work folder' }], newId: () => 's1', emit: (e) => events.push(e) });
const calls = (): string[][] => {
  try {
    return readFileSync(join(dir, 'calls.log'), 'utf8').trim().split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as string[]);
  } catch {
    return [];
  }
};
const wait = async (cond: () => boolean): Promise<void> => {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 50));
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rauha-docker-svc-'));
  writeFileSync(join(dir, 'calls.log'), '');
  events = [];
  work = dir;
  process.env['RAUHA_DOCKER_BIN'] = FAKE;
  process.env['FAKE_DOCKER_LOG'] = join(dir, 'calls.log');
  process.env['FAKE_DOCKER_MODE'] = 'ok';
});
afterEach(() => {
  delete process.env['RAUHA_DOCKER_BIN'];
  delete process.env['FAKE_DOCKER_LOG'];
  delete process.env['FAKE_DOCKER_MODE'];
  rmSync(dir, { recursive: true, force: true });
});

describe('Docker 서비스', () => {
  it('엔진이 켜져 있으면 클라이언트·서버 버전과 함께 준비됨으로 보인다', async () => {
    const s = await make().status();
    expect(s).toMatchObject({ ready: true, clientVersion: '29.9.2', serverVersion: '27.0.1', failure: null });
  });

  it('엔진이 꺼져 있으면 준비 안 됨과 이유·설치 링크를 돌려준다', async () => {
    process.env['FAKE_DOCKER_MODE'] = 'off';
    const s = await make().status();
    expect(s.ready).toBe(false);
    expect(s.clientVersion).toBe('29.9.2');
    expect(s.failure?.kind).toBe('engine-off');
    expect(s.failure?.link).toContain('docker.com');
  });

  it('docker 실행 파일이 없으면 CLI 없음 오류를 돌려준다', async () => {
    process.env['RAUHA_DOCKER_BIN'] = join(dir, 'no-such-docker');
    const s = await make().status();
    expect(s.failure?.kind).toBe('no-cli');
    const r = await make().containers();
    expect(r.ok === false && r.failure.kind).toBe('no-cli');
  });

  it('엔진이 꺼져 있으면 목록 요청이 이유를 담은 실패가 된다', async () => {
    process.env['FAKE_DOCKER_MODE'] = 'off';
    const r = await make().volumes();
    expect(r.ok === false && r.failure.kind).toBe('engine-off');
  });

  it('컨테이너 목록은 출력을 읽어 화면 값으로 바꾸고 깨진 줄은 센다', async () => {
    const r = await make().containers();
    if (!r.ok) throw new Error('ok 여야 한다');
    expect(r.data.containers.map((c) => [c.name, c.state, c.canStop])).toEqual([['web', 'running', true], ['db', 'exited', false]]);
    expect(r.data.containers[1]?.project).toBe('shop');
    expect(r.data.skipped).toBe(1);
  });

  it('이미지는 컨테이너가 쓰는지까지 이어 붙인다', async () => {
    const r = await make().images();
    if (!r.ok) throw new Error('ok 여야 한다');
    expect(r.data.images[0]).toMatchObject({ ref: 'nginx:latest', inUse: true });
  });

  it('볼륨과 네트워크 목록을 읽는다', async () => {
    const v = await make().volumes();
    const n = await make().networks();
    expect(v.ok && v.data.volumes[0]?.name).toBe('pgdata');
    expect(n.ok && n.data.networks[0]?.builtin).toBe(true);
  });

  it('시작·정지·재시작은 고정 인자로 docker 를 한 번씩 부른다', async () => {
    const s = make();
    await s.start('web');
    await s.stop('web');
    await s.restart('web');
    expect(calls()).toEqual([['start', 'web'], ['stop', 'web'], ['restart', 'web']]);
  });

  it('삭제는 확인 표시가 없으면 거절하고 docker 를 부르지 않는다', async () => {
    const s = make();
    const r = await s.remove({ id: 'web' });
    expect(r.ok === false && r.failure.kind).toBe('confirm');
    expect((await s.imageRemove({ ref: 'nginx' })).ok).toBe(false);
    expect((await s.volumeRemove({ name: 'pgdata' })).ok).toBe(false);
    expect((await s.networkRemove({ name: 'net1' })).ok).toBe(false);
    expect((await s.compose({ file: 'compose.yaml', op: 'down' })).ok).toBe(false);
    expect(calls()).toEqual([]);
  });

  it('확인이 있으면 삭제하고 강제 옵션은 --force 로만 붙는다', async () => {
    const s = make();
    await s.remove({ id: 'web', confirm: true });
    await s.remove({ id: 'db', force: true, confirm: true });
    await s.imageRemove({ ref: 'nginx:latest', confirm: true });
    expect(calls()).toEqual([['rm', 'web'], ['rm', '--force', 'db'], ['rmi', 'nginx:latest']]);
  });

  it('옵션처럼 읽히거나 이상한 이름은 거절하고 docker 를 부르지 않는다', async () => {
    const s = make();
    for (const bad of ['--all', '-f', 'a b', 'x;rm', '', 3]) {
      const r = await s.start(bad);
      expect(r.ok === false && r.failure.kind).toBe('bad-input');
    }
    expect(calls()).toEqual([]);
  });

  it('로그는 마지막 N줄을 흘려 보내고 끝나면 끝 알림을 낸다', async () => {
    const r = await make().logs({ id: 'web', tail: 50 });
    expect(r).toEqual({ ok: true, data: { streamId: 's1' } });
    await wait(() => events.some((e) => e.type === 'end'));
    expect(calls()).toEqual([['logs', '--tail', '50', 'web']]);
    const text = events.map((e) => (e.type === 'out' ? e.data : '')).join('');
    expect(text).toContain('line one');
    expect(text).toContain('warn line');
    expect(events.at(-1)).toMatchObject({ type: 'end', code: 0, note: null });
  });

  it('로그 줄 수가 범위를 벗어나면 거절한다', async () => {
    const r = await make().logs({ id: 'web', tail: 0 });
    expect(r.ok).toBe(false);
    expect(calls()).toEqual([]);
  });

  it('compose 는 작업 폴더 기준 파일을 -f 로 넘기고 ps 출력을 서비스 목록으로 읽는다', async () => {
    const r = await make().compose({ file: 'compose.yaml', op: 'ps' });
    if (!r.ok) throw new Error('ok 여야 한다');
    expect(r.data.services[0]).toMatchObject({ service: 'db', state: 'running' });
    expect(calls()[0]).toEqual(['compose', '-f', 'compose.yaml', 'ps', '--all', '--format', 'json']);
  });

  it('compose up 은 -d 로, 확인 있는 down -v 는 --volumes 로 부른다', async () => {
    const s = make();
    await s.compose({ file: 'sub/docker-compose.yml', op: 'up' });
    await s.compose({ file: 'compose.yaml', op: 'down', removeVolumes: true, confirm: true });
    expect(calls()).toEqual([['compose', '-f', 'sub/docker-compose.yml', 'up', '-d'], ['compose', '-f', 'compose.yaml', 'down', '--volumes']]);
  });

  it('작업 폴더가 없으면 compose 는 이유를 말하고 부르지 않는다', async () => {
    work = null;
    const r = await make().compose({ file: 'compose.yaml', op: 'ps' });
    expect(r.ok === false && r.failure.title).toBe('No work folder');
    expect(calls()).toEqual([]);
  });

  it('compose 파일이 작업 폴더 밖을 가리키면 거절한다', async () => {
    const r = await make().compose({ file: '../compose.yaml', op: 'ps' });
    expect(r.ok === false && r.failure.kind).toBe('bad-input');
  });

  it('exec 은 한 줄 명령을 sh -c 로 넘기고 출력과 종료 코드를 돌려준다', async () => {
    const r = await make().exec({ id: 'web', line: 'echo hi' });
    expect(r).toEqual({ ok: true, data: { output: 'hello from web\n', exitCode: 0 } });
    expect(calls()[0]).toEqual(['exec', 'web', 'sh', '-c', 'echo hi']);
    const bad = await make().exec({ id: 'web', line: 'a\nb' });
    expect(bad.ok).toBe(false);
  });

  it('inspect 는 환경 변수를 빼고 상세를 돌려준다', async () => {
    const r = await make().inspect('web');
    if (!r.ok) throw new Error('ok 여야 한다');
    expect(r.data.name).toBe('web');
    expect(JSON.stringify(r.data)).not.toContain('SECRET');
  });

  it('compose 파일 찾기는 작업 폴더가 있을 때만 목록을 준다', async () => {
    const s = make();
    expect(await s.composeFind()).toEqual({ ok: true, data: [{ path: 'compose.yaml', folder: 'Work folder' }] });
    work = null;
    expect(await s.composeFind()).toEqual({ ok: true, data: [] });
  });
});
