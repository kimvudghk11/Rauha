import { describe, expect, it } from 'vitest';
import { MAX_FILES, RecordBook, RecordEntry, RecordError, scrub, type RecordFilter, type RecordInput } from './record-book.js';

const base = (over: Partial<RecordInput> = {}): RecordInput => ({
  id: 'job-1',
  request: '결제 타임아웃 원인 찾아줘',
  result: '원인은 커넥션 풀 고갈이에요. 풀 크기를 늘리고 재시도를 줄였어요.',
  status: 'done',
  stopReason: null,
  roles: ['디버거', '구현 팀원'],
  stages: ['원인 찾기', '고치기', '리뷰'],
  queuedAt: '2026-11-08T01:00:00.000Z',
  endedAt: '2026-11-08T01:12:30.000Z',
  repo: 'api-server',
  files: ['src/pool.ts', 'src/retry.ts'],
  approvals: [],
  direction: null,
  ...over,
});
const none: RecordFilter = { text: '', tag: null, status: 'all', repo: null, divergedOnly: false, since: null };

describe('기록에는 요약만 남는다', () => {
  it('토큰·키·비밀번호 모양의 값은 가린다', () => {
    const secrets = [
      'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789',
      'AKIAIOSFODNN7EXAMPLE',
      'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
      'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop',
      'password=hunter2hunter2',
      'https://user:pass1234@db.example.com/x',
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----',
    ];
    for (const s of secrets) {
      const out = scrub(`앞 ${s} 뒤`);
      expect(out).toContain('가림');
      expect(out).not.toContain('abcdefghijklmnopqrstuvwxyz');
      expect(out).not.toContain('hunter2');
      expect(out).not.toContain('pass1234');
      expect(out).not.toContain('MIIEow');
      expect(out).not.toContain('AKIAIOSFODNN7EXAMPLE');
    }
  });

  it('달러 금액은 남기지 않는다', () => {
    const out = scrub('이번 호출은 $12.50 들었고 총 US$ 3 입니다');
    expect(out).not.toMatch(/\$\s?\d/);
    expect(out).toContain('금액 생략');
  });

  it('코드 블록은 "코드 생략"으로 바꾼다', () => {
    expect(scrub('고쳤어요\n```ts\nconst a = 1;\nconst b = 2;\n```\n끝')).toBe('고쳤어요\n(코드 생략)\n끝');
  });

  it('결과 요약은 600자·12줄까지만 남긴다(전체 로그를 넣지 않는다)', () => {
    const long = RecordEntry.capture(base({ result: Array.from({ length: 40 }, (_, i) => `로그 줄 ${i}`).join('\n') }));
    expect(long.summary.split('\n').length).toBeLessThanOrEqual(13);
    expect(long.summary).toContain('줄임');
    const wide = RecordEntry.capture(base({ result: '가'.repeat(2000) }));
    expect(wide.summary.length).toBeLessThanOrEqual(620);
  });

  it('요청 글도 비밀을 가리고 200자까지만 남긴다', () => {
    const e = RecordEntry.capture(base({ request: `token=abcd1234efgh5678 로 접속해 ${'가'.repeat(400)}` }));
    expect(e.request).not.toContain('abcd1234efgh5678');
    expect(e.request.length).toBeLessThanOrEqual(201);
  });

  it('비밀 파일 이름은 남기지 않고 몇 개였는지만 센다', () => {
    const e = RecordEntry.capture(base({ files: ['src/a.ts', '.env', 'config/.env.local', 'certs/server.pem', 'id_rsa', 'src/b.ts'] }));
    expect(e.files).toEqual(['src/a.ts', 'src/b.ts']);
    expect(e.hiddenFiles).toBe(4);
  });

  it('바뀐 파일은 상한까지만 남기고 나머지는 개수로 알린다', () => {
    const files = Array.from({ length: MAX_FILES + 7 }, (_, i) => `src/f${i}.ts`);
    const e = RecordEntry.capture(base({ files }));
    expect(e.files).toHaveLength(MAX_FILES);
    expect(e.moreFiles).toBe(7);
  });

  it('허락 기록에는 명령 원문이 아니라 요약·결정·이유만 남는다', () => {
    const e = RecordEntry.capture(
      base({ approvals: [{ tool: 'Bash', headline: 'main 브랜치에 push', reason: '배포 전 반영', decision: 'once', note: null, at: '2026-11-08T01:05:00.000Z' }] }),
    );
    expect(e.approvals[0]).toEqual({ tool: 'Bash', headline: 'main 브랜치에 push', reason: '배포 전 반영', decision: 'once', note: null, at: '2026-11-08T01:05:00.000Z' });
    expect(Object.keys(e.approvals[0]!)).not.toContain('detail');
  });
});

