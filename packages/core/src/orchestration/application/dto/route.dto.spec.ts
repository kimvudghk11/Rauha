import { describe, expect, it } from 'vitest';
import { RouteDto } from './route.dto.js';

describe('RouteDto', () => {
  it('라우터 출력을 읽는다', () => {
    expect(RouteDto.read({ mode: 'question', refersToPast: true, pastQuery: '할인 discount' })).toEqual({ mode: 'question', refersToPast: true, pastQuery: '할인 discount', department: null, member: null, depth: 'deep' });
  });

  it('깨진 출력이면 작업으로 보고 지난 작업을 찾지 않는다', () => {
    expect(RouteDto.read({ mode: 'chat' })).toEqual({ mode: 'work', refersToPast: false, pastQuery: null, department: null, member: null, depth: 'deep' });
    expect(RouteDto.read(null)).toEqual({ mode: 'work', refersToPast: false, pastQuery: null, department: null, member: null, depth: 'deep' });
  });

  it('빈 검색어는 없음으로 본다', () => {
    expect(RouteDto.read({ mode: 'work', refersToPast: true, pastQuery: '  ' }).pastQuery).toBeNull();
  });
});

describe('RouteDto — 디버깅·위험 점검', () => {
  it('debug와 risk도 입력 종류로 읽는다', () => {
    expect(RouteDto.read({ mode: 'debug', refersToPast: false, pastQuery: null }).mode).toBe('debug');
    expect(RouteDto.read({ mode: 'risk', refersToPast: false, pastQuery: null }).mode).toBe('risk');
    expect(RouteDto.read({ mode: 'ideate', refersToPast: false, pastQuery: null }).mode).toBe('ideate');
  });
});

describe('RouteDto — 회사 부서', () => {
  const base = { refersToPast: false, pastQuery: null };

  it('company는 부서와 팀원을 함께 읽는다', () => {
    expect(RouteDto.read({ ...base, mode: 'company', department: 'marketing', member: 'marketer' })).toMatchObject({ mode: 'company', department: 'marketing', member: 'marketer' });
  });

  it('팀원을 못 정했으면(넓은 요청) 팀원은 없음이고 부서장이 나눈다', () => {
    expect(RouteDto.read({ ...base, mode: 'company', department: 'planning', member: null })).toMatchObject({ department: 'planning', member: null });
  });

  it('그 부서 소속이 아닌 팀원은 없음으로 본다', () => {
    expect(RouteDto.read({ ...base, mode: 'company', department: 'marketing', member: 'debugger' })).toMatchObject({ department: 'marketing', member: null });
  });

  it('company인데 부서를 알 수 없으면 작업으로 되돌리지 않고 기획부 부서장이 받는다', () => {
    expect(RouteDto.read({ ...base, mode: 'company', department: 'hr', member: null })).toMatchObject({ mode: 'company', department: 'planning', member: null });
  });

  it('launch는 부서 없이 읽는다', () => {
    expect(RouteDto.read({ ...base, mode: 'launch' })).toMatchObject({ mode: 'launch', department: null, member: null, depth: 'deep' });
  });

  it('company가 아닌 모드에서는 부서·팀원을 무시한다', () => {
    expect(RouteDto.read({ ...base, mode: 'work', department: 'marketing', member: 'marketer' })).toMatchObject({ department: null, member: null, depth: 'deep' });
  });
});

describe('RouteDto — 질문 깊이', () => {
  it('깊이를 못 읽으면 deep으로 본다 (옛 출력과 호환)', () => {
    expect(RouteDto.read({ mode: 'question', refersToPast: false, pastQuery: null }).depth).toBe('deep');
    expect(RouteDto.read({ mode: 'question', depth: '???' }).depth).toBe('deep');
  });

  it('라우터가 light라고 한 질문은 light로 읽는다', () => {
    expect(RouteDto.read({ mode: 'question', refersToPast: false, pastQuery: null, depth: 'light' }).depth).toBe('light');
  });

  it('질문이 아닌 입력의 깊이는 항상 deep이다', () => {
    expect(RouteDto.read({ mode: 'work', depth: 'light' }).depth).toBe('deep');
  });

  it('지난 작업을 가리키는 질문은 light로 답하지 않는다 (기억에서 고른 작업을 읽어야 한다)', () => {
    expect(RouteDto.read({ mode: 'question', refersToPast: true, pastQuery: 'x', depth: 'light' }).depth).toBe('deep');
  });
});
