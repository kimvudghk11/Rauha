import { describe, expect, it } from 'vitest';
import {
  agoLabel,
  classifyState,
  containerMatches,
  formatSize,
  parseComposeProjects,
  parseComposeServices,
  parseContainers,
  parseCreatedAt,
  parseImages,
  parseNetworks,
  parsePorts,
  parseRecords,
  parseSize,
  parseVolumes,
  portLabel,
  type ContainerView,
} from './docker-parse.js';

const ps = (o: Record<string, string>): string =>
  JSON.stringify({ ID: 'abc123def456', Names: 'web', Image: 'nginx:1.27', State: 'running', Status: 'Up 2 hours', Ports: '0.0.0.0:8080->80/tcp, [::]:8080->80/tcp', CreatedAt: '2024-05-01 10:00:00 +0900 KST', Labels: 'a=b,com.docker.compose.project=shop', ...o });

describe('docker 출력 줄 읽기', () => {
  it('깨진 줄은 건너뛰고 몇 줄을 건너뛰었는지 센다', () => {
    const r = parseRecords(`${ps({})}\nnot json\n\n{"x":1}\n[1]\n`);
    expect(r.rows).toHaveLength(2);
    expect(r.skipped).toBe(2);
  });
  it('JSON 배열 한 덩어리(compose ls)도 읽는다', () => {
    expect(parseRecords('[{"Name":"a"},{"Name":"b"}]').rows).toHaveLength(2);
  });
  it('깨진 배열은 빈 목록과 건너뜀 1로 돌려주고 던지지 않는다', () => {
    expect(parseRecords('[{"Name":')).toEqual({ rows: [], skipped: 1 });
  });
  it('빈 출력은 빈 목록이다', () => {
    expect(parseRecords('  \n')).toEqual({ rows: [], skipped: 0 });
  });
});

describe('컨테이너 상태 분류', () => {
  it('State와 Status 글로 running·exited·paused·restarting·unhealthy·created를 가른다', () => {
    expect(classifyState('running', 'Up 3 minutes')).toBe('running');
    expect(classifyState('running', 'Up 3 minutes (unhealthy)')).toBe('unhealthy');
    expect(classifyState('running', 'Up 3 minutes (Paused)')).toBe('paused');
    expect(classifyState('paused', 'Up 1 hour (Paused)')).toBe('paused');
    expect(classifyState('restarting', 'Restarting (1) 5 seconds ago')).toBe('restarting');
    expect(classifyState('exited', 'Exited (0) 2 hours ago')).toBe('exited');
    expect(classifyState('created', 'Created')).toBe('created');
    expect(classifyState('dead', '')).toBe('exited');
  });
  it('State가 비어 있으면 Status 첫 단어로 가르고, 모르면 other다', () => {
    expect(classifyState('', 'Up 5 seconds')).toBe('running');
    expect(classifyState('', 'Exited (1) now')).toBe('exited');
    expect(classifyState('weird', 'something')).toBe('other');
  });
});

describe('포트 문자열 해석', () => {
  it('IPv4·IPv6 로 같은 포트를 연 줄은 한 개로 합친다', () => {
    expect(parsePorts('0.0.0.0:8080->80/tcp, [::]:8080->80/tcp, :::8080->80/tcp')).toEqual([{ host: '8080', container: '80', proto: 'tcp' }]);
  });
  it('특정 주소에 묶인 포트는 주소를 남긴다', () => {
    expect(parsePorts('127.0.0.1:5432->5432/tcp')).toEqual([{ host: '127.0.0.1:5432', container: '5432', proto: 'tcp' }]);
  });
  it('밖으로 열리지 않은 포트와 포트 범위를 읽는다', () => {
    expect(parsePorts('5432/tcp, 0.0.0.0:8000-8002->8000-8002/udp')).toEqual([
      { host: null, container: '5432', proto: 'tcp' },
      { host: '8000-8002', container: '8000-8002', proto: 'udp' },
    ]);
  });
  it('모르는 모양의 조각은 버린다', () => {
    expect(parsePorts('garbage, ,->/')).toEqual([]);
  });
  it('한 줄 표시는 → 로 잇는다', () => {
    expect(portLabel({ host: '8080', container: '80', proto: 'tcp' })).toBe('8080→80/tcp');
    expect(portLabel({ host: null, container: '80', proto: 'tcp' })).toBe('80/tcp');
  });
});

