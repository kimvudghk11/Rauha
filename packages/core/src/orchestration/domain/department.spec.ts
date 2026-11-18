import { describe, expect, it } from 'vitest';
import { Department, LAUNCH_ORDER } from './department.js';

describe('Department', () => {
  it('부서마다 이름과 소속 팀원을 가진다', () => {
    const marketing = Department.of('marketing');
    expect(marketing.label).toBe('마케팅·그로스부');
    expect(marketing.members.map((m) => m.role)).toEqual(['marketer', 'growth']);
  });

  it('팀원이 부서에 속하는지 안다', () => {
    expect(Department.of('operations').hasMember('debugger')).toBe(true);
    expect(Department.of('operations').hasMember('marketer')).toBe(false);
  });

  it('알 수 없는 부서 이름은 없는 것으로 읽는다', () => {
    expect(Department.named('marketing')?.id).toBe('marketing');
    expect(Department.named('hr')).toBeNull();
    expect(Department.named(null)).toBeNull();
  });

  it('부서장의 지침은 부서마다 다르고, 부서장이 10년차 이상 리드급이라고 밝힌다', () => {
    for (const d of Department.all()) expect(d.persona).toMatch(/10\+ years of hands-on work in this field, 5\+ years leading teams/);
    expect(Department.of('quality').persona).not.toBe(Department.of('marketing').persona);
  });

  it('어느 팀원도 두 부서에 겹쳐 속하지 않는다', () => {
    const roles = Department.all().flatMap((d) => d.members.map((m) => m.role));
    expect(new Set(roles).size).toBe(roles.length);
  });

  it('팀원 이름으로 소속 부서를 찾는다', () => {
    expect(Department.ofMember('bm')?.id).toBe('planning');
    expect(Department.ofMember('tester')).toBeNull();
  });

  it('런칭 계획은 기획 → 디자인 → 마케팅 → 품질 → 운영 순서로 부서장이 한 번씩 쓴다', () => {
    expect(LAUNCH_ORDER).toEqual(['planning', 'design', 'marketing', 'quality', 'operations']);
  });
});
