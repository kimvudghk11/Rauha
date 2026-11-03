import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../shared/domain-error.js';
import { DesignDocDto, DesignReplyDto } from './design.dto.js';

const draftOutput = (over: Record<string, unknown> = {}) => ({
  status: 'draft',
  question: null,
  suggestion: null,
  design: {
    title: '쿠폰 할인',
    purpose: '주문 금액에 쿠폰을 적용한다',
    goals: ['쿠폰 코드로 할인'],
    nonGoals: ['쿠폰 발급'],
    scenarios: [{ given: '10,000원 주문', when: '10% 쿠폰을 적용하면', then: '9,000원이 된다' }],
    decisions: [
      { what: '할인액은 원 미만을 버린다', by: 'rauha' },
      { what: '쿠폰은 주문당 1개', by: 'user' },
    ],
    tasks: [
      { id: 't1', title: 'Coupon 값 객체', scope: ['src/coupon/**'], acceptance: ['10% 쿠폰은 10,000원을 9,000원으로'], dependsOn: [] },
      { id: 't2', title: '주문에 쿠폰 적용', scope: ['src/order/**'], acceptance: ['쿠폰 둘이면 거절'], dependsOn: ['t1'] },
    ],
    risks: ['환불 시 쿠폰 복원은 다루지 않음'],
    architecture: {
      overview: '주문 도메인에 Coupon 값 객체를 두고 Order가 쓴다',
      components: [
        { name: 'Coupon', responsibility: '할인율 검증과 할인액 계산', location: 'src/coupon/coupon.ts' },
        { name: 'Order.applyCoupon', responsibility: '쿠폰 하나만 받아 금액을 다시 계산', location: 'src/order/order.ts' },
      ],
      flow: ['주문 API가 쿠폰 코드를 받는다', 'Order.applyCoupon이 Coupon으로 금액을 계산한다'],
      alternatives: [{ option: '결제 단계에서 할인 계산', whyNot: '주문 금액과 결제 금액이 달라져 환불이 꼬인다' }],
    },
    edgeCases: [
      { case: '할인율 0% 또는 100% 초과', handling: '쿠폰을 만들 때 거절', task: 't1' },
      { case: '같은 주문에 쿠폰을 두 번 적용', handling: '두 번째는 거절하고 금액은 그대로', task: 't2' },
    ],
  },
  ...over,
});

describe('DesignReplyDto.from', () => {
  it('질문 답이면 질문과 추천을 꺼낸다', () => {
    const reply = DesignReplyDto.from({ status: 'ask', question: '쿠폰은 중복 사용이 되나요?', suggestion: '주문당 1개', design: null });
    expect(reply).toEqual({ kind: 'ask', question: '쿠폰은 중복 사용이 되나요?', suggestion: '주문당 1개' });
  });

  it('추천이 없는 질문은 추천을 null로 둔다', () => {
    expect(DesignReplyDto.from({ status: 'ask', question: '무엇을 만들까요?', suggestion: '  ', design: null })).toMatchObject({ kind: 'ask', suggestion: null });
  });

  it('설계안이면 검증된 설계를 만든다', () => {
    const reply = DesignReplyDto.from(draftOutput());
    expect(reply.kind).toBe('draft');
    if (reply.kind === 'draft') expect(reply.design.runOrder().map((t) => t.id)).toEqual(['t1', 't2']);
  });

  it.each([
    ['모양이 틀린 출력', 'oops'],
    ['질문 답인데 질문이 빈 경우', { status: 'ask', question: ' ', suggestion: null, design: null }],
    ['설계안인데 설계가 없는 경우', { status: 'draft', question: null, suggestion: null, design: null }],
    ['설계안에 엣지 케이스가 없는 경우', draftOutput({ design: { ...draftOutput().design, edgeCases: [] } })],
    ['설계안에 구조가 없는 경우', draftOutput({ design: { ...draftOutput().design, architecture: undefined } })],
    ['설계안의 작업이 순환하는 경우', draftOutput({ design: { ...draftOutput().design, tasks: [{ id: 't1', title: 'a', scope: ['a'], acceptance: ['a'], dependsOn: ['t1'] }] } })],
  ])('%s 거부한다', (_name, output) => {
    expect(() => DesignReplyDto.from(output)).toThrow(DomainError);
  });
});

