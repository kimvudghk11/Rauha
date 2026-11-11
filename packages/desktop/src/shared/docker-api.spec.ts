import { describe, expect, it } from 'vitest';
import { classifyFailure, ComposeFile, DockerRequest, inputFailure, isComposeFileName } from './docker-api.js';
import { DockerInputError } from './docker-names.js';
import { parseInspect } from './docker-inspect.js';

describe('docker 실패 가르기', () => {
  it('실행 파일이 없으면 docker CLI not found 와 설치 링크를 보인다', () => {
    const f = classifyFailure({ spawnCode: 'ENOENT', stderr: '' });
    expect(f.kind).toBe('no-cli');
    expect(f.title).toBe('docker CLI not found');
    expect(f.link).toBe('https://docs.docker.com/get-docker/');
  });
  it('엔진에 닿지 못하면 Docker engine is not running 이다(리눅스·맥·윈도우 문구)', () => {
    for (const err of [
      'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?',
      'failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine; check if the path is correct and if the daemon is running: open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified.',
      'error during connect: Get "http://%2F%2F.%2Fpipe%2Fdocker_engine/v1.24/containers/json": open //./pipe/docker_engine',
    ]) {
      const f = classifyFailure({ stderr: err });
      expect(f.kind, err).toBe('engine-off');
      expect(f.title).toBe('Docker engine is not running');
      expect(f.link).not.toBeNull();
    }
  });
  it('소켓 권한이 없으면 권한 오류로 가른다', () => {
    const f = classifyFailure({ stderr: 'permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock' });
    expect(f.kind).toBe('permission');
  });
  it('시간 초과·취소·너무 큰 출력은 각각 가른다', () => {
    expect(classifyFailure({ timedOut: true, stderr: '' }).kind).toBe('timeout');
    expect(classifyFailure({ cancelled: true, stderr: '' }).kind).toBe('cancelled');
    expect(classifyFailure({ tooLarge: true, stderr: '' }).kind).toBe('too-large');
  });
  it('그 밖의 실패는 docker 가 한 말을 앞 몇 줄만 그대로 보인다', () => {
    const f = classifyFailure({ stderr: 'Error response from daemon: No such container: nope\nline2' });
    expect(f.kind).toBe('failed');
    expect(f.message).toContain('No such container: nope');
  });
  it('입력 검사 실패는 확인 필요와 잘못된 값으로 나눈다', () => {
    expect(inputFailure(new DockerInputError('x', 'confirm')).kind).toBe('confirm');
    expect(inputFailure(new DockerInputError('x')).kind).toBe('bad-input');
  });
});

describe('compose 파일 경로', () => {
  it('compose 파일 이름만 받는다', () => {
    for (const ok of ['docker-compose.yml', 'compose.yaml', 'docker-compose.override.yml', 'compose.dev.yaml']) expect(isComposeFileName(ok), ok).toBe(true);
    for (const bad of ['Dockerfile', 'compose.json', 'my-compose.yml', 'docker-compose.yml.bak']) expect(isComposeFileName(bad), bad).toBe(false);
  });
  it('작업 폴더 안 상대 경로만 받고 \\ 는 / 로 바꾼다', () => {
    expect(ComposeFile.parse('app\\api\\compose.yaml').path).toBe('app/api/compose.yaml');
    expect(ComposeFile.parse('docker-compose.yml').path).toBe('docker-compose.yml');
  });
  it('절대 경로·상위 경로·옵션처럼 읽히는 경로·compose 가 아닌 파일은 거절한다', () => {
    for (const bad of ['/etc/compose.yml', 'C:/x/compose.yml', '../compose.yml', 'a/../../compose.yml', '-f/compose.yml', 'a//compose.yml', 'a/Dockerfile', '', 5]) expect(() => ComposeFile.parse(bad), String(bad)).toThrow(DockerInputError);
  });
});

