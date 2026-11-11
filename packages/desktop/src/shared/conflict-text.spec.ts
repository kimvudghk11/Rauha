import { describe, expect, it } from 'vitest';
import { ConflictText } from './conflict-text.js';

const SAMPLE = ['앞 줄', '<<<<<<< HEAD', '내 글', '=======', '상대 글', '>>>>>>> feature/x', '뒷 줄', ''].join('\n');

describe('충돌 파일 읽기', () => {
  it('충돌 표시 앞뒤는 그냥 줄이고, 사이는 내 쪽과 상대 쪽으로 나눈다', () => {
    const t = ConflictText.parse(SAMPLE);
    expect(t.parts).toEqual([
      { kind: 'plain', lines: ['앞 줄'] },
      { kind: 'conflict', ours: ['내 글'], theirs: ['상대 글'], oursLabel: 'HEAD', theirsLabel: 'feature/x' },
      { kind: 'plain', lines: ['뒷 줄'] },
    ]);
  });
  it('충돌이 여러 덩어리여도 덩어리 수를 센다', () => {
    const two = ['<<<<<<< HEAD', 'a', '=======', 'b', '>>>>>>> x', '중간', '<<<<<<< HEAD', 'c', '=======', 'd', '>>>>>>> x'].join('\n');
    expect(ConflictText.parse(two).count()).toBe(2);
    expect(ConflictText.parse('충돌 없음\n').count()).toBe(0);
  });
  it('diff3 형식의 공통 조상 부분은 base 로 읽는다', () => {
    const t = ConflictText.parse(['<<<<<<< HEAD', '내', '||||||| base', '옛', '=======', '상대', '>>>>>>> x'].join('\n'));
    expect(t.parts).toEqual([{ kind: 'conflict', ours: ['내'], theirs: ['상대'], base: ['옛'], oursLabel: 'HEAD', theirsLabel: 'x' }]);
    expect(t.hasBase()).toBe(true);
  });
  it('끝 표시가 없는 덩어리는 충돌로 보지 않고 줄로 둔다', () => {
    const t = ConflictText.parse(['<<<<<<< HEAD', '내', '======='].join('\n'));
    expect(t.count()).toBe(0);
    expect(t.parts[0]).toEqual({ kind: 'plain', lines: ['<<<<<<< HEAD', '내', '======='] });
  });
  it('한쪽이 비어 있는(지운) 덩어리도 읽는다', () => {
    const t = ConflictText.parse(['<<<<<<< HEAD', '=======', '상대가 추가', '>>>>>>> x'].join('\n'));
    expect(t.parts).toEqual([{ kind: 'conflict', ours: [], theirs: ['상대가 추가'], oursLabel: 'HEAD', theirsLabel: 'x' }]);
  });
});

const TWO = ['머리', '<<<<<<< HEAD', 'a1', 'a2', '||||||| base', 'o', '=======', 'b1', '>>>>>>> topic', '중간', '<<<<<<< HEAD', 'c', '=======', 'd', '>>>>>>> topic', '꼬리', ''].join('\n');

