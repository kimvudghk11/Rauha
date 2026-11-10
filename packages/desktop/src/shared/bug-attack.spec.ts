import { describe, expect, it } from 'vitest';
import { BugNote } from './bug-note.js';
import { BugNoteDto, BugOpDto } from './bug-note-dto.js';
import { AwsTarget, idOfKey, parseDownloaded, planUpload } from './bug-sync.js';
import type { RedactContext } from './blog-redact.js';

const ctx: RedactContext = { repoNames: ['payroll-core'], companyNames: ['Acme Corp'], userName: 'kimtester', homePath: 'C:/Users/kimtester' };
// 시험용 가짜 비밀: 조각을 이어붙여 만든다
const ghToken = ['gh', 'p_', 'a'.repeat(30)].join('');
const NOW = '2026-11-11T00:00:00.000Z';
const note = (over: Partial<Parameters<typeof BugNote.create>[0]> = {}): BugNote => BugNote.create({ title: 't', memo: '', screen: 'Repo', appVersion: '0.1.11', os: 'win32 10', ...over }, 'n1', NOW);

describe('리포트 올리기 가림', () => {
  it('화면 이름·앱 버전·OS 칸에 든 비밀도 올라가지 않는다', () => {
    const plan = planUpload([note({ screen: ghToken, appVersion: 'Acme Corp', os: 'C:/Users/kimtester/x' })], ctx);
    const body = plan.items[0]!.body;
    expect(body).not.toContain(ghToken);
    expect(body).not.toMatch(/acme|kimtester/i);
  });

  it('제목·메모에 눈에 안 보이는 글자를 끼운 비밀도 올라가지 않는다', () => {
    const split = ghToken.slice(0, 10) + '\u200b' + ghToken.slice(10);
    const plan = planUpload([note({ title: `x ${split}`, memo: `Ac\u200bme Corp ${split}` })], ctx);
    const body = plan.items[0]!.body;
    expect(body).not.toMatch(/acme/i);
    expect(body).not.toContain(ghToken.slice(10));
  });
});

describe('리포트 계정 확인 우회 시도', () => {
  const base = { profile: 'personal', bucket: 'my-bucket-1', region: 'ap-northeast-2', account: '123456789012' };
  const make = (over: Partial<typeof base> = {}) => AwsTarget.from({ ...base, ...over });

  it('프로필 이름이 비었거나 공백뿐이거나 이상한 글자면 대상이 만들어지지 않는다(default를 대신 쓰지 않는다)', () => {
    for (const profile of ['', '   ', '\t', 'a b', 'a;b', 'a\nb', '../x', 'x'.repeat(65), 'p\u200bq', '프로필']) {
      expect(make({ profile }).ok, JSON.stringify(profile)).toBe(false);
    }
    expect(AwsTarget.from({ ...base, profile: null }).ok).toBe(false);
  });

  it('계정 번호가 12자리 숫자가 아니면 만들어지지 않는다(전각·하이픈·긴 숫자)', () => {
    for (const account of ['12345678901', '1234567890123', '１２３４５６７８９０１２', '1234-5678-9012', '12345678901a', 'abcdefghijkl', '']) {
      expect(make({ account }).ok, account).toBe(false);
    }
  });

  it('버킷·리전 모양이 틀리면 만들어지지 않는다', () => {
    for (const bucket of ['', 'A-Bucket', 'a', '-ab', 'ab-', 'my_bucket', 'x'.repeat(64), 'a/b', 'a b']) expect(make({ bucket }).ok, bucket).toBe(false);
    for (const region of ['', 'korea', 'AP-NORTHEAST-2', 'ap-northeast-22']) expect(make({ region }).ok, region).toBe(false);
  });

  it('실제 계정이 다르면 어떤 모양이든 막힌다(번호 전체는 메시지에 나오지 않는다)', () => {
    const r = make();
    if (!r.ok) throw new Error('target');
    for (const other of ['123456789013', '', ' 123456789012', '123456789012 ', '0123456789012', 'undefined', '１２３４５６７８９０１２']) {
      expect(() => r.target.assertAccount(other), JSON.stringify(other)).toThrow();
    }
    expect(() => r.target.assertAccount('123456789012')).not.toThrow();
    const why = r.target.mismatch('999999999999') ?? '';
    expect(why).not.toContain('123456789012');
    expect(why).not.toContain('999999999999');
  });
});