describe('크기·시간 표시', () => {
  it('docker 의 크기 글을 바이트로 읽고 읽지 못하면 null이다', () => {
    expect(parseSize('1.5GB')).toBe(1_500_000_000);
    expect(parseSize('512kB')).toBe(512_000);
    expect(parseSize('0B')).toBe(0);
    expect(parseSize('2GiB')).toBe(2 * 1024 ** 3);
    expect(parseSize('big')).toBeNull();
  });
  it('바이트를 10진 단위 글로 바꾼다', () => {
    expect(formatSize(0)).toBe('0 B');
    expect(formatSize(1_500_000_000)).toBe('1.5 GB');
    expect(formatSize(123_000_000)).toBe('123 MB');
    expect(formatSize(-1)).toBe('-');
  });
  it('docker 의 CreatedAt 글과 RFC3339 를 초 단위로 읽는다', () => {
    expect(parseCreatedAt('2024-05-01 10:00:00 +0900 KST')).toBe(Date.parse('2024-05-01T01:00:00Z') / 1000);
    expect(parseCreatedAt('2024-05-01T01:00:00Z')).toBe(Date.parse('2024-05-01T01:00:00Z') / 1000);
    expect(parseCreatedAt('nope')).toBeNull();
    expect(parseCreatedAt('')).toBeNull();
  });
  it('시간 표시는 짧은 영어이고 모르거나 미래면 -다', () => {
    const now = 1_000_000;
    expect(agoLabel(now - 30, now)).toBe('just now');
    expect(agoLabel(now - 300, now)).toBe('5m ago');
    expect(agoLabel(now - 7200, now)).toBe('2h ago');
    expect(agoLabel(now - 86400 * 3, now)).toBe('3d ago');
    expect(agoLabel(null, now)).toBe('-');
    expect(agoLabel(now + 10, now)).toBe('-');
  });
});

describe('컨테이너 목록 읽기', () => {
  it('한 줄에서 이름·이미지·상태·포트·compose 프로젝트를 뽑는다', () => {
    const { items, skipped } = parseContainers(ps({}));
    expect(skipped).toBe(0);
    expect(items[0]!.toView()).toMatchObject({ id: 'abc123def456', name: 'web', image: 'nginx:1.27', state: 'running', ports: ['8080→80/tcp'], project: 'shop', canStart: false, canStop: true });
  });
  it('ID가 없는 줄과 깨진 줄은 건너뛴다', () => {
    const r = parseContainers(`${ps({})}\n{"Names":"x"}\n{oops`);
    expect(r.items).toHaveLength(1);
    expect(r.skipped).toBe(2);
  });
  it('모르는 필드가 있거나 필드가 빠져도 던지지 않는다', () => {
    const r = parseContainers('{"ID":"aaa","Future":{"x":1}}');
    expect(r.items[0]!.toView()).toMatchObject({ name: 'aaa', image: '', state: 'other', ports: [], createdAt: null, project: null });
  });
  it('멈춘 컨테이너는 시작만, 켜진 것은 정지만 할 수 있다', () => {
    const stopped = parseContainers(ps({ State: 'exited', Status: 'Exited (0) 1 hour ago' })).items[0]!;
    expect(stopped.canStart()).toBe(true);
    expect(stopped.canStop()).toBe(false);
  });
  it('이름이 여러 개면 첫 이름만 쓴다', () => {
    expect(parseContainers(ps({ Names: 'a,b' })).items[0]!.name).toBe('a');
  });
});

