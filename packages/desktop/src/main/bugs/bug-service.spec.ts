import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BugNoteList } from '../../shared/bug-note.js';
import type { AwsInput } from '../../shared/bug-sync.js';
import { BugService } from './bug-service.js';
import { BugStore, type BugStorePort } from './bug-store.js';
import { S3PortError, type S3Port } from './s3-port.js';

/** 진짜 AWS를 부르지 않는 가짜 저장소. 호출 기록을 남긴다. */
class FakeS3 implements S3Port {
  readonly files = new Map<string, string>();
  readonly calls: string[] = [];
  failPut: ((key: string) => boolean) | null = null;
  constructor(public account = '000000000000') {}
  async callerAccount(): Promise<string> {
    this.calls.push('sts');
    return this.account;
  }
  async put(key: string, body: string): Promise<void> {
    this.calls.push(`put:${key}`);
    if (this.failPut?.(key) === true) throw new S3PortError('네트워크가 끊겼어요.');
    this.files.set(key, body);
  }
  async list(prefix: string): Promise<readonly string[]> {
    this.calls.push('list');
    return [...this.files.keys()].filter((k) => k.startsWith(prefix));
  }
  async get(key: string): Promise<string> {
    this.calls.push(`get:${key}`);
    return this.files.get(key) ?? '';
  }
}

class MemoryStore implements BugStorePort {
  list = BugNoteList.empty();
  saves = 0;
  async load(): Promise<BugNoteList> {
    return this.list;
  }
  async save(list: BugNoteList): Promise<void> {
    this.saves += 1;
    this.list = list;
  }
}

const GOOD: AwsInput = { profile: 'test-profile', bucket: 'example-bucket', region: 'ap-northeast-2', account: '000000000000' };

function setup(aws: AwsInput = GOOD, s3 = new FakeS3()) {
  const store = new MemoryStore();
  let n = 0;
  let clock = 0;
  const connected: string[] = [];
  const service = new BugService({
    store,
    newId: () => `id${++n}`,
    now: () => new Date(Date.UTC(2026, 10, 9, 1, 0, ++clock)).toISOString(),
    env: () => ({ appVersion: '0.1.8', os: 'win32 10' }),
    aws: () => aws,
    redactContext: () => ({ repoNames: [], companyNames: ['악메상사'], userName: 'tester', homePath: '/Users/tester' }),
    connect: (target) => {
      connected.push(target.profile);
      return s3;
    },
  });
  return { service, store, s3, connected };
}

const add = (service: BugService, title: string, memo = '') => service.apply({ kind: 'add', title, memo, screen: 'chat' });

describe('답답한 점 서비스: 로컬 저장', () => {
  it('인터넷도 AWS 설정도 없이 적어 두면 파일에 저장된다', async () => {
    const { service, store } = setup({ profile: null, bucket: null, region: null, account: null });
    const r = await add(service, '버튼이 안 눌려요', '기록 탭');
    expect(r.ok).toBe(true);
    expect(store.list.items.map((n) => n.title)).toEqual(['버튼이 안 눌려요']);
    expect(store.list.items[0]!.toProps()).toMatchObject({ screen: 'chat', appVersion: '0.1.8', os: 'win32 10' });
  });

  it('제목이 없으면 이유를 돌려주고 저장하지 않는다', async () => {
    const { service, store } = setup();
    expect(await add(service, '   ')).toMatchObject({ ok: false, error: '제목을 적어 주세요.' });
    expect(store.saves).toBe(0);
  });

  it('해결 표시와 지우기가 저장된다', async () => {
    const { service, store } = setup();
    await add(service, '하나');
    await service.apply({ kind: 'resolve', id: 'id1' });
    expect(store.list.require('id1').isDone()).toBe(true);
    await service.apply({ kind: 'remove', id: 'id1' });
    expect(store.list.size).toBe(0);
  });

  it('프로필 이름이 없으면 상태에 올리기·받기를 막는 이유가 실린다', async () => {
    const { service } = setup({ ...GOOD, profile: null });
    const state = await service.get();
    expect(state.syncBlocked).toContain('프로필 이름');
  });
});

