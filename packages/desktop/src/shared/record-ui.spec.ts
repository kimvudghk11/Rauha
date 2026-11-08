import { describe, expect, it } from 'vitest';
import { activeFilterKeys, copiedText, deleteDialog, moveRowSelection, rangeBetween, pickBarState, primaryRecordAction, type RecordFilterState } from './record-ui.js';

const NONE: RecordFilterState = { text: '', tag: null, status: 'all', repo: null, divergedOnly: false, period: 'all' };

describe('기록 선택 작업줄', () => {
  it('아무것도 안 골랐으면 "선택한 기록이 없어요"를 보이고 선택 필요한 단추는 막는다', () => {
    const s = pickBarState([], ['a', 'b']);
    expect(s.summary).toBe('선택한 기록이 없어요');
    expect([s.canBlog, s.canCopy, s.canDelete, s.canClear]).toEqual([false, false, false, false]);
    expect(s.canSelectAll).toBe(true);
  });
  it('고른 수를 "3개 선택"으로 앞에 보인다', () => {
    const s = pickBarState(['a', 'b', 'c'], ['a', 'b', 'c', 'd']);
    expect(s.summary).toBe('3개 선택');
    expect([s.canBlog, s.canCopy, s.canDelete, s.canClear]).toEqual([true, true, true, true]);
  });
  it('보이는 기록을 모두 골랐으면 전체 선택 단추를 막는다', () => {
    expect(pickBarState(['a', 'b'], ['a', 'b']).canSelectAll).toBe(false);
  });
  it('필터에 가려진 선택은 안 보인다고 알려 준다', () => {
    expect(pickBarState(['a', 'x', 'y'], ['a', 'b']).summary).toBe('3개 선택 (2개는 지금 안 보여요)');
  });
  it('보이는 기록이 없으면 전체 선택을 막는다', () => {
    expect(pickBarState([], []).canSelectAll).toBe(false);
  });
});

describe('기록 탭의 강조 버튼', () => {
  it('상세도 블로그 패널도 없으면 체크한 게 있을 때만 "블로그 글"이 강조된다', () => {
    expect(primaryRecordAction(0, 'none')).toBe('none');
    expect(primaryRecordAction(2, 'none')).toBe('pick-blog');
  });
  it('상세가 열려 있으면 복사만 강조된다(체크가 있어도 강조는 하나)', () => {
    expect(primaryRecordAction(2, 'detail')).toBe('detail-copy');
  });
  it('블로그 패널이 열려 있으면 초안 쓰기만 강조된다', () => {
    expect(primaryRecordAction(2, 'blog')).toBe('blog-draft');
  });
});

describe('필터 적용 표시', () => {
  it('아무 조건도 없으면 비어 있다', () => {
    expect(activeFilterKeys(NONE)).toEqual([]);
  });
  it('걸린 조건 이름만 순서대로 돌려준다', () => {
    expect(activeFilterKeys({ ...NONE, text: ' 결제 ', tag: 'network', status: 'stopped', repo: 'app', divergedOnly: true, period: '7' })).toEqual(['text', 'tag', 'status', 'repo', 'diverged', 'period']);
  });
  it('공백뿐인 검색어는 조건이 아니다', () => {
    expect(activeFilterKeys({ ...NONE, text: '   ' })).toEqual([]);
  });
});

describe('키보드로 목록 옮기기', () => {
  const ids = ['a', 'b', 'c'];
  it('고른 게 없으면 아래 화살표는 첫 줄, 위 화살표는 마지막 줄', () => {
    expect(moveRowSelection(ids, null, 'ArrowDown')).toBe('a');
    expect(moveRowSelection(ids, null, 'ArrowUp')).toBe('c');
  });
  it('위아래로 한 칸씩 가고 끝에서는 멈춘다', () => {
    expect(moveRowSelection(ids, 'a', 'ArrowDown')).toBe('b');
    expect(moveRowSelection(ids, 'c', 'ArrowDown')).toBe('c');
    expect(moveRowSelection(ids, 'a', 'ArrowUp')).toBe('a');
  });
  it('Home·End는 처음과 끝', () => {
    expect(moveRowSelection(ids, 'b', 'Home')).toBe('a');
    expect(moveRowSelection(ids, 'b', 'End')).toBe('c');
  });
  it('목록이 비었거나 다른 키면 null', () => {
    expect(moveRowSelection([], null, 'ArrowDown')).toBeNull();
    expect(moveRowSelection(ids, 'a', 'x')).toBeNull();
  });
  it('목록에 없는 현재 줄은 고른 게 없는 것처럼 본다', () => {
    expect(moveRowSelection(ids, 'zz', 'ArrowDown')).toBe('a');
  });
});

describe('안내 문장', () => {
  it('복사 완료·실패 문장', () => {
    expect(copiedText(1, true)).toBe('복사했어요');
    expect(copiedText(3, true)).toBe('3개 기록을 복사했어요');
    expect(copiedText(3, false)).toBe('복사하지 못했어요. 다시 눌러 주세요.');
  });
});

describe('지우기 확인 창 문장', () => {
  it('기록 하나는 제목과 되돌릴 수 없음을 말한다', () => {
    const d = deleteDialog(['결제 타임아웃']);
    expect(d.title).toBe('기록 1개를 지울까요?');
    expect(d.body).toBe('"결제 타임아웃"\n이 컴퓨터에서 지워져요. 되돌릴 수 없어요.');
    expect(d.okLabel).toBe('지우기');
  });
  it('여러 개는 앞의 셋만 적고 나머지는 "외 N개"로 줄인다', () => {
    const d = deleteDialog(['a', 'b', 'c', 'd', 'e']);
    expect(d.title).toBe('기록 5개를 지울까요?');
    expect(d.body).toBe('"a"\n"b"\n"c"\n외 2개\n이 컴퓨터에서 지워져요. 되돌릴 수 없어요.');
    expect(d.okLabel).toBe('5개 지우기');
  });
});

describe('Shift+클릭 범위 선택', () => {
  const ids = ['a', 'b', 'c', 'd'];
  it('기준 줄과 누른 줄 사이(양끝 포함)를 돌려준다', () => {
    expect(rangeBetween(ids, 'b', 'd')).toEqual(['b', 'c', 'd']);
    expect(rangeBetween(ids, 'd', 'b')).toEqual(['b', 'c', 'd']);
  });
  it('기준이 없거나 목록에 없으면 누른 줄만', () => {
    expect(rangeBetween(ids, null, 'c')).toEqual(['c']);
    expect(rangeBetween(ids, 'zz', 'c')).toEqual(['c']);
  });
});
