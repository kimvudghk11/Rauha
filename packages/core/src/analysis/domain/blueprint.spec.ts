import { describe, expect, it } from 'vitest';
import { DomainError } from '../../shared/domain-error.js';
import { Blueprint, type BlueprintInput, type PlanStepInput } from './blueprint.js';

const step = (title = '멱등 키 값 객체'): PlanStepInput => ({ title, testFirst: '같은 키로 두 번 승인하면 한 번만 깎인다', files: ['packages/api/src/pay/idempotency.ts'], verify: 'yarn vitest run packages/api/src/pay' });

const input = (over: Partial<BlueprintInput> = {}): BlueprintInput => ({
  goal: '재시도해도 한 번만 결제되게 한다',
  nonGoals: ['환불 흐름은 건드리지 않는다'],
  changes: [{ where: 'packages/api/src/pay', what: '승인 호출에 멱등 키를 붙인다' }],
  flow: ['요청 → 키 만들기 → 승인 → 저장'],
  edgeCases: ['같은 키로 동시에 두 번 요청'],
  rejected: [{ option: '결제 단계에서 계산', whyNot: '주문 금액과 달라진다' }],
  testStrategy: '값 객체는 목 없이, 서비스는 가짜 PG로',
  steps: [step()],
  risks: [],
  ...over,
});

describe('Blueprint', () => {
  it('계획의 모든 단계에는 먼저 쓸 테스트, 바꿀 파일, 확인 명령이 있어야 한다', () => {
    expect(() => Blueprint.of(input({ steps: [{ ...step(), testFirst: ' ' }] }))).toThrow(DomainError);
    expect(() => Blueprint.of(input({ steps: [{ ...step(), files: [] }] }))).toThrow(DomainError);
    expect(() => Blueprint.of(input({ steps: [{ ...step(), verify: '' }] }))).toThrow(DomainError);
  });

  it('계획 단계는 1개에서 8개까지다', () => {
    expect(() => Blueprint.of(input({ steps: [] }))).toThrow(DomainError);
    expect(() => Blueprint.of(input({ steps: Array.from({ length: 9 }, (_, i) => step(`단계 ${i}`)) }))).toThrow(DomainError);
    expect(Blueprint.of(input({ steps: Array.from({ length: 8 }, (_, i) => step(`단계 ${i}`)) })).steps).toHaveLength(8);
  });

  it('목표가 비어 있으면 만들 수 없다', () => {
    expect(() => Blueprint.of(input({ goal: '' }))).toThrow(DomainError);
  });

  it('바뀌는 곳이 하나도 없는 설계는 거절한다', () => {
    expect(() => Blueprint.of(input({ changes: [] }))).toThrow(DomainError);
  });

  it('계획이 손대는 파일을 한 번씩 모아 준다', () => {
    const bp = Blueprint.of(input({ steps: [step('a'), { ...step('b'), files: ['packages/api/src/pay/idempotency.ts', 'packages/api/src/pay/pay.ts'] }] }));
    expect(bp.filesTouched()).toEqual(['packages/api/src/pay/idempotency.ts', 'packages/api/src/pay/pay.ts']);
  });
});
