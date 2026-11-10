import { describe, expect, it } from 'vitest';
import { COLUMN_COLORS, COLUMN_MAX, Columns, TodoColumnError } from './todo-columns.js';

const names = (c: Columns) => c.items.map((k) => k.name);

describe('기본 칸', () => {
  it('"할 일 / 진행 중 / 완료"로 시작하고 완료 칸만 "완료로 취급"이다', () => {
    const c = Columns.defaults();
    expect(names(c)).toEqual(['할 일', '진행 중', '완료']);
    expect(c.items.map((k) => k.done)).toEqual([false, false, true]);
    expect(c.items.map((k) => k.id)).toEqual(['todo', 'doing', 'done']);
  });

  it('팀에 맡기면 가는 칸은 "진행 중"이다', () => {
    expect(Columns.defaults().work()?.id).toBe('doing');
  });
});

describe('칸 추가·이름·색', () => {
  it('칸을 더하면 맨 끝에 붙는다', () => {
    const c = Columns.defaults().add('검토', 'purple', 'rv');
    expect(names(c)).toEqual(['할 일', '진행 중', '완료', '검토']);
    expect(c.get('rv')?.color).toBe('purple');
  });

  it('이름은 공백을 지우고 비었거나 30자를 넘으면 거절한다', () => {
    expect(Columns.defaults().rename('todo', '  백로그  ').get('todo')?.name).toBe('백로그');
    expect(() => Columns.defaults().rename('todo', ' ')).toThrow(/name/);
    expect(() => Columns.defaults().add('가'.repeat(31), 'gray', 'x')).toThrow(/30 characters/);
  });

  it('고를 수 없는 색은 거절한다', () => {
    expect(COLUMN_COLORS).toContain('red');
    expect(() => Columns.defaults().recolor('todo', 'pink' as never)).toThrow(/color/);
    expect(Columns.defaults().recolor('todo', 'red').get('todo')?.color).toBe('red');
  });

  it('칸은 12개까지다', () => {
    let c = Columns.defaults();
    for (let i = c.items.length; i < COLUMN_MAX; i += 1) c = c.add(`칸${i}`, 'gray', `k${i}`);
    expect(() => c.add('하나 더', 'gray', 'z')).toThrow(/12 columns/);
  });

  it('없는 칸을 만지면 거절한다', () => {
    expect(() => Columns.defaults().rename('없음', 'a')).toThrow(TodoColumnError);
  });
});

describe('칸 속성', () => {
  it('"완료로 취급"을 켜고 끌 수 있다(여러 칸도 된다)', () => {
    const c = Columns.defaults().setDone('todo', true);
    expect(c.isDone('todo')).toBe(true);
    expect(c.setDone('done', false).isDone('done')).toBe(false);
  });

  it('"팀이 일하는 칸"은 하나만 되고, 켜면 앞의 것은 꺼진다', () => {
    const c = Columns.defaults().setWork('todo', true);
    expect(c.work()?.id).toBe('todo');
    expect(c.get('doing')?.work).toBe(false);
  });

  it('접기·펴기는 칸마다 따로다', () => {
    const c = Columns.defaults().collapse('done', true);
    expect(c.get('done')?.collapsed).toBe(true);
    expect(c.get('todo')?.collapsed).toBe(false);
  });
});

describe('칸 순서와 지우기', () => {
  it('칸을 다른 칸 앞으로 옮길 수 있다', () => {
    expect(names(Columns.defaults().move('done', 'todo'))).toEqual(['완료', '할 일', '진행 중']);
    expect(names(Columns.defaults().move('todo', null))).toEqual(['진행 중', '완료', '할 일']);
  });

  it('칸을 지우면 카드가 갈 칸은 앞 칸이고, 첫 칸이면 다음 칸이다', () => {
    const c = Columns.defaults();
    expect(c.landingFor('doing')).toBe('todo');
    expect(c.landingFor('done')).toBe('doing');
    expect(c.landingFor('todo')).toBe('doing');
  });

  it('칸을 지운다', () => {
    expect(names(Columns.defaults().remove('doing'))).toEqual(['할 일', '완료']);
  });

  it('마지막 한 칸은 지울 수 없다', () => {
    const one = Columns.defaults().remove('doing').remove('done');
    expect(() => one.remove('todo')).toThrow(/last/);
    expect(() => one.landingFor('todo')).toThrow(/last/);
  });
});

describe('새 카드가 들어갈 칸', () => {
  it('완료 칸이 아닌 첫 칸이다', () => {
    expect(Columns.defaults().entry().id).toBe('todo');
    expect(Columns.defaults().setDone('todo', true).entry().id).toBe('doing');
  });
  it('모두 완료 칸이면 첫 칸이다', () => {
    const c = Columns.defaults().setDone('todo', true).setDone('doing', true);
    expect(c.entry().id).toBe('todo');
  });
});

describe('저장된 값에서 다시 만들기', () => {
  it('비어 있으면 거절한다', () => {
    expect(() => Columns.restore([])).toThrow(/at least one/);
  });
  it('번호가 겹치면 거절한다', () => {
    const k = Columns.defaults().items[0]!;
    expect(() => Columns.restore([k, k])).toThrow(/share an id/);
  });
});

describe('칸 숨기기', () => {
  it('칸을 숨기면 hidden이 되고 다시 보이게 할 수 있다', () => {
    const c = Columns.defaults().hide('done', true);
    expect(c.get('done')?.hidden).toBe(true);
    expect(c.visible().map((k) => k.id)).toEqual(['todo', 'doing']);
    expect(c.hide('done', false).visible()).toHaveLength(3);
  });

  it('보이는 칸이 하나도 안 남게 숨길 수는 없다', () => {
    const c = Columns.defaults().hide('todo', true).hide('doing', true);
    expect(() => c.hide('done', true)).toThrow(/visible/);
  });

  it('새 카드가 들어가는 첫 칸은 숨긴 칸을 건너뛴다', () => {
    expect(Columns.defaults().hide('todo', true).entry().id).toBe('doing');
  });

  it('옛 저장 파일처럼 hidden이 없는 칸은 보이는 칸이다', () => {
    const old = Columns.defaults().items.map(({ hidden: _h, ...k }) => k);
    expect(Columns.restore(old as never).visible()).toHaveLength(3);
  });
});
