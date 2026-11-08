import { describe, expect, it } from 'vitest';
import { RecordBookDto, RecordDto, RecordOpDto, durationText } from './record-dto.js';
import { RecordBook, RecordEntry, RecordError, type RecordInput } from './record-book.js';

const input = (id: string, over: Partial<RecordInput> = {}): RecordInput => ({
  id,
  request: '결제 타임아웃 원인 찾아줘',
  result: '풀 크기를 늘렸어요.',
  status: 'done',
  stopReason: null,
  roles: ['디버거'],
  stages: ['원인 찾기', '고치기'],
  queuedAt: '2026-11-08T01:00:00.000Z',
  endedAt: '2026-11-08T01:12:30.000Z',
  repo: 'api-server',
  files: ['src/pool.ts'],
  approvals: [{ tool: 'Bash', headline: 'main 브랜치에 push', reason: '배포 전 반영', decision: 'once', note: null, at: '2026-11-08T01:05:00.000Z' }],
  direction: { recommended: '인덱스', chosen: '배치 분할', reason: '임시방편이라서' },
  ...over,
});

describe('기록 저장 모양', () => {
  it('저장했다 읽어도 같다(태그·메모 포함)', () => {
    const book = RecordBook.empty().add(RecordEntry.capture(input('a')).withTags(['design']).withMemo('면접 때 말할 것'));
    const json = RecordBookDto.fromEntity(book).toJSON();
    const back = RecordBookDto.from(JSON.parse(JSON.stringify(json))).toEntity();
    expect(RecordBookDto.fromEntity(back).toJSON()).toEqual(json);
  });

  it('깨진 항목은 건너뛰고 몇 개인지 알려 준다', () => {
    const ok = RecordBookDto.fromEntity(RecordBook.empty().add(RecordEntry.capture(input('a')))).toJSON().entries[0]!;
    const dto = RecordBookDto.from({ entries: [ok, { id: 'x' }, 7, { ...ok, id: 'y', status: 'running' }, { ...ok, id: 'z', tags: ['이상한'] }] });
    expect(dto.toEntity().entries.map((e) => e.id)).toEqual(['a']);
    expect(dto.skipped).toBe(4);
  });

  it('손으로 고쳐 비밀이 섞인 파일도 읽을 때 다시 가린다', () => {
    const ok = RecordBookDto.fromEntity(RecordBook.empty().add(RecordEntry.capture(input('a')))).toJSON().entries[0]!;
    const dirty = { ...ok, summary: '키는 password=hunter2hunter2 예요', files: ['.env', 'a.ts'] };
    const entry = RecordBookDto.from({ entries: [dirty] }).toEntity().entries[0]!;
    expect(entry.summary).not.toContain('hunter2');
    expect(entry.files).toEqual(['a.ts']);
  });

  it('같은 번호는 한 번만 읽는다', () => {
    const ok = RecordBookDto.fromEntity(RecordBook.empty().add(RecordEntry.capture(input('a')))).toJSON().entries[0]!;
    expect(RecordBookDto.from({ entries: [ok, ok] }).toEntity().entries).toHaveLength(1);
  });
});

describe('화면에서 온 기록 요청', () => {
  it('태그·메모·지우기를 알아보고 적용한다', () => {
    const book = RecordBook.empty().add(RecordEntry.capture(input('a')));
    expect(RecordOpDto.from({ kind: 'tags', id: 'a', tags: ['network'] }).applyTo(book).get('a')!.tags).toEqual(['network']);
    expect(RecordOpDto.from({ kind: 'memo', id: 'a', memo: '메모' }).applyTo(book).get('a')!.memo).toBe('메모');
    expect(RecordOpDto.from({ kind: 'remove', id: 'a' }).applyTo(book).entries).toEqual([]);
  });

  it('모양이 틀리면 거절한다', () => {
    expect(() => RecordOpDto.from({ kind: 'tags', id: 'a', tags: 'network' })).toThrow(RecordError);
    expect(() => RecordOpDto.from({ kind: 'memo', id: 'a' })).toThrow(RecordError);
    expect(() => RecordOpDto.from({ kind: 'wipe' })).toThrow(RecordError);
    expect(() => RecordOpDto.from(null)).toThrow(RecordError);
  });
});

describe('걸린 시간 글', () => {
  it('초를 사람이 읽는 글로 바꾸고, 모르면 "모름"', () => {
    expect(durationText(45)).toBe('45초');
    expect(durationText(750)).toBe('12분 30초');
    expect(durationText(3900)).toBe('1시간 5분');
    expect(durationText(null)).toBe('모름');
  });
});

describe('마크다운으로 뽑기(포트폴리오·이력서 정리용)', () => {
  const md = RecordDto.toMarkdown(RecordEntry.capture(input('a')).withMemo('면접 때 말할 것'));

  it('문제·접근·방향·허락·파일·메모가 모두 들어 있다', () => {
    expect(md).toContain('## 결제 타임아웃 원인 찾아줘');
    expect(md).toContain('트러블슈팅');
    expect(md).toContain('원인 찾기 → 고치기');
    expect(md).toContain('풀 크기를 늘렸어요.');
    expect(md).toContain('AI 추천: 인덱스');
    expect(md).toContain('내 선택: 배치 분할');
    expect(md).toContain('내가 다르게 골랐어요');
    expect(md).toContain('main 브랜치에 push');
    expect(md).toContain('한 번만 허락');
    expect(md).toContain('src/pool.ts');
    expect(md).toContain('면접 때 말할 것');
    expect(md).toContain('12분 30초');
  });

  it('달러 금액·비밀은 없다', () => {
    expect(md).not.toMatch(/\$\s?\d/);
  });

  it('모르는 값은 "모름"으로 적는다', () => {
    const unknown = RecordDto.toMarkdown(RecordEntry.capture(input('b', { result: null, queuedAt: '??', approvals: [], direction: null, files: [], roles: [], stages: [] })));
    expect(unknown).toContain('걸린 시간: 모름');
    expect(unknown).toContain('모름');
    expect(unknown).not.toContain('### 허락');
    expect(unknown).not.toContain('### 바뀐 파일');
  });
});

describe('기록 지우기 요청(여러 개를 하나씩 보낼 때)', () => {
  it('번호가 글자가 아니면(숫자·배열·객체·없음) 거절한다', () => {
    for (const id of [5, null, ['a'], { toString: () => 'a' }, undefined]) expect(() => RecordOpDto.from({ kind: 'remove', id })).toThrow(RecordError);
  });

  it('요청이 배열이거나 객체가 아니면 거절한다', () => {
    for (const bad of [null, 'a', 5, [], [{ kind: 'remove', id: 'a' }]]) expect(() => RecordOpDto.from(bad)).toThrow(RecordError);
  });

  it('없는 번호나 프로토타입 이름(__proto__)을 지우라 해도 다른 기록은 그대로다', () => {
    const book = RecordBook.empty().add(RecordEntry.capture(input('a')));
    for (const id of ['nope', '__proto__', 'constructor']) expect(() => RecordOpDto.from({ kind: 'remove', id }).applyTo(book)).toThrow(RecordError);
    expect(book.has('a')).toBe(true);
  });
});