describe('컨테이너 검색·거르기', () => {
  const view = (o: Partial<ContainerView>): ContainerView => ({ id: 'id1', name: 'web', image: 'nginx', state: 'running', status: 'Up', ports: ['8080→80/tcp'], createdAt: null, project: null, canStart: false, canStop: true, ...o });
  it('검색어는 이름·이미지·ID·포트에서 대소문자 없이 찾는다', () => {
    expect(containerMatches(view({}), 'NGI', 'all')).toBe(true);
    expect(containerMatches(view({}), '8080', 'all')).toBe(true);
    expect(containerMatches(view({}), 'redis', 'all')).toBe(false);
  });
  it('상태 거르기는 running·stopped·problem을 가른다', () => {
    expect(containerMatches(view({}), '', 'running')).toBe(true);
    expect(containerMatches(view({ state: 'exited' }), '', 'running')).toBe(false);
    expect(containerMatches(view({ state: 'exited' }), '', 'stopped')).toBe(true);
    expect(containerMatches(view({ state: 'unhealthy' }), '', 'problem')).toBe(true);
    expect(containerMatches(view({}), '', 'problem')).toBe(false);
  });
});

describe('이미지·볼륨·네트워크·compose 읽기', () => {
  const images = '{"ID":"sha1","Repository":"nginx","Tag":"1.27","Size":"192MB","CreatedAt":"2024-05-01 10:00:00 +0900 KST"}\n{"ID":"sha2","Repository":"<none>","Tag":"<none>","Size":"5MB"}';
  it('이미지는 이름 조각과 크기를 읽고 <none>은 빈 이름으로 둔다', () => {
    const [a, b] = parseImages(images).items;
    expect(a!.ref).toBe('nginx:1.27');
    expect(b!.ref).toBe('sha2');
    expect(a!.toView([]).sizeBytes).toBe(192_000_000);
  });
  it('컨테이너가 쓰는 이미지는 사용 중으로 표시한다(이름·latest 생략형·ID)', () => {
    const [a, b] = parseImages(images).items;
    expect(a!.toView([{ image: 'nginx:1.27' }]).inUse).toBe(true);
    expect(a!.toView([{ image: 'redis' }]).inUse).toBe(false);
    expect(b!.toView([{ image: 'sha2' }]).inUse).toBe(true);
    const latest = parseImages('{"ID":"s3","Repository":"busybox","Tag":"latest","Size":"4MB"}').items[0]!;
    expect(latest.toView([{ image: 'busybox' }]).inUse).toBe(true);
  });
  it('볼륨과 네트워크를 읽고 기본 네트워크는 지울 수 없다고 표시한다', () => {
    expect(parseVolumes('{"Name":"pgdata","Driver":"local","Mountpoint":"/var/lib/docker/volumes/pgdata/_data"}\n{"Driver":"x"}').items).toHaveLength(1);
    const nets = parseNetworks('{"ID":"n1","Name":"bridge","Driver":"bridge","Scope":"local"}\n{"ID":"n2","Name":"shop_default","Driver":"bridge","Scope":"local"}').items;
    expect(nets.map((n) => n.builtin)).toEqual([true, false]);
  });
  it('compose ls 는 상태 글에서 켜짐 여부와 파일 목록을 읽는다', () => {
    const p = parseComposeProjects('[{"Name":"shop","Status":"running(2)","ConfigFiles":"/w/a/compose.yaml,/w/a/override.yaml"},{"Name":"old","Status":"exited(1)","ConfigFiles":""}]').items;
    expect(p[0]).toEqual({ name: 'shop', status: 'running(2)', running: true, files: ['/w/a/compose.yaml', '/w/a/override.yaml'] });
    expect(p[1]!.running).toBe(false);
  });
  it('compose ps 는 줄마다 JSON 이어도 배열이어도 읽는다', () => {
    const line = '{"Name":"shop-web-1","Service":"web","State":"running","Status":"Up 1 minute","Image":"nginx"}';
    expect(parseComposeServices(line).items[0]).toMatchObject({ service: 'web', state: 'running' });
    expect(parseComposeServices(`[${line}]`).items).toHaveLength(1);
  });
});
