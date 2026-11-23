import { describe, expect, it } from 'vitest';
import { TodoAsk, type TodoItem } from './todo-ask.js';

const item = (title: string, quote: string, due: string | null = null, source: string | null = null): TodoItem => ({ title, note: '', due, quote, source });

describe('할 일 정리 요청', () => {
  it('투두·todo list·할 일 정리·내일 업무 정리 같은 말을 알아본다', () => {
    for (const t of ['투두 정리해줘', 'todo list 만들어줘', '할 일 정리해줘', '할일 목록 만들어', '내일 업무 정리해줘', '이번 주 할 일 정리', '이거 할 일에 넣어줘', 'TODO 리스트']) expect(TodoAsk.asks(t)).toBe(true);
  });

  it('할 일 탭을 읽고 일하라는 말은 할 일 넣기가 아니다(할 일을 재료로 확인·처리하라는 요청)', () => {
    for (const t of [
      'todo에 있는 내용으로 지금 확인 가능한 내용은 확인해줘',
      '투두에 있는 거 확인해줘',
      '투두 확인해줘',
      '할 일 목록 보고 지금 할 수 있는 거 처리해줘',
      'todo 항목 중에 끝난 거 체크해줘',
      '투두 내용 검토해줘',
      '할 일에서 급한 것부터 해줘',
    ])
      expect(TodoAsk.asks(t), t).toBe(false);
  });

  it('할 일을 읽더라도 할 일 탭에 넣으라고 하면 넣기다', () => {
    for (const t of ['TODO.md 읽어서 할 일에 넣어줘', 'project/docs에 있는 todo 파일들 찾아서 라우하 todo에 넣어줘', '투두 내용 정리해서 할 일에 추가해줘']) expect(TodoAsk.asks(t), t).toBe(true);
  });

  it('코드의 TODO 주석 이야기나 다른 요청은 아니다', () => {
    for (const t of ['코드의 TODO 주석 정리해줘', 'FIXME 찾아줘', 'Money에 할인 넣어줘', '어제 한 일 정리']) expect(TodoAsk.asks(t)).toBe(false);
  });

  it('근거로 든 말이 사용자 말에 실제로 있는 항목만 남긴다(띄어쓰기·대소문자 무시)', () => {
    const said = ['내일 결제 API 리뷰하고, 오후에   배포 체크리스트 확인해야 해'];
    const kept = TodoAsk.keep([item('결제 API 리뷰', '결제 API 리뷰하고'), item('배포 체크리스트 확인', '배포 체크리스트 확인'), item('회의록 쓰기', '회의록 써야')], said);
    expect(kept.map((k) => k.title)).toEqual(['결제 API 리뷰', '배포 체크리스트 확인']);
  });

  it('같은 제목은 한 번, 날짜 모양이 틀리면 날짜 없이', () => {
    const kept = TodoAsk.keep([item('리뷰', '리뷰', '2026-11-19'), item(' 리뷰 ', '리뷰'), item('배포', '배포', '내일')], ['리뷰 배포']);
    expect(kept).toEqual([item('리뷰', '리뷰', '2026-11-19'), item('배포', '배포', null)]);
  });

  it('넣은 것과 근거가 없어 뺀 수를 알린다', () => {
    expect(TodoAsk.report([item('리뷰', '리뷰', '2026-11-19')], 1)).toBe('할 일 탭에 1개 넣었어요.\n- 리뷰 (2026-11-19)\n(근거를 확인하지 못한 1개는 넣지 않았어요.)');
    expect(TodoAsk.report([], 0)).toContain('찾지 못했어요');
  });

  it('파일·폴더를 가리키는 요청인지 알아본다(그러면 파일을 찾아 읽는다)', () => {
    for (const t of ['project/docs에 있는 todo 파일들 찾아서 라우하 todo에 넣어줘', 'TODO.md 읽어서 할 일에 넣어줘', '문서에 적힌 투두 넣어줘', '@docs 투두 정리']) expect(TodoAsk.fromFiles(t)).toBe(true);
    for (const t of ['투두 정리해줘', 'todo list 만들어줘', '내일 업무 정리해줘', 'to-do 정리']) expect(TodoAsk.fromFiles(t)).toBe(false);
  });

  it('파일에서 뽑은 항목은 rauha 가 다시 읽은 그 파일에 근거 줄이 있어야 남는다(경로의 역슬래시·대소문자 무시)', () => {
    const files = new Map<string, string | null>([['E:/project/docs/todo.md', '# 할 일\n- [ ] 결제 모듈 리팩터링\n- [x] 끝난 일'], ['E:/project/docs/gone.md', null]]);
    const kept = TodoAsk.keep(
      [item('결제 모듈 리팩터링', '- [ ] 결제 모듈 리팩터링', null, 'e:\\project\\docs\\todo.md'), item('지어낸 일', '- [ ] 지어낸 일', null, 'E:/project/docs/todo.md'), item('못 읽은 파일', '아무거나', null, 'E:/project/docs/gone.md'), item('사용자 말', '파일들 찾아서')],
      ['project/docs에 있는 todo 파일들 찾아서 넣어줘'],
      files,
    );
    expect(kept.map((k) => k.title)).toEqual(['결제 모듈 리팩터링', '사용자 말']);
  });

  it('여러 할 일은 카드 하나로 묶고 각 할 일은 그 카드의 체크리스트가 된다', () => {
    const card = TodoAsk.card([item('결제 API 리뷰', 'q', '2026-11-19'), item('배포 체크리스트 확인', 'q'), item('회의록', 'q', '2026-11-20')], '내일 업무 정리해줘', '2026-11-18');
    expect(card.title).toBe('내일 할 일');
    expect(card.checklist).toEqual(['결제 API 리뷰', '배포 체크리스트 확인', '회의록 (2026-11-20)']);
    expect(card.due).toBe('2026-11-19');
  });

  it('때를 말하지 않으면 정리한 날로, 한 파일에서 왔으면 그 파일 이름으로 카드 제목을 짓는다', () => {
    expect(TodoAsk.card([item('a', 'a'), item('b', 'b')], '투두 정리해줘', '2026-11-18').title).toBe('할 일 정리 (11-18)');
    const fromFile = TodoAsk.card([item('a', 'a', null, 'E:/w/docs/todo.md'), item('b', 'b', null, 'E:\\w\\docs\\todo.md')], 'docs 투두 넣어줘', '2026-11-18');
    expect(fromFile.title).toBe('할 일 (todo.md)');
    expect(fromFile.note).toContain('출처: E:/w/docs/todo.md');
  });

  it('할 일이 하나뿐이면 체크리스트 없이 그 할 일이 카드 제목이다', () => {
    const card = TodoAsk.card([{ ...item('리뷰', '리뷰', '2026-11-19'), note: '오전에' }], '투두 정리', '2026-11-18');
    expect(card).toMatchObject({ title: '리뷰', note: '오전에', due: '2026-11-19', checklist: [] });
  });

  it('이미 끝나지 않은 카드 제목이나 체크리스트에 있는 할 일은 다시 넣지 않는다', () => {
    const fresh = TodoAsk.fresh([item('결제 API 리뷰', 'q'), item('배포', 'q'), item('새 일', 'q')], ['결제 API  리뷰', '배포 (2026-11-20)']);
    expect(fresh.items.map((i) => i.title)).toEqual(['새 일']);
    expect(fresh.skipped).toBe(2);
  });

  it('여러 할 일을 넣었으면 카드 하나와 체크리스트 수로 알린다', () => {
    const card = TodoAsk.card([item('a', 'a'), item('b', 'b')], '투두', '2026-11-18');
    expect(TodoAsk.report(card.items, 0, 0, card)).toBe('할 일 탭에 카드 "할 일 정리 (11-18)" 하나를 만들고 체크리스트 2개를 넣었어요.\n- [ ] a\n- [ ] b');
  });

  it('파일에서 넣었으면 읽은 파일과 이미 있어 건너뛴 수를 알린다', () => {
    const text = TodoAsk.report([item('a', 'a', null, 'docs/todo.md')], 0, 2);
    expect(text).toContain('읽은 파일: docs/todo.md');
    expect(text).toContain('이미 할 일 탭에 있는 2개');
  });
});