describe('DesignDocDto', () => {
  const design = () => {
    const reply = DesignReplyDto.from(draftOutput());
    if (reply.kind !== 'draft') throw new Error('draft expected');
    return reply.design;
  };

  it('설계 문서에는 의도·시나리오·정한 해석(누가 정했는지)·작업 목록·위험이 들어간다', () => {
    const md = DesignDocDto.toMarkdown(design(), { repo: 'shop-api', basis: 'main (a1b2c3d)', date: '2026-10-29', request: '쿠폰 기능 만들어줘' });
    expect(md).toContain('# 쿠폰 할인');
    expect(md).toContain('shop-api');
    expect(md).toContain('main (a1b2c3d)');
    expect(md).toContain('쿠폰 기능 만들어줘');
    expect(md).toContain('Given 10,000원 주문');
    expect(md).toContain('Then 9,000원이 된다');
    expect(md).toContain('사용자가 정함');
    expect(md).toContain('rauha가 정함');
    expect(md).toContain('t2');
    expect(md).toContain('의존: t1');
    expect(md).toContain('환불 시 쿠폰 복원은 다루지 않음');
    expect(md).toContain('## 구조');
    expect(md).toContain('Coupon: 할인율 검증과 할인액 계산 (src/coupon/coupon.ts)');
    expect(md).toContain('1. 주문 API가 쿠폰 코드를 받는다');
    expect(md).toContain('결제 단계에서 할인 계산: 주문 금액과 결제 금액이 달라져 환불이 꼬인다');
    expect(md).toContain('## 엣지 케이스');
    expect(md).toContain('같은 주문에 쿠폰을 두 번 적용 → 두 번째는 거절하고 금액은 그대로 (t2)');
  });

  it('승인 화면 요약은 목적·rauha가 정한 것·작업 목록을 짧게 보여 준다', () => {
    const lines = DesignDocDto.summary(design());
    const text = lines.join('\n');
    expect(text).toContain('쿠폰 할인');
    expect(text).toContain('rauha가 정한 것');
    expect(text).toContain('할인액은 원 미만을 버린다');
    expect(text).toContain('1. Coupon 값 객체');
    expect(text).toContain('2. 주문에 쿠폰 적용');
    expect(text).toContain('구조: 주문 도메인에 Coupon 값 객체를 두고 Order가 쓴다');
    expect(text).toContain('엣지 케이스 2개');
    expect(lines.length).toBeLessThan(30);
  });

  it('작업 요청은 설계의 목적·시나리오·정한 해석과 그 작업의 범위·수용 기준을 담고 승인된 설계임을 밝힌다', () => {
    const d = design();
    const { request, block } = DesignDocDto.taskRequest(d, d.tasks[1]!, 'C:/designs/a.md');
    expect(request).toContain('주문에 쿠폰 적용');
    expect(request).toContain('쿠폰 둘이면 거절');
    expect(block).toContain('<design');
    expect(block).toContain('C:/designs/a.md');
    expect(block).toContain('Given 10,000원 주문');
    expect(block).toContain('쿠폰은 주문당 1개');
    expect(block).toContain('src/order/**');
    expect(block).toContain('승인');
    expect(block).toContain('구조: 주문 도메인에 Coupon 값 객체를 두고 Order가 쓴다');
    expect(block).toContain('Order.applyCoupon');
    // 이 작업이 맡은 엣지 케이스만, 수용 기준과 함께 테스트로 먼저 잠그라고 넘긴다.
    expect(block).toContain('같은 주문에 쿠폰을 두 번 적용');
    expect(block).not.toContain('할인율 0% 또는 100% 초과');
    expect(request).toContain('같은 주문에 쿠폰을 두 번 적용');
  });
});
