import { describe, expect, it } from 'vitest';
import { BugNote, BugNoteError, BugNoteList, BUG_MEMO_LIMIT, BUG_NOTES_MAX, BUG_TITLE_LIMIT } from './bug-note.js';
import { BugListDto, BugNoteDto, BugOpDto } from './bug-note-dto.js';

const T0 = '2026-11-09T01:00:00.000Z';
const T1 = '2026-11-09T02:00:00.000Z';
const T2 = '2026-11-09T03:00:00.000Z';
const draft = { title: '저장 버튼이 안 눌려요', memo: '기록 탭에서', screen: 'records', appVersion: '0.1.8', os: 'darwin 24' };
const make = (id: string, at = T0, over: Partial<typeof draft> = {}): BugNote => BugNote.create({ ...draft, ...over }, id, at);

describe('답답한 점 메모', () => {
  it('제목이 비어 있으면 만들 수 없다', () => {
    expect(() => make('a', T0, { title: '   ' })).toThrow(BugNoteError);
  });

  it('제목은 80자까지만 된다', () => {
    expect(() => make('a', T0, { title: 'ㄱ'.repeat(BUG_TITLE_LIMIT) })).not.toThrow();
    expect(() => make('a', T0, { title: 'ㄱ'.repeat(BUG_TITLE_LIMIT + 1) })).toThrow('80 characters');
  });

  it('메모는 2000자까지만 된다', () => {
    expect(() => make('a', T0, { memo: 'x'.repeat(BUG_MEMO_LIMIT + 1) })).toThrow(BugNoteError);
  });

  it('새 메모는 미해결이고 아직 올리지 않은 상태다', () => {
    const n = make('a');
    expect(n.status).toBe('open');
    expect(n.uploaded).toBe(false);
    expect(n.toProps()).toMatchObject({ screen: 'records', appVersion: '0.1.8', os: 'darwin 24', createdAt: T0, updatedAt: T0 });
  });

  it('해결하면 바뀐 시각이 갱신되고 다시 올려야 하는 상태가 된다', () => {
    const done = make('a').markUploaded().resolve(T1);
    expect(done.isDone()).toBe(true);
    expect(done.updatedAt).toBe(T1);
    expect(done.uploaded).toBe(false);
  });

  it('이미 해결한 메모를 또 해결해도 그대로다', () => {
    const done = make('a').resolve(T1);
    expect(done.resolve(T2)).toBe(done);
  });

  it('해결을 거두면 미해결로 돌아간다', () => {
    expect(make('a').resolve(T1).reopen(T2).status).toBe('open');
  });

  it('번호에 쓸 수 없는 글자가 있으면 열 수 없다(저장소 키로 쓰이기 때문)', () => {
    expect(() => make('../x')).toThrow(BugNoteError);
  });

  it('수정 요청 글에 제목·메모·화면·버전·OS가 들어간다', () => {
    const text = make('a').asRequest();
    expect(text).toContain('[답답한 점] 저장 버튼이 안 눌려요');
    expect(text).toContain('기록 탭에서');
    expect(text).toContain('records 화면 · v0.1.8 · darwin 24');
  });
});