describe('요청 검사(DTO)', () => {
  it('컨테이너 삭제는 확인 표시가 없으면 main 에서도 거절한다', () => {
    expect(() => DockerRequest.remove({ id: 'web' })).toThrow(/confirmation/);
    expect(() => DockerRequest.remove({ id: 'web', confirm: 'yes' })).toThrow(DockerInputError);
    expect(DockerRequest.remove({ id: 'web', confirm: true, force: true })).toMatchObject({ force: true });
  });
  it('이미지·볼륨·네트워크 삭제도 확인 표시가 있어야 한다', () => {
    expect(() => DockerRequest.imageRemove({ ref: 'busybox' })).toThrow(/confirmation/);
    expect(() => DockerRequest.volumeRemove({ name: 'v' })).toThrow(/confirmation/);
    expect(() => DockerRequest.networkRemove({ name: 'n' })).toThrow(/confirmation/);
    expect(DockerRequest.imageRemove({ ref: 'busybox', confirm: true }).value).toBe('busybox');
  });
  it('삭제 요청의 이름이 옵션처럼 읽히면 확인이 있어도 거절한다', () => {
    expect(() => DockerRequest.remove({ id: '-f', confirm: true })).toThrow(/cannot start with/);
    expect(() => DockerRequest.volumeRemove({ name: '--all', confirm: true })).toThrow(DockerInputError);
  });
  it('compose down 은 -v 가 있든 없든 확인이 있어야 한다', () => {
    expect(() => DockerRequest.compose({ file: 'compose.yaml', op: 'down', removeVolumes: true })).toThrow(/confirmation/);
    expect(DockerRequest.compose({ file: 'compose.yaml', op: 'down', removeVolumes: true, confirm: true }).removeVolumes).toBe(true);
    expect(() => DockerRequest.compose({ file: 'compose.yaml', op: 'down' })).toThrow(/confirmation/);
    expect(DockerRequest.compose({ file: 'compose.yaml', op: 'down', confirm: true }).removeVolumes).toBe(false);
  });
  it('compose 는 up·down·ps·logs 만 받고 removeVolumes 는 down 에서만 뜻이 있다', () => {
    expect(() => DockerRequest.compose({ file: 'compose.yaml', op: 'exec' })).toThrow(DockerInputError);
    expect(DockerRequest.compose({ file: 'compose.yaml', op: 'up', removeVolumes: true }).removeVolumes).toBe(false);
  });
  it('로그 요청은 줄 수와 follow 를 검사한다', () => {
    expect(DockerRequest.logs({ id: 'web', follow: true }).tail.value).toBe(200);
    expect(() => DockerRequest.logs({ id: 'web', tail: 99999 })).toThrow(DockerInputError);
  });
  it('객체가 아닌 요청은 거절한다', () => {
    for (const bad of [null, 'x', 3, []]) expect(() => DockerRequest.remove(bad)).toThrow(/not valid/);
  });
  it('exec 요청은 한 줄 명령만 받는다', () => {
    expect(DockerRequest.exec({ id: 'web', line: 'ls /' }).line.value).toBe('ls /');
    expect(() => DockerRequest.exec({ id: 'web', line: 'a\nb' })).toThrow(DockerInputError);
  });
});

describe('docker inspect 읽기', () => {
  const sample = JSON.stringify([
    {
      Id: 'abcdef0123456789',
      Name: '/rauha-test-a',
      Path: 'sleep',
      Args: ['300'],
      RestartCount: 2,
      State: { Status: 'running', StartedAt: '2024-05-01T01:00:00Z', Health: { Status: 'healthy' } },
      Config: { Image: 'busybox', Env: ['TOKEN=' + 'sec' + 'ret'] },
      Mounts: [{ Name: 'data', Destination: '/data', RW: true }, { Source: '/host/x', Destination: '/x', RW: false }],
      NetworkSettings: { Ports: { '80/tcp': [{ HostPort: '8080' }], '53/udp': null }, Networks: { bridge: { IPAddress: '172.17.0.2' }, none: {} } },
    },
  ]);
  it('이름·이미지·명령·상태·포트·마운트·네트워크를 추린다', () => {
    const d = parseInspect(sample)!;
    expect(d).toMatchObject({ id: 'abcdef012345', name: 'rauha-test-a', image: 'busybox', command: 'sleep 300', status: 'running', restartCount: 2, health: 'healthy' });
    expect(d.ports).toEqual(['8080→80/tcp', '53/udp']);
    expect(d.mounts).toEqual(['data → /data', '/host/x → /x (ro)']);
    expect(d.networks).toEqual(['bridge (172.17.0.2)', 'none']);
  });
  it('환경 변수는 결과에 담지 않는다', () => {
    expect(JSON.stringify(parseInspect(sample))).not.toContain('TOKEN');
  });
  it('깨진 출력이나 빈 배열은 null 이다', () => {
    expect(parseInspect('nope')).toBeNull();
    expect(parseInspect('[]')).toBeNull();
    expect(parseInspect('[{"x":1}]')).toBeNull();
  });
});