describe('구역 단위 해결', () => {
  it('mine 을 고르면 그 구역만 내 쪽 줄로 바뀌고 다른 구역은 그대로다', () => {
    const t = ConflictText.parse(TWO).resolve(0, 'mine');
    expect(t.count()).toBe(1);
    expect(t.toText()).toBe(['머리', 'a1', 'a2', '중간', '<<<<<<< HEAD', 'c', '=======', 'd', '>>>>>>> topic', '꼬리', ''].join('\n'));
  });
  it('theirs 를 고르면 상대 쪽 줄이 된다', () => {
    expect(ConflictText.parse(TWO).resolve(1, 'theirs').toText()).toContain('중간\nd\n꼬리');
  });
  it('both 는 내 쪽 다음에 상대 쪽을 이어 붙인다', () => {
    expect(ConflictText.parse(TWO).resolve(0, 'both').toText().split('\n').slice(0, 5)).toEqual(['머리', 'a1', 'a2', 'b1', '중간']);
  });
  it('base 는 공통 조상 줄이고, 조상이 없는 구역에서는 아무 일도 하지 않는다', () => {
    expect(ConflictText.parse(TWO).resolve(0, 'base').toText().split('\n').slice(0, 3)).toEqual(['머리', 'o', '중간']);
    const plain = ConflictText.parse(['<<<<<<< HEAD', 'x', '=======', 'y', '>>>>>>> t'].join('\n'));
    expect(plain.resolve(0, 'base')).toBe(plain);
  });
  it('양쪽 모두 비어 있는 구역을 고르면 줄이 사라진다', () => {
    const t = ConflictText.parse(['a', '<<<<<<< HEAD', '=======', '>>>>>>> t', 'b'].join('\n')).resolve(0, 'both');
    expect(t.toText()).toBe('a\nb');
  });
  it('없는 구역 번호는 그대로 둔다(원본을 바꾸지 않는다)', () => {
    const t = ConflictText.parse(TWO);
    expect(t.resolve(5, 'mine')).toBe(t);
    expect(t.resolve(-1, 'mine')).toBe(t);
    expect(t.count()).toBe(2);
  });
  it('모두 해결하면 충돌 표시가 하나도 남지 않는다', () => {
    const t = ConflictText.parse(TWO).resolve(0, 'mine').resolve(0, 'theirs');
    expect(t.count()).toBe(0);
    expect(/^(<{7}|={7}|>{7}|\|{7})/m.test(t.toText())).toBe(false);
  });
});

describe('글로 되돌리기', () => {
  it('해결하지 않은 파일은 읽은 그대로 되돌린다(조상 구역·끝 줄 바꿈 포함)', () => {
    expect(ConflictText.parse(TWO).toText()).toBe(TWO);
    expect(ConflictText.parse(SAMPLE).toText()).toBe(SAMPLE);
    const noTrailing = SAMPLE.slice(0, -1);
    expect(ConflictText.parse(noTrailing).toText()).toBe(noTrailing);
  });
  it('CRLF 파일은 줄 끝 CR 을 지키고, 구역을 해결해도 줄 바꿈이 섞이지 않는다', () => {
    const crlf = ['a', '<<<<<<< HEAD', 'm', '=======', 't', '>>>>>>> x', 'z', ''].join('\r\n');
    const t = ConflictText.parse(crlf);
    expect(t.count()).toBe(1);
    expect(t.toText()).toBe(crlf);
    expect(t.resolve(0, 'theirs').toText()).toBe(['a', 't', 'z', ''].join('\r\n'));
    expect(t.resolve(0, 'both').toText()).toBe(['a', 'm', 't', 'z', ''].join('\r\n'));
  });
});

describe('조상(base) 붙이기', () => {
  const working = ['앞', '<<<<<<< HEAD', '내', '=======', '상대', '>>>>>>> topic', '뒤', ''].join('\n');
  const diff3 = ['앞', '<<<<<<< HEAD', '내', '||||||| base', '옛', '=======', '상대', '>>>>>>> MERGE_HEAD', '뒤', ''].join('\n');
  it('작업 파일과 git 이 다시 만든 diff3 가 같은 모양이면 조상 줄을 붙인다(표시 이름은 작업 파일 것)', () => {
    const t = ConflictText.withBase(working, diff3);
    expect(t.hasBase()).toBe(true);
    expect(t.parts[1]).toMatchObject({ kind: 'conflict', ours: ['내'], theirs: ['상대'], base: ['옛'], theirsLabel: 'topic' });
    expect(t.resolve(0, 'mine').toText()).toBe('앞\n내\n뒤\n');
  });
  it('사용자가 이미 고쳐서 모양이 다르면 조상 없이 작업 파일 그대로 쓴다', () => {
    const edited = working.replace('상대', '상대 고침');
    expect(ConflictText.withBase(edited, diff3).hasBase()).toBe(false);
    expect(ConflictText.withBase(edited, diff3).toText()).toBe(edited);
    expect(ConflictText.withBase(working, null).hasBase()).toBe(false);
  });
  it('작업 파일이 CRLF 로 바뀌어 있어도 같은 모양으로 본다', () => {
    const crlf = working.split('\n').join('\r\n');
    const t = ConflictText.withBase(crlf, diff3);
    expect(t.hasBase()).toBe(true);
    expect(t.toText()).toContain('||||||| base\r\n옛\r\n');
  });
});
