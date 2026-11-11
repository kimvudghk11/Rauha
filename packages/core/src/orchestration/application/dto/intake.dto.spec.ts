import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../shared/domain-error.js';
import { IntakeDto } from './intake.dto.js';

const valid = {
  title: 'Money 할인 적용',
  fileCount: 2,
  crossModule: false,
  sensitive: false,
  scope: ['src/domain/money.ts', 'src/domain/money.spec.ts'],
  acceptance: [
    { kind: 'happy', text: '10% 할인하면 9,000원이 된다' },
    { kind: 'error', text: '할인율이 100을 넘으면 AppError' },
    { kind: 'error', text: '할인율이 음수면 AppError' },
  ],
  doneWhen: 'money.spec.ts의 discount 테스트가 통과',
  forbidden: ['shared/ 수정'],
};

describe('IntakeDto', () => {
  it('수용 기준의 정상·예외 경로 수로 시나리오 요약을 만든다', () => {
    expect(IntakeDto.from(valid).toScenarioSummary()).toEqual({ happyPaths: 1, errorPaths: 2 });
  });

  it('업무 지시서로 S급 업무를 연다', () => {
    const order = IntakeDto.from(valid).toOpenWorkOrder().toEntity('w1');
    expect(order.difficulty.grade).toBe('S');
    expect(order.title).toBe('Money 할인 적용');
  });

  it('범위가 비면 접수를 거부한다', () => {
    expect(() => IntakeDto.from({ ...valid, scope: [] })).toThrow(DomainError);
  });

  it('수용 기준의 종류는 happy 또는 error여야 한다', () => {
    expect(() => IntakeDto.from({ ...valid, acceptance: [{ kind: 'maybe', text: 'x' }] })).toThrow(/happy/);
  });

  it('업무 지시서는 상위 설계 양식대로 쓴다', () => {
    const brief = IntakeDto.from(valid).toBrief('S');
    expect(brief).toContain('## 업무: Money 할인 적용');
    expect(brief).toContain('- 등급: S');
    expect(brief).toContain('- 범위: src/domain/money.ts, src/domain/money.spec.ts');
    expect(brief).toContain('- 금지: shared/ 수정');
    expect(brief).toContain('[예외] 할인율이 음수면 AppError');
  });

  it('팀원이 먼저 읽을 파일은 5개까지만 받고, 없으면 빈 목록', () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => `src/${n}.ts`);
    expect(IntakeDto.from({ ...valid, readFirst: many }).readFirst).toEqual(many.slice(0, 5));
    expect(IntakeDto.from(valid).readFirst).toEqual([]);
  });
});

describe('IntakeDto — 해석이 갈리는 요청', () => {
  const assumption = { question: '원 미만은 무엇을 버리나', chosen: '할인 후 금액에서 원 미만을 버린다(999원 10% → 899원)', alternatives: ['할인액에서 원 미만을 버린다(999원 10% → 900원)'] };

  it('해석이 갈리는 지점을 고른 해석과 다른 후보와 함께 읽는다', () => {
    const dto = IntakeDto.from({ ...valid, assumptions: [assumption] });
    expect(dto.assumptions).toEqual([{ ...assumption, needsUser: false }]);
  });

  it('사용자가 꼭 정해야 하는 해석만 needsUser로 표시되고, 표시가 없으면 묻지 않는다', () => {
    const dto = IntakeDto.from({ ...valid, assumptions: [{ ...assumption, needsUser: true }, assumption] });
    expect(dto.assumptions.map((a) => a.needsUser)).toEqual([true, false]);
  });

  it('묻지 않은 해석은 추천대로 정하고 확인되지 않은 것으로 남긴다', () => {
    const dto = IntakeDto.from({ ...valid, assumptions: [{ ...assumption, needsUser: true }, assumption] });
    const settled = dto.settleAssumptions([1, null]);
    expect(settled.map((s) => [s.chosen === assumption.chosen, s.confirmed, s.changed])).toEqual([
      [false, true, true],
      [true, false, false],
    ]);
  });

  it('가정이 없으면 빈 목록이다', () => {
    expect(IntakeDto.from(valid).assumptions).toEqual([]);
  });

  it('가정은 3개까지, 다른 후보는 1개 이상이어야 한다', () => {
    expect(() => IntakeDto.from({ ...valid, assumptions: Array(4).fill(assumption) })).toThrow(DomainError);
    expect(() => IntakeDto.from({ ...valid, assumptions: [{ ...assumption, alternatives: [] }] })).toThrow(DomainError);
  });

  it('업무 지시서에 확정된 해석을 적는다', () => {
    const brief = IntakeDto.from({ ...valid, assumptions: [assumption] }).toBrief('S');
    expect(brief).toContain('정해 둔 해석');
    expect(brief).toContain('원 미만은 무엇을 버리나 → 할인 후 금액에서 원 미만을 버린다');
  });

  it('팀장이 고른 전문 분야를 읽고, 업무 지시서에 그 분야의 지침을 붙인다', () => {
    const dto = IntakeDto.from({ ...valid, specialties: ['backend', 'database'] });
    expect(dto.specialties).toEqual(['backend', 'database']);
    const brief = dto.toBrief('S');
    expect(brief).toContain('<specialty>');
    expect(brief).toContain('[백엔드]');
    expect(brief).toContain('[데이터베이스]');
  });

  it('전문 분야가 없거나 모르는 이름뿐이면 지침을 붙이지 않는다', () => {
    expect(IntakeDto.from(valid).specialties).toEqual([]);
    expect(IntakeDto.from(valid).toBrief('S')).not.toContain('<specialty>');
    expect(IntakeDto.from({ ...valid, specialties: ['요리'] }).toBrief('S')).not.toContain('<specialty>');
  });
});

describe('IntakeDto.fallback — 팀장이 지시서를 못 만들었을 때', () => {
  it('요청 글 그대로를 수용 기준으로 삼고 정상·예외 경로를 하나씩 갖춰 업무를 열 수 있다', () => {
    const dto = IntakeDto.fallback('  버튼 색을 파랑으로 바꿔줘\n그리고 여백도 줄여줘  ');
    expect(dto.title).toBe('버튼 색을 파랑으로 바꿔줘');
    expect(dto.toScenarioSummary()).toEqual({ happyPaths: 1, errorPaths: 1 });
    expect(dto.acceptance[0]!.text).toContain('여백도 줄여줘');
    expect(dto.scope).toEqual(['**']);
    expect(() => dto.toOpenWorkOrder()).not.toThrow();
  });

  it('제목은 60자까지만 쓰고, 빈 요청이어도 제목이 비지 않는다', () => {
    expect(IntakeDto.fallback('가'.repeat(200)).title).toHaveLength(60);
    expect(IntakeDto.fallback('   ').title).toBe('요청한 작업');
  });

  it('범위가 저장소 전체라 어느 소스 파일이든 범위 안이다', () => {
    const order = IntakeDto.fallback('고쳐줘').toOpenWorkOrder().toEntity('w');
    expect(order.outOfScope(['src/a.ts', 'packages/x/y.tsx', 'README.md'])).toEqual([]);
  });
});
