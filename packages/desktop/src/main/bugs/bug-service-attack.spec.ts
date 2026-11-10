import { describe, expect, it } from 'vitest';
import { BugNoteList } from '../../shared/bug-note.js';
import { DOWNLOAD_MAX_FILES, type AwsInput } from '../../shared/bug-sync.js';
import { BugService } from './bug-service.js';
import type { BugStorePort } from './bug-store.js';
import type { S3Port } from './s3-port.js';

// 시험용 가짜 비밀(조각을 이어붙여 만든다)
const ghToken = ['gh', 'p_', 'd'.repeat(30)].join('');
const NOW = '2026-11-11T00:00:00.000Z';

class Port implements S3Port {
  readonly puts: string[] = [];
  readonly gets: string[] = [];
  constructor(
    public account: string,
    private readonly files: Record<string, string> = {},
    private readonly extraKeys: readonly string[] = [],
  ) {}
  async callerAccount(): Promise<string> {
    return this.account;
  }
  async put(key: string, body: string): Promise<void> {
    this.puts.push(`${key}\n${body}`);
  }
  async list(): Promise<readonly string[]> {
    return [...Object.keys(this.files), ...this.extraKeys];
  }
  async get(key: string): Promise<string> {
    this.gets.push(key);
    return this.files[key] ?? '';
  }
}

class Mem implements BugStorePort {
  list = BugNoteList.empty();
  async load(): Promise<BugNoteList> {
    return this.list;
  }
  async save(l: BugNoteList): Promise<void> {
    this.list = l;
  }
}

const PERSONAL = '111111111111';
const GOOD: AwsInput = { profile: 'personal', bucket: 'my-notes-bucket', region: 'ap-northeast-2', account: PERSONAL };

function make(aws: AwsInput, port: Port) {
  const connects: string[] = [];
  let n = 0;
  const service = new BugService({
    store: new Mem(),
    newId: () => `id${++n}`,
    now: () => NOW,
    env: () => ({ appVersion: '0.1.11', os: 'test' }),
    aws: () => aws,
    redactContext: () => ({ repoNames: [], companyNames: ['Acme Corp'], userName: 'tester', homePath: '/Users/tester' }),
    connect: (t) => (connects.push(t.profile), port),
  });
  return { service, connects };
}

