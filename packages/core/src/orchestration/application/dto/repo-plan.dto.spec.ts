import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../shared/domain-error.js';
import { ContractCheckDto, RepoPlanDto } from './repo-plan.dto.js';

const REPOS = ['shop-api', 'shop-web'];
const output = (over: Record<string, unknown> = {}) => ({
  parts: [
    { repo: 'shop-api', request: '주문 응답에 couponDiscount를 넣는다', dependsOn: [] },
    { repo: 'shop-web', request: '주문 상세에 쿠폰 할인 줄을 보여 준다', dependsOn: ['shop-api'] },
  ],
  contract: [{ what: '주문 응답의 쿠폰 할인액', between: ['shop-api', 'shop-web'], shape: 'GET /orders/:id → { couponDiscount: number }' }],
  edgeCases: [{ case: 'couponDiscount가 없는 예전 응답', handling: '할인 줄을 숨긴다', repo: 'shop-web' }],
  decisions: ['할인액은 원 단위 정수'],
  ...over,
});

describe('RepoPlanDto', () => {
  it('나누기 팀원 출력을 검증된 계획과 rauha가 정한 것으로 읽는다', () => {
    const { plan, decisions } = RepoPlanDto.from(output(), REPOS);
    expect(plan.order().map((p) => p.repo)).toEqual(['shop-api', 'shop-web']);
    expect(decisions).toEqual(['할인액은 원 단위 정수']);
  });

  it.each([
    ['모양이 틀린 출력', 'oops'],
    ['작업 공간에 없는 저장소', output({ parts: [{ repo: 'nope', request: 'x', dependsOn: [] }], contract: [], edgeCases: [] })],
  ])('%s는 거절한다', (_n, bad) => {
    expect(() => RepoPlanDto.from(bad, REPOS)).toThrow(DomainError);
  });

  it('저장소에 넘길 일에는 그 저장소의 엣지 케이스를 붙이고, 블록에는 약속·앞 저장소가 바꾼 파일을 담는다', () => {
    const { plan } = RepoPlanDto.from(output(), REPOS);
    const web = plan.parts[1]!;
    const { request, block } = RepoPlanDto.task(plan, web, [{ repo: 'shop-api', title: '쿠폰 할인액 응답', files: ['src/order/order.dto.ts'] }]);
    expect(request).toContain('주문 상세에 쿠폰 할인 줄을 보여 준다');
    expect(request).toContain('엣지 케이스: couponDiscount가 없는 예전 응답 → 할인 줄을 숨긴다');
    expect(block).toContain('<repos_contract repo="shop-web">');
    expect(block).toContain('GET /orders/:id → { couponDiscount: number }');
    expect(block).toContain('shop-api: 쿠폰 할인액 응답');
    expect(block).toContain('src/order/order.dto.ts');
  });
});

describe('ContractCheckDto', () => {
  it('어긋난 약속은 고칠 저장소와 고칠 점을 함께 읽는다', () => {
    const { plan } = RepoPlanDto.from(output(), REPOS);
    const check = ContractCheckDto.from(
      { items: [{ what: '주문 응답의 쿠폰 할인액', ok: false, repo: 'shop-web', fix: 'coupon_discount가 아니라 couponDiscount를 읽는다', evidence: 'src/order.tsx:12 order.coupon_discount' }] },
      plan,
    );
    expect(check.mismatches()).toEqual([{ what: '주문 응답의 쿠폰 할인액', repo: 'shop-web', fix: 'coupon_discount가 아니라 couponDiscount를 읽는다', evidence: 'src/order.tsx:12 order.coupon_discount' }]);
  });

  it('고칠 저장소가 계획에 없거나 고칠 점이 없는 불일치는 고치기에 넣지 않고 맞지 않음으로만 남긴다', () => {
    const { plan } = RepoPlanDto.from(output(), REPOS);
    const check = ContractCheckDto.from({ items: [{ what: 'x', ok: false, repo: 'admin', fix: 'y', evidence: 'z' }, { what: 'w', ok: false, repo: 'shop-web', fix: null, evidence: 'z' }] }, plan);
    expect(check.mismatches()).toEqual([]);
    expect(check.items.filter((i) => !i.ok)).toHaveLength(2);
  });

  it('읽을 수 없는 출력은 검사하지 못한 것으로 둔다', () => {
    const { plan } = RepoPlanDto.from(output(), REPOS);
    expect(ContractCheckDto.from('oops', plan).items).toEqual([]);
  });
});
