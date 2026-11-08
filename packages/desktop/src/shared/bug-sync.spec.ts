import { describe, expect, it } from 'vitest';
import { BugNote } from './bug-note.js';
import { AwsTarget, digestOf, idOfKey, key, parseDownloaded, planUpload, syncBlockReason, type AwsInput } from './bug-sync.js';

const GOOD: AwsInput = { profile: 'test-profile', bucket: 'example-bucket', region: 'ap-northeast-2', account: '000000000000' };
const CTX = { repoNames: [], companyNames: ['악메상사'], userName: 'tester', homePath: '/Users/tester' };
const note = (id: string, title: string, memo = ''): BugNote => BugNote.create({ title, memo, screen: 'chat', appVersion: '0.1.8', os: 'win32' }, id, '2026-11-09T01:00:00.000Z');

describe('내 AWS 올리기 대상', () => {
  it('프로필 이름을 적기 전에는 대상을 만들 수 없다', () => {
    expect(AwsTarget.from({ ...GOOD, profile: null })).toMatchObject({ ok: false });
    expect(AwsTarget.from({ ...GOOD, profile: '   ' })).toMatchObject({ ok: false });
  });

  it('프로필 이름이 비어 있으면 이유를 설정 칸에 보여 줄 수 있다', () => {
    expect(syncBlockReason({ ...GOOD, profile: null })).toContain('프로필 이름');
    expect(syncBlockReason(GOOD)).toBeNull();
  });

  it('계정 번호는 숫자 12자리여야 한다', () => {
    expect(AwsTarget.from({ ...GOOD, account: '12345' })).toMatchObject({ ok: false });
    expect(AwsTarget.from({ ...GOOD, account: 'abcdefghijkl' })).toMatchObject({ ok: false });
  });

  it('버킷 이름과 리전 모양이 틀리면 만들 수 없다', () => {
    expect(AwsTarget.from({ ...GOOD, bucket: 'Bad Bucket' })).toMatchObject({ ok: false });
    expect(AwsTarget.from({ ...GOOD, region: 'seoul' })).toMatchObject({ ok: false });
  });

  it('프로필 이름에 경로나 공백이 들어가면 막는다', () => {
    expect(AwsTarget.from({ ...GOOD, profile: '../x' })).toMatchObject({ ok: false });
    expect(AwsTarget.from({ ...GOOD, profile: 'a b' })).toMatchObject({ ok: false });
  });

  it('실제 계정이 등록한 개인 계정과 같으면 통과한다', () => {
    const r = AwsTarget.from(GOOD);
    if (!r.ok) throw new Error('대상이 만들어져야 한다');
    expect(r.target.mismatch('000000000000')).toBeNull();
  });

  it('실제 계정이 다르면 막고, 이유에는 계정 번호 끝 4자리만 보인다', () => {
    const r = AwsTarget.from(GOOD);
    if (!r.ok) throw new Error('대상이 만들어져야 한다');
    const reason = r.target.mismatch('111122223333') ?? '';
    expect(reason).toContain('3333');
    expect(reason).not.toContain('111122223333');
    expect(reason).not.toContain('000000000000');
  });
});

describe('저장소 키', () => {
  it('키는 bug-notes/<번호>.json 이다', () => {
    expect(key('abc-1')).toBe('bug-notes/abc-1.json');
    expect(idOfKey('bug-notes/abc-1.json')).toBe('abc-1');
  });

  it('우리 모양이 아닌 키는 번호가 없다', () => {
    expect(idOfKey('bug-notes/../x.json')).toBeNull();
    expect(idOfKey('other/abc.json')).toBeNull();
    expect(idOfKey('bug-notes/a/b.json')).toBeNull();
  });
});

describe('올리기 전 가림', () => {
  it('회사 이름·이메일·도메인·IP·키를 가린 내용만 올릴 글에 들어간다', () => {
    const plan = planUpload([note('a', '악메상사 결제 오류', '담당 kim@acme-corp.com 서버 10.1.2.3 api.acme-corp.com 키 AKIAIOSFODNN7EXAMPLE')], CTX);
    const item = plan.items[0]!;
    expect(item.title).not.toContain('악메상사');
    for (const secret of ['kim@acme-corp.com', '10.1.2.3', 'acme-corp.com', 'AKIAIOSFODNN7EXAMPLE', '악메상사']) {
      expect(item.memo).not.toContain(secret);
      expect(item.body).not.toContain(secret);
    }
    expect(item.redactions).toBeGreaterThanOrEqual(4);
  });

  it('가릴 것이 없으면 글이 그대로이고 가림 수는 0이다', () => {
    const item = planUpload([note('a', '저장 버튼이 안 눌려요', '기록 탭에서')], CTX).items[0]!;
    expect(item.title).toBe('저장 버튼이 안 눌려요');
    expect(item.redactions).toBe(0);
  });

  it('올릴 파일에는 앱 버전·OS·화면이 남고 올림 표시가 켜져 있다', () => {
    const body = JSON.parse(planUpload([note('a', '제목')], CTX).items[0]!.body) as Record<string, unknown>;
    expect(body).toMatchObject({ version: 1, id: 'a', screen: 'chat', appVersion: '0.1.8', os: 'win32', uploaded: true });
  });

  it('미리보기 뒤에 글이 바뀌면 지문이 달라진다', () => {
    const before = planUpload([note('a', '제목')], CTX).digest;
    expect(planUpload([note('a', '제목')], CTX).digest).toBe(before);
    expect(planUpload([note('a', '다른 제목')], CTX).digest).not.toBe(before);
  });

  it('지문은 같은 글에 같고 다른 글에 다르다', () => {
    expect(digestOf('a')).toBe(digestOf('a'));
    expect(digestOf('a')).not.toBe(digestOf('b'));
  });
});

describe('받아온 파일 읽기', () => {
  const body = JSON.parse(planUpload([note('a', '제목')], CTX).items[0]!.body) as Record<string, unknown>;

  it('우리 모양의 파일은 메모가 된다', () => {
    expect(parseDownloaded('bug-notes/a.json', JSON.stringify(body))?.title).toBe('제목');
  });

  it('파일 이름의 번호와 안의 번호가 다르면 건너뛴다', () => {
    expect(parseDownloaded('bug-notes/b.json', JSON.stringify(body))).toBeNull();
  });

  it('깨진 글이나 너무 큰 파일은 건너뛴다', () => {
    expect(parseDownloaded('bug-notes/a.json', '{ 깨짐')).toBeNull();
    expect(parseDownloaded('bug-notes/a.json', 'x'.repeat(70 * 1024))).toBeNull();
  });
});
