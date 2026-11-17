import { describe, expect, it } from 'vitest';
import { TodoAsk, type TodoItem } from './todo-ask.js';

const item = (title: string, quote: string, due: string | null = null): TodoItem => ({ title, note: '', due, quote });

describe('할 일 정리 요청', () => {
  it('투두·todo list·할 일 정리·내일 업무 정리 같은 말을 알아본다', () => {
    for (const t of ['투두 정리해줘', 'todo list 만들어줘', '할 일 정리해줘', '할일 목록 만들어', '내일 업무 정리해줘', '이번 주 할 일 정리', '이거 할 일에 넣어줘', 'TODO 리스트']) expect(TodoAsk.asks(t)).toBe(true);
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
    expect(TodoAsk.report([item('리뷰', '리뷰', '2026-11-19')], 1)).toBe('할 일 탭에 1개 넣었어요.\n- 리뷰 (2026-11-19)\n(말씀에서 근거를 찾지 못한 1개는 넣지 않았어요.)');
    expect(TodoAsk.report([], 0)).toContain('찾지 못했어요');
  });
});
