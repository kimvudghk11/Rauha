import { describe, expect, it } from 'vitest';
import { DomainError } from '../../shared/domain-error.js';
import { Design, isDelegation, type DesignProps, type DesignTask } from './design.js';

const task = (id: string, dependsOn: string[] = [], over: Partial<DesignTask> = {}): DesignTask => ({
  id,
  title: `작업 ${id}`,
  scope: [`src/${id}/**`],
  acceptance: ['10% 할인하면 10,000원이 9,000원이 된다'],
  dependsOn,
  ...over,
});

const props = (tasks: DesignTask[] = [task('t1')], over: Partial<DesignProps> = {}): DesignProps => ({
  title: '쿠폰 할인',
  purpose: '주문 금액에 쿠폰을 적용한다',
  goals: ['쿠폰 코드로 할인'],
  nonGoals: ['쿠폰 발급'],
  scenarios: [{ given: '10,000원 주문', when: '10% 쿠폰을 적용하면', then: '9,000원이 된다' }],
  decisions: [{ what: '할인액은 원 미만을 버린다', by: 'rauha' }],
  tasks,
  risks: [],
  architecture: {
    overview: '주문 도메인에 Coupon 값 객체를 두고 Order.applyCoupon이 금액을 바꾼다',
    components: [{ name: 'Coupon', responsibility: '할인율 검증과 할인액 계산', location: 'src/t1/coupon.ts' }],
    flow: ['주문 API가 쿠폰 코드를 받는다', 'Order.applyCoupon이 Coupon으로 금액을 다시 계산한다'],
    alternatives: [{ option: '할인을 결제 단계에서 계산', whyNot: '주문 금액과 결제 금액이 달라져 환불 계산이 꼬인다' }],
  },
  edgeCases: [{ case: '할인액에 원 미만이 생기는 금액(9,999원에 10%)', handling: '원 미만은 버려 9,000원', task: 't1' }],
  ...over,
});

describe('Design', () => {
  it('작업마다 그 작업이 맡은 엣지 케이스를 돌려준다 (테스트로 먼저 잠그게)', () => {
    const design = Design.of(props([task('t1'), task('t2')], { edgeCases: [
      { case: '빈 쿠폰 코드', handling: '거절', task: 't1' },
      { case: '같은 쿠폰 두 번', handling: '두 번째는 거절', task: 't2' },
      { case: '만료된 쿠폰', handling: '거절', task: 't1' },
    ] }));
    expect(design.edgeCasesOf('t1').map((e) => e.case)).toEqual(['빈 쿠폰 코드', '만료된 쿠폰']);
    expect(design.edgeCasesOf('t2').map((e) => e.case)).toEqual(['같은 쿠폰 두 번']);
  });


  it('제목·목적·시나리오·작업이 갖춰지면 만든다', () => {
    expect(Design.of(props()).tasks).toHaveLength(1);
  });

  it.each([
    ['제목이 비면', props([task('t1')], { title: ' ' })],
    ['시나리오가 하나도 없으면', props([task('t1')], { scenarios: [] })],
    ['작업이 하나도 없으면', props([])],
    ['작업이 9개를 넘으면', props(Array.from({ length: 9 }, (_, i) => task(`t${i + 1}`)))],
    ['작업 id가 겹치면', props([task('t1'), task('t1')])],
    ['없는 작업에 의존하면', props([task('t1', ['t9'])])],
    ['자기 자신에 의존하면', props([task('t1', ['t1'])])],
    ['순환으로 의존하면', props([task('t1', ['t2']), task('t2', ['t1'])])],
    ['작업에 수용 기준이 없으면', props([task('t1', [], { acceptance: [] })])],
    ['엣지 케이스가 하나도 없으면', props([task('t1')], { edgeCases: [] })],
    ['엣지 케이스를 맡은 작업이 없으면', props([task('t1')], { edgeCases: [{ case: '빈 쿠폰 코드', handling: '거절', task: 't9' }] })],
    ['구조 설명이 비면', props([task('t1')], { architecture: { overview: ' ', components: [{ name: 'A', responsibility: 'a', location: 'src/a.ts' }], flow: [], alternatives: [] } })],
    ['구성 요소가 하나도 없으면', props([task('t1')], { architecture: { overview: '개요', components: [], flow: [], alternatives: [] } })],
    ['작업에 범위가 없으면', props([task('t1', [], { scope: [] })])],
  ])('%s 거부한다', (_name, bad) => {
    expect(() => Design.of(bad)).toThrow(DomainError);
  });

  it('작업은 의존하는 작업이 먼저 오도록, 그 밖에는 적은 순서대로 늘어놓는다', () => {
    const design = Design.of(props([task('t1', ['t3']), task('t2'), task('t3')]));
    expect(design.runOrder().map((t) => t.id)).toEqual(['t2', 't3', 't1']);
  });

  it('앞 작업이 멈췄으면 그것에 (간접으로도) 의존하는 작업만 막힌다', () => {
    const design = Design.of(props([task('t1'), task('t2', ['t1']), task('t3', ['t2']), task('t4')]));
    const failed = new Set(['t1']);
    expect(design.isBlocked('t2', failed)).toBe(true);
    expect(design.isBlocked('t3', new Set(['t2']))).toBe(true);
    expect(design.isBlocked('t4', failed)).toBe(false);
    expect(design.isBlocked('t1', new Set())).toBe(false);
  });

  it('rauha가 정한 결정과 사용자가 정한 결정을 나눈다', () => {
    const design = Design.of(props([task('t1')], { decisions: [{ what: 'A', by: 'user' }, { what: 'B', by: 'rauha' }] }));
    expect(design.decidedBy('rauha').map((d) => d.what)).toEqual(['B']);
    expect(design.decidedBy('user').map((d) => d.what)).toEqual(['A']);
  });
});

describe('isDelegation', () => {
  it.each(['알아서 해', '알아서 정해줘', '그냥 해줘', '추천대로', '추천값으로 해줘', '맡길게', '너가 정해'])('"%s"는 추천값에 맡기는 말', (answer) => {
    expect(isDelegation(answer)).toBe(true);
  });

  it.each(['쿠폰은 1회만 쓸 수 있어', '원 미만은 반올림', ''])('"%s"는 맡기는 말이 아니다', (answer) => {
    expect(isDelegation(answer)).toBe(false);
  });
});