describe('답답한 점 서비스: 프로필·계정 막기', () => {
  it('프로필 이름을 적기 전에는 올리기 미리보기도, 받기도 AWS에 연결하지 않는다', async () => {
    const { service, connected, s3 } = setup({ ...GOOD, profile: null });
    await add(service, '제목');
    expect(await service.preview()).toMatchObject({ ok: false });
    expect(await service.upload('whatever')).toMatchObject({ ok: false });
    expect(await service.download()).toMatchObject({ ok: false });
    expect(connected).toEqual([]);
    expect(s3.calls).toEqual([]);
  });

  it('실제 계정이 등록한 개인 계정과 다르면 올리기를 막고 아무것도 올라가지 않는다', async () => {
    const { service, s3 } = setup(GOOD, new FakeS3('111122223333'));
    await add(service, '제목');
    const preview = await service.preview();
    expect(preview).toMatchObject({ ok: false });
    const result = await service.upload('anything');
    expect(result.ok).toBe(false);
    expect(s3.files.size).toBe(0);
    expect(s3.calls.filter((c) => c.startsWith('put'))).toEqual([]);
  });

  it('계정이 다를 때 이유에 실제 계정 전체 번호가 나오지 않는다', async () => {
    const { service } = setup(GOOD, new FakeS3('111122223333'));
    await add(service, '제목');
    const r = await service.preview();
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain('111122223333');
  });

  it('계정이 다르면 받기도 막는다', async () => {
    const { service, s3, store } = setup(GOOD, new FakeS3('111122223333'));
    expect(await service.download()).toMatchObject({ ok: false });
    expect(s3.calls).toEqual(['sts']);
    expect(store.list.size).toBe(0);
  });

  it('계정을 확인하지 못하면(로그인 안 됨 등) 올리지 않고 이유를 보여 준다', async () => {
    const s3 = new FakeS3();
    s3.callerAccount = async () => {
      throw new S3PortError('프로필에 로그인되어 있지 않아요.');
    };
    const { service } = setup(GOOD, s3);
    await add(service, '제목');
    expect(await service.preview()).toEqual({ ok: false, error: '프로필에 로그인되어 있지 않아요.' });
  });
});

describe('답답한 점 서비스: 올리기', () => {
  it('미리보기에는 가린 글이 나오고, 확인하면 가린 글만 bug-notes/<번호>.json 으로 올라간다', async () => {
    const { service, s3, store } = setup();
    await add(service, '악메상사 결제 오류', '담당 kim@acme-corp.com');
    const preview = await service.preview();
    if (!preview.ok) throw new Error('미리보기가 만들어져야 한다');
    expect(preview.items[0]!.title).not.toContain('악메상사');
    expect(preview.items[0]!.redactions).toBeGreaterThanOrEqual(2);
    const result = await service.upload(preview.digest);
    expect(result).toMatchObject({ ok: true, uploaded: 1, failed: 0 });
    expect([...s3.files.keys()]).toEqual(['bug-notes/id1.json']);
    const body = s3.files.get('bug-notes/id1.json')!;
    expect(body).not.toContain('악메상사');
    expect(body).not.toContain('acme-corp');
    expect(store.list.require('id1').uploaded).toBe(true);
    // 이 컴퓨터에는 가리기 전 글이 그대로 있다
    expect(store.list.require('id1').title).toBe('악메상사 결제 오류');
  });

  it('미리보기 뒤에 메모가 바뀌면 올리지 않는다', async () => {
    const { service, s3 } = setup();
    await add(service, '하나');
    const preview = await service.preview();
    if (!preview.ok) throw new Error('미리보기가 만들어져야 한다');
    await add(service, '둘');
    const result = await service.upload(preview.digest);
    expect(result.ok).toBe(false);
    expect(s3.files.size).toBe(0);
  });

  it('미리보기를 거치지 않은 엉뚱한 지문으로는 올리지 않는다', async () => {
    const { service, s3 } = setup();
    await add(service, '하나');
    expect((await service.upload('00000000')).ok).toBe(false);
    expect(s3.files.size).toBe(0);
  });

  it('올리기가 실패해도 로컬 메모는 그대로이고 올림 표시도 없다', async () => {
    const s3 = new FakeS3();
    s3.failPut = () => true;
    const { service, store } = setup(GOOD, s3);
    await add(service, '하나');
    const preview = await service.preview();
    if (!preview.ok) throw new Error('미리보기가 만들어져야 한다');
    const result = await service.upload(preview.digest);
    expect(result).toMatchObject({ ok: true, uploaded: 0, failed: 1, firstError: '네트워크가 끊겼어요.' });
    expect(store.list.size).toBe(1);
    expect(store.list.require('id1').uploaded).toBe(false);
  });

  it('하나가 실패해도 나머지는 올라가고 성공한 것만 올림 표시가 된다', async () => {
    const s3 = new FakeS3();
    s3.failPut = (k) => k.endsWith('id1.json');
    const { service, store } = setup(GOOD, s3);
    await add(service, '하나');
    await add(service, '둘');
    const preview = await service.preview();
    if (!preview.ok) throw new Error('미리보기가 만들어져야 한다');
    await service.upload(preview.digest);
    expect(store.list.require('id1').uploaded).toBe(false);
    expect(store.list.require('id2').uploaded).toBe(true);
  });

  it('올리고 나서 다시 미리보기를 하면 올릴 것이 없다', async () => {
    const { service } = setup();
    await add(service, '하나');
    const p = await service.preview();
    if (!p.ok) throw new Error('미리보기가 만들어져야 한다');
    await service.upload(p.digest);
    expect(await service.preview()).toMatchObject({ ok: true, items: [] });
  });

  it('해결 표시를 하면 다시 올릴 대상이 된다', async () => {
    const { service } = setup();
    await add(service, '하나');
    const p = await service.preview();
    if (!p.ok) throw new Error('미리보기가 만들어져야 한다');
    await service.upload(p.digest);
    await service.apply({ kind: 'resolve', id: 'id1' });
    const again = await service.preview();
    expect(again).toMatchObject({ ok: true });
    expect(again.ok && again.items.map((i) => i.id)).toEqual(['id1']);
  });
});

