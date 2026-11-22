import { describe, expect, it } from 'vitest';
import { CoverageDto } from './coverage.dto.js';

describe('요청 항목 표 읽기', () => {
  it('asks·scope 가 없는 옛 보고도 빈 표로 읽는다', () => {
    const c = CoverageDto.read({ answer: '안녕하세요' }, undefined);
    expect(c.asks).toEqual([]);
    expect(c.unopened()).toEqual([]);
  });

  it('상태를 알 수 없는 항목은 끝난 것으로 부풀리지 않고 일부로 본다', () => {
    const c = CoverageDto.read({ asks: [{ ask: 'A', status: 'finished', note: '', needs: '' }, 'x', null] }, []);
    expect(c.asks).toEqual([{ ask: 'A', status: 'partial', note: '', needs: '' }]);
  });

  it('계획한 곳은 팀원이 실제로 연 경로와 맞춰 본다', () => {
    const c = CoverageDto.read({ asks: [], scope: ['src/a', 'src/b', 3] }, ['E:/repo/src/a/x.ts']);
    expect(c.unopened()).toEqual(['src/b']);
  });
});