describe('받아온 메모·IPC 인자 공격', () => {
  const good = { id: 'abc', title: 't', memo: '', screen: '', appVersion: '', os: '', createdAt: NOW, updatedAt: NOW, status: 'open', uploaded: true };

  it('저장소 파일 이름은 우리 모양(bug-notes/<id>.json)만 인정한다', () => {
    for (const k of ['bug-notes/../x.json', 'bug-notes/a/b.json', 'bug-notes/.json', 'bug-notes/a.json.bak', 'x/bug-notes/a.json', 'bug-notes/a b.json', 'bug-notes/a%2fb.json', `bug-notes/${'a'.repeat(65)}.json`]) {
      expect(idOfKey(k), k).toBeNull();
    }
  });

  it('받은 파일의 번호가 파일 이름과 다르거나, 깨졌거나, 너무 크면 건너뛴다', () => {
    expect(parseDownloaded('bug-notes/abc.json', JSON.stringify(good))?.id).toBe('abc');
    expect(parseDownloaded('bug-notes/zzz.json', JSON.stringify(good))).toBeNull();
    expect(parseDownloaded('bug-notes/abc.json', '{broken')).toBeNull();
    expect(parseDownloaded('bug-notes/abc.json', 'null')).toBeNull();
    expect(parseDownloaded('bug-notes/abc.json', '[]')).toBeNull();
    expect(parseDownloaded('bug-notes/abc.json', JSON.stringify({ ...good, memo: 'x'.repeat(70_000) }))).toBeNull();
    expect(parseDownloaded('bug-notes/abc.json', JSON.stringify({ ...good, title: 7 }))).toBeNull();
    expect(parseDownloaded('bug-notes/abc.json', JSON.stringify({ ...good, status: '__proto__' }))).toBeNull();
    expect(parseDownloaded('bug-notes/abc.json', JSON.stringify({ ...good, createdAt: 'not a date' }))).toBeNull();
  });

  it('__proto__ 번호의 메모와 덧붙은 속성은 전역 객체를 오염시키지 않는다', () => {
    const raw = JSON.parse('{"id":"__proto__","title":"t","memo":"","status":"open","createdAt":"2026-11-11T00:00:00.000Z","__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":1}}}') as unknown;
    const dto = BugNoteDto.from(raw);
    expect(dto.toEntity().id).toBe('__proto__');
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(Object.keys(dto.toJSON()).sort()).toEqual(['appVersion', 'createdAt', 'id', 'memo', 'os', 'screen', 'status', 'title', 'updatedAt', 'uploaded']);
  });

  it('화면이 보내는 요청의 모양이 틀리면 거절한다', () => {
    for (const bad of [null, undefined, 7, 'add', [], {}, { kind: 'drop' }, { kind: 'add' }, { kind: 'add', title: 1 }, { kind: 'remove' }, { kind: 'remove', id: 5 }, { kind: 'resolve', id: {} }, { kind: ['add'] }]) {
      expect(() => BugOpDto.from(bad), JSON.stringify(bad)).toThrow();
    }
    expect(BugOpDto.from({ kind: 'add', title: 'x', evil: '<img>' }).op).toEqual({ kind: 'add', title: 'x', memo: '', screen: '' });
  });

  it('메모 글자 수 한계(제목 80·메모 2000)를 넘기면 만들 수 없다', () => {
    expect(() => note({ title: 'x'.repeat(81) })).toThrow();
    expect(() => note({ memo: 'x'.repeat(2001) })).toThrow();
    expect(note({ screen: 'x'.repeat(5000) }).toProps().screen.length).toBe(40);
  });
});