describe('답답한 점 목록', () => {
  it('새로 적은 것이 위에 오고, 미해결과 해결로 나뉜다', () => {
    const list = BugNoteList.empty().add(make('a', T0)).add(make('b', T1)).resolve('a', T2);
    expect(list.items.map((n) => n.id)).toEqual(['b', 'a']);
    expect(list.open().map((n) => n.id)).toEqual(['b']);
    expect(list.done().map((n) => n.id)).toEqual(['a']);
  });

  it('없는 메모를 해결·삭제하려 하면 막는다', () => {
    expect(() => BugNoteList.empty().resolve('x', T0)).toThrow(BugNoteError);
    expect(() => BugNoteList.empty().remove('x')).toThrow(BugNoteError);
  });

  it('500개를 넘겨 더할 수 없다', () => {
    let list = BugNoteList.empty();
    for (let i = 0; i < BUG_NOTES_MAX; i++) list = list.add(make(`n${i}`));
    expect(() => list.add(make('extra'))).toThrow('500 notes');
  });

  it('올리지 않은 메모만 올릴 대상이 된다', () => {
    const list = BugNoteList.empty().add(make('a')).add(make('b', T1)).markUploaded([{ id: 'a', updatedAt: T0 }]);
    expect(list.pendingUpload().map((n) => n.id)).toEqual(['b']);
  });

  it('올리는 동안 바뀐 메모에는 올림 표시를 하지 않는다', () => {
    const list = BugNoteList.empty().add(make('a')).resolve('a', T2).markUploaded([{ id: 'a', updatedAt: T0 }]);
    expect(list.require('a').uploaded).toBe(false);
  });

  it('받아오기 뒤 새로 생긴 수와 상태가 바뀐 수를 센다', () => {
    const before = BugNoteList.empty().add(make('a'));
    const after = before.mergeRemote([make('a').resolve(T1), make('b')]);
    expect(after.changesSince(before)).toEqual({ added: 1, updated: 1 });
  });

  it('받아온 새 메모는 더하고 올림으로 본다', () => {
    const merged = BugNoteList.empty().mergeRemote([make('r')]);
    expect(merged.require('r').uploaded).toBe(true);
  });

  it('받아온 같은 번호의 상태가 더 최신이면 그 상태를 따른다', () => {
    const local = BugNoteList.empty().add(make('a'));
    const merged = local.mergeRemote([make('a').resolve(T1)]);
    expect(merged.require('a').status).toBe('done');
    expect(merged.require('a').uploaded).toBe(true);
  });

  it('이 컴퓨터의 상태가 더 최신이면 받아온 것으로 덮지 않고 다시 올릴 대상으로 남긴다', () => {
    const local = BugNoteList.empty().add(make('a').resolve(T2));
    const merged = local.mergeRemote([make('a').resolve(T1).reopen(T1)]);
    expect(merged.require('a').status).toBe('done');
    expect(merged.require('a').uploaded).toBe(false);
  });

  it('받아와도 이 컴퓨터에 적은 글은 바뀌지 않는다', () => {
    const local = BugNoteList.empty().add(make('a'));
    const merged = local.mergeRemote([make('a', T0, { title: '다른 제목' }).resolve(T1)]);
    expect(merged.require('a').title).toBe('저장 버튼이 안 눌려요');
  });

  it('받아온 메모가 같은 상태·시각이면 올림으로만 표시한다', () => {
    const merged = BugNoteList.empty().add(make('a')).mergeRemote([make('a')]);
    expect(merged.require('a').uploaded).toBe(true);
  });
});

describe('답답한 점 DTO', () => {
  it('저장했다 읽어도 같은 메모다', () => {
    const note = make('a').resolve(T1);
    expect(BugNoteDto.from(BugNoteDto.fromEntity(note).toJSON()).toEntity().toProps()).toEqual(note.toProps());
  });

  it('깨진 항목은 건너뛰고 몇 개인지 센다', () => {
    const good = BugNoteDto.fromEntity(make('a')).toJSON();
    const dto = BugListDto.from({ version: 1, items: [good, { id: 'b' }, 'x', { ...good, id: 'c', title: '' }] });
    expect(dto.items).toHaveLength(1);
    expect(dto.skipped).toBe(3);
  });

  it('목록이 아닌 파일은 빈 모음으로 읽고 건너뜀으로 센다', () => {
    const dto = BugListDto.from('엉뚱');
    expect(dto.toEntity().size).toBe(0);
    expect(dto.skipped).toBe(1);
  });

  it('화면 요청은 종류별로 검사한다', () => {
    expect(BugOpDto.from({ kind: 'add', title: 't' }).op).toEqual({ kind: 'add', title: 't', memo: '', screen: '' });
    expect(() => BugOpDto.from({ kind: 'resolve' })).toThrow(BugNoteError);
    expect(() => BugOpDto.from({ kind: 'drop' })).toThrow('Unknown');
    expect(() => BugOpDto.from(null)).toThrow(BugNoteError);
  });

  it('받아온 파일에 올림 값이 없어도 읽는다', () => {
    const { uploaded: _u, ...body } = BugNoteDto.fromEntity(make('a')).toJSON();
    expect(BugNoteDto.from(body).toEntity().uploaded).toBe(false);
  });
});