describe('리포트 서비스 공격 시험', () => {
  it('프로필·계정 칸이 비었거나 모양이 틀리면 AWS에 연결조차 하지 않는다(default 프로필 자동 사용 금지)', async () => {
    for (const aws of [{ ...GOOD, profile: null }, { ...GOOD, profile: '  ' }, { ...GOOD, account: null }, { ...GOOD, account: '12345' }, { ...GOOD, bucket: null }, { ...GOOD, region: 'x' }]) {
      const port = new Port(PERSONAL);
      const { service, connects } = make(aws, port);
      await service.apply({ kind: 'add', title: 't', memo: '', screen: '' });
      expect((await service.preview()).ok).toBe(false);
      expect((await service.upload('00000000')).ok).toBe(false);
      expect((await service.download()).ok).toBe(false);
      expect(connects).toEqual([]);
      expect(port.puts).toEqual([]);
    }
  });

  it('회사 계정으로 로그인된 프로필이면 올리기도 받기도 막히고 파일을 읽거나 쓰지 않는다', async () => {
    const port = new Port('222222222222', { 'bug-notes/a.json': '{}' });
    const { service } = make(GOOD, port);
    await service.apply({ kind: 'add', title: 't', memo: ghToken, screen: '' });
    const pre = await service.preview();
    expect(pre.ok).toBe(false);
    const up = await service.upload('whatever');
    expect(up.ok).toBe(false);
    const down = await service.download();
    expect(down.ok).toBe(false);
    expect(port.puts).toEqual([]);
    expect(port.gets).toEqual([]);
    for (const r of [pre, up, down]) {
      const text = JSON.stringify(r);
      expect(text).not.toContain('222222222222');
      expect(text).not.toContain(PERSONAL);
    }
  });

  it('올라가는 내용에는 토큰·회사 이름이 없고, 화면으로 가는 결과에 자격 증명 같은 값이 없다', async () => {
    const port = new Port(PERSONAL);
    const { service } = make(GOOD, port);
    await service.apply({ kind: 'add', title: `Acme Corp ${ghToken}`, memo: `로그 ${ghToken} Acme Corp`, screen: ghToken });
    const pre = await service.preview();
    if (!pre.ok) throw new Error(pre.error);
    const up = await service.upload(pre.digest);
    expect(up.ok).toBe(true);
    expect(port.puts.length).toBe(1);
    expect(port.puts[0]).not.toContain(ghToken);
    expect(port.puts[0]).not.toMatch(/acme/i);
    const shown = JSON.stringify([pre, up]);
    expect(shown).not.toMatch(/secret|credential|accessKey|sessionToken/i);
  });

  it('받기: 이상한 이름·번호가 다른 파일·거대한 파일·깨진 파일은 건너뛰고, 파일 수는 상한까지만 읽는다', async () => {
    const good = JSON.stringify({ id: 'ok1', title: 't', memo: '', screen: '', appVersion: '', os: '', createdAt: NOW, updatedAt: NOW, status: 'open', uploaded: true });
    const files: Record<string, string> = {
      'bug-notes/ok1.json': good,
      'bug-notes/other.json': good,
      'bug-notes/big.json': JSON.stringify({ id: 'big', title: 't', memo: 'x'.repeat(100_000), createdAt: NOW, status: 'open' }),
      'bug-notes/broken.json': '{nope',
    };
    const extra = ['../../etc/passwd', 'bug-notes/../x.json', 'other-prefix/x.json', ...Array.from({ length: DOWNLOAD_MAX_FILES + 100 }, (_, i) => `bug-notes/n${i}.json`)];
    const port = new Port(PERSONAL, files, extra);
    const { service } = make(GOOD, port);
    const r = await service.download();
    if (!r.ok) throw new Error(r.error);
    expect(r.state.items.map((i) => i.id)).toEqual(['ok1']);
    expect(port.gets.length).toBeLessThanOrEqual(DOWNLOAD_MAX_FILES);
    expect(port.gets.some((k) => k.includes('..') || !k.startsWith('bug-notes/'))).toBe(false);
  });

  it('받아온 메모가 내 메모의 글을 덮어쓰지 못한다(상태만 합친다)', async () => {
    const port = new Port(PERSONAL, {
      'bug-notes/id1.json': JSON.stringify({ id: 'id1', title: 'EVIL TITLE', memo: 'EVIL', screen: '', appVersion: '', os: '', createdAt: NOW, updatedAt: '2030-01-01T00:00:00.000Z', status: 'done', uploaded: true }),
    });
    const { service } = make(GOOD, port);
    await service.apply({ kind: 'add', title: 'mine', memo: 'mine', screen: '' });
    const r = await service.download();
    if (!r.ok) throw new Error(r.error);
    expect(r.state.items[0]).toMatchObject({ id: 'id1', title: 'mine', memo: 'mine', status: 'done' });
  });

  it('올리기 IPC에 문자열이 아닌 지문이 와도(서비스는 빈 문자열로 받는다) 아무것도 올라가지 않는다', async () => {
    const port = new Port(PERSONAL);
    const { service } = make(GOOD, port);
    await service.apply({ kind: 'add', title: 't', memo: '', screen: '' });
    for (const digest of ['', 'x', '0'.repeat(8), '\0']) expect((await service.upload(digest)).ok).toBe(false);
    expect(port.puts).toEqual([]);
  });

  it('요청 인자가 이상해도 던지지 않고 오류 글로 돌려준다', async () => {
    const port = new Port(PERSONAL);
    const { service } = make(GOOD, port);
    for (const bad of [null, undefined, 1, 'x', [], {}, { kind: 'add', title: 7 }, { kind: 'remove', id: '__proto__' }, { kind: 'add', title: 'x'.repeat(10_000) }]) {
      const r = await service.apply(bad);
      expect(r.ok, JSON.stringify(bad)).toBe(false);
    }
  });
});