describe('기록 항목', () => {
  it('요청이 비면 만들지 않는다', () => {
    expect(() => RecordEntry.capture(base({ request: '   ' }))).toThrow(RecordError);
  });

  it('끝난 작업만 기록이 된다', () => {
    expect(() => RecordEntry.capture(base({ status: 'running' as never }))).toThrow(/끝난/);
  });

  it('걸린 시간은 초로 알려 주고, 시각이 이상하면 모른다(null)', () => {
    expect(RecordEntry.capture(base()).durationSeconds()).toBe(750);
    expect(RecordEntry.capture(base({ queuedAt: '언젠가' })).durationSeconds()).toBeNull();
    expect(RecordEntry.capture(base({ endedAt: '2026-11-07T00:00:00.000Z' })).durationSeconds()).toBeNull();
  });

  it('결과 글이 없으면 요약은 "모름"이다', () => {
    expect(RecordEntry.capture(base({ result: null })).summary).toBe('모름');
    expect(RecordEntry.capture(base({ result: '  ' })).summary).toBe('모름');
  });

  it('멈춘 작업은 멈춘 이유가 남는다', () => {
    const e = RecordEntry.capture(base({ status: 'stopped', stopReason: '내가 멈췄어요' }));
    expect(e.status).toBe('stopped');
    expect(e.stopReason).toBe('내가 멈췄어요');
  });
});

describe('사용자와 AI의 방향이 다른지', () => {
  it('AI 추천과 내가 고른 것이 다르면 "다르게 골랐다"', () => {
    const e = RecordEntry.capture(base({ direction: { recommended: '인덱스 추가', chosen: '배치 분할', reason: '월말에 또 느려져요' } }));
    expect(e.divergedFromAi()).toBe(true);
    expect(e.direction).toEqual({ recommended: '인덱스 추가', chosen: '배치 분할', reason: '월말에 또 느려져요' });
  });

  it('같으면 다르지 않다', () => {
    expect(RecordEntry.capture(base({ direction: { recommended: 'A', chosen: 'A', reason: null } })).divergedFromAi()).toBe(false);
    expect(RecordEntry.capture(base()).divergedFromAi()).toBe(false);
  });

  it('허락 때 "이렇게 바꿔 줘"라고 고쳐 달라 했으면 다르게 이끈 것으로 본다', () => {
    const e = RecordEntry.capture(base({ approvals: [{ tool: 'Bash', headline: '배포', reason: '', decision: 'revise', note: 'qa에 먼저', at: '2026-11-08T01:05:00.000Z' }] }));
    expect(e.divergedFromAi()).toBe(true);
  });
});

describe('태그', () => {
  const tagsOf = (request: string, result = '') => RecordEntry.capture(base({ request, result })).tags;

  it('오류·원인을 다룬 일은 트러블슈팅이다', () => {
    expect(tagsOf('결제 타임아웃 원인 찾아줘')).toContain('troubleshooting');
    expect(tagsOf('배포가 실패해요')).toContain('troubleshooting');
  });

  it('VPC·서브넷·보안 그룹 같은 일은 네트워크 구성이다', () => {
    expect(tagsOf('VPC 피어링 정리해줘')).toContain('network');
    expect(tagsOf('보안 그룹 규칙 점검')).toContain('network');
  });

  it('여러 태그가 함께 붙을 수 있다', () => {
    const tags = tagsOf('ALB 타임아웃 원인과 서브넷 구성');
    expect(tags).toContain('troubleshooting');
    expect(tags).toContain('network');
  });

  it('맞는 것이 없으면 "기타"다', () => {
    expect(tagsOf('안녕', '')).toEqual(['etc']);
  });

  it('내가 고르면 그 태그로 바뀌고, 모르는 태그나 빈 선택은 거절한다', () => {
    const e = RecordEntry.capture(base());
    expect(e.withTags(['design', 'network']).tags).toEqual(['design', 'network']);
    expect(() => e.withTags(['아무거나' as never])).toThrow(RecordError);
    expect(() => e.withTags([])).toThrow(/하나/);
  });

  it('메모는 비밀을 가리고 500자까지만 남긴다', () => {
    const e = RecordEntry.capture(base()).withMemo(`면접에서 말할 것 password=abc12345 ${'가'.repeat(600)}`);
    expect(e.memo).not.toContain('abc12345');
    expect(e.memo.length).toBeLessThanOrEqual(500);
  });
});