describe('답답한 점 서비스: 받아오기', () => {
  it('저장소의 메모를 로컬에 합치고, 같은 번호는 상태가 최신인 쪽을 따른다', async () => {
    const s3 = new FakeS3();
    const home = setup(GOOD, s3);
    await add(home.service, '회사에서 적은 것');
    const p = await home.service.preview();
    if (!p.ok) throw new Error('미리보기가 만들어져야 한다');
    await home.service.upload(p.digest);
    // 집에서 해결 표시 후 올림
    await home.service.apply({ kind: 'resolve', id: 'id1' });
    const p2 = await home.service.preview();
    if (!p2.ok) throw new Error('미리보기가 만들어져야 한다');
    await home.service.upload(p2.digest);

    // 회사 쪽 로컬은 아직 미해결 상태
    const office = setup(GOOD, s3);
    office.store.list = office.store.list.mergeRemote([]);
    await office.service.download();
    expect(office.store.list.require('id1').isDone()).toBe(true);

    // 이미 열려 있던 로컬에 받아도 합쳐진다
    const result = await office.service.download();
    expect(result).toMatchObject({ ok: true, added: 0, updated: 0 });
  });

  it('받아온 파일 중 깨진 것은 건너뛰고 센다', async () => {
    const s3 = new FakeS3();
    s3.files.set('bug-notes/bad.json', '{ 깨짐');
    s3.files.set('other/x.json', '{}');
    const { service, store } = setup(GOOD, s3);
    const result = await service.download();
    expect(result).toMatchObject({ ok: true, added: 0, skipped: 1 });
    expect(store.list.size).toBe(0);
  });

  it('받기가 실패하면 로컬 메모는 그대로다', async () => {
    const s3 = new FakeS3();
    s3.list = async () => {
      throw new S3PortError('버킷에 접근할 수 없어요.');
    };
    const { service, store } = setup(GOOD, s3);
    await add(service, '하나');
    expect(await service.download()).toEqual({ ok: false, error: '버킷에 접근할 수 없어요.' });
    expect(store.list.size).toBe(1);
  });

  it('알 수 없는 오류는 일반 문구로 바꿔 보여 준다(내부 내용을 그대로 내보내지 않는다)', async () => {
    const s3 = new FakeS3();
    s3.list = async () => {
      throw new Error('arn:aws:iam::123456789012:user/secret denied');
    };
    const { service } = setup(GOOD, s3);
    const r = await service.download();
    expect(JSON.stringify(r)).not.toContain('123456789012');
    expect(r.ok).toBe(false);
  });
});

describe('답답한 점 저장 파일', () => {
  let dir = '';
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rauha-bugs-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('저장했다 다시 열어도 같은 메모가 나온다', async () => {
    const file = join(dir, 'bugs.json');
    const a = setup();
    const service = new BugService({ ...{ store: new BugStore(file), newId: () => 'file1', now: () => '2026-11-09T01:00:00.000Z', env: () => ({ appVersion: '0.1.8', os: 'darwin' }), aws: () => GOOD, redactContext: () => ({ repoNames: [], companyNames: [], userName: '', homePath: '' }), connect: () => a.s3 } });
    await add(service, '파일에 남아요');
    const reopened = await new BugStore(file).load();
    expect(reopened.require('file1').title).toBe('파일에 남아요');
  });

  it('깨진 파일은 옆에 복사해 두고 빈 모음으로 연다', async () => {
    const file = join(dir, 'bugs.json');
    const { writeFile, readdir } = await import('node:fs/promises');
    await writeFile(file, '{ 깨짐', 'utf8');
    expect((await new BugStore(file).load()).size).toBe(0);
    expect((await readdir(dir)).some((n) => n.includes('broken'))).toBe(true);
    expect(await readFile(file, 'utf8')).toBe('{ 깨짐');
  });
});
