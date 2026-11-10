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
  it('diff3 형식의 공통 조상 부분은 건너뛴다', () => {
    const t = ConflictText.parse(['<<<<<<< HEAD', '내', '||||||| base', '옛', '=======', '상대', '>>>>>>> x'].join('\n'));
    expect(t.parts).toEqual([{ kind: 'conflict', ours: ['내'], theirs: ['상대'], oursLabel: 'HEAD', theirsLabel: 'x' }]);
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