describe('기록 모음', () => {
  const entry = (id: string, over: Partial<RecordInput> = {}) => RecordEntry.capture(base({ id, ...over }));

  it('끝난 시각이 늦은 것이 위에 온다', () => {
    const book = RecordBook.empty().add(entry('a', { endedAt: '2026-11-06T01:00:00.000Z', queuedAt: '2026-11-06T00:00:00.000Z' })).add(entry('b', { endedAt: '2026-11-08T01:00:00.000Z' }));
    expect(book.entries.map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('같은 작업은 두 번 기록되지 않는다', () => {
    const book = RecordBook.empty().add(entry('a'));
    expect(book.add(entry('a', { request: '다른 글' }))).toBe(book);
    expect(book.has('a')).toBe(true);
  });

  it('글자 검색은 요청·요약·메모·파일·팀·태그 이름을 훑는다', () => {
    const book = RecordBook.empty()
      .add(entry('a', { request: '로그인 문구 수정', result: '문구를 바꿨어요', files: ['app/login.tsx'], roles: ['구현 팀원'] }))
      .add(entry('b', { request: 'VPC 피어링 정리', result: '표로 정리했어요', files: [], roles: ['운영 팀원'] }));
    const ids = (text: string) => book.view({ ...none, text }).map((e) => e.id);
    expect(ids('로그인')).toEqual(['a']);
    expect(ids('표로')).toEqual(['b']);
    expect(ids('login.tsx')).toEqual(['a']);
    expect(ids('운영 팀원')).toEqual(['b']);
    expect(ids('네트워크')).toEqual(['b']);
    expect(ids('  ')).toHaveLength(2);
  });

  it('태그·상태·레포·"다르게 골랐다"·기간으로 거른다', () => {
    const book = RecordBook.empty()
      .add(entry('a', { repo: 'x', endedAt: '2026-11-01T01:00:00.000Z', queuedAt: '2026-11-01T00:00:00.000Z' }))
      .add(entry('b', { repo: 'y', status: 'stopped', stopReason: '멈춤', request: 'VPC 정리' }))
      .add(entry('c', { repo: 'y', direction: { recommended: 'A', chosen: 'B', reason: null }, request: '설계' }));
    expect(book.view({ ...none, status: 'stopped' }).map((e) => e.id)).toEqual(['b']);
    expect(book.view({ ...none, repo: 'y' }).map((e) => e.id).sort()).toEqual(['b', 'c']);
    expect(book.view({ ...none, divergedOnly: true }).map((e) => e.id)).toEqual(['c']);
    expect(book.view({ ...none, tag: 'network' }).map((e) => e.id)).toEqual(['b']);
    expect(book.view({ ...none, since: '2026-11-05T00:00:00.000Z' }).map((e) => e.id).sort()).toEqual(['b', 'c']);
  });

  it('태그별 개수와 레포 목록을 알려 준다', () => {
    const book = RecordBook.empty().add(entry('a')).add(entry('b', { request: 'VPC 정리', repo: null }));
    expect(book.tagCounts().troubleshooting).toBe(1);
    expect(book.tagCounts().network).toBe(1);
    expect(book.repos()).toEqual(['api-server']);
  });

  it('태그·메모를 고치고 지울 수 있다', () => {
    const book = RecordBook.empty().add(entry('a'));
    expect(book.setTags('a', ['design']).get('a')!.tags).toEqual(['design']);
    expect(book.setMemo('a', '메모').get('a')!.memo).toBe('메모');
    expect(book.remove('a').entries).toEqual([]);
    expect(() => book.setTags('없음', ['design'])).toThrow(/찾지 못/);
    expect(() => book.remove('없음')).toThrow(RecordError);
  });

  it('상한을 넘으면 오래된 것이 넘친 몫으로 나뉜다(그냥 버리지 않고 보관하게)', () => {
    let book = RecordBook.empty();
    for (let i = 0; i < 5; i += 1) book = book.add(entry(`e${i}`, { endedAt: `2026-11-0${i + 1}T01:00:00.000Z`, queuedAt: `2026-11-0${i + 1}T00:00:00.000Z` }));
    const { kept, overflow } = book.trimmed(3);
    expect(kept.entries.map((e) => e.id)).toEqual(['e4', 'e3', 'e2']);
    expect(overflow.map((e) => e.id)).toEqual(['e1', 'e0']);
  });
});
