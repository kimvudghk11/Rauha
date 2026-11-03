import { describe, expect, it } from 'vitest';
import { DomainError } from '../../shared/domain-error.js';
import { RepoPlan, type RepoPlanProps, type RepoPart } from './repo-plan.js';

const REPOS = ['shop-api', 'shop-web', 'shop-app', 'admin'];
const part = (repo: string, dependsOn: string[] = []): RepoPart => ({ repo, request: `${repo}에 쿠폰 반영`, dependsOn });
const props = (over: Partial<RepoPlanProps> = {}): RepoPlanProps => ({
  parts: [part('shop-api'), part('shop-web', ['shop-api']), part('shop-app', ['shop-api'])],
  contract: [{ what: '주문 응답의 쿠폰 할인액', between: ['shop-api', 'shop-web', 'shop-app'], shape: 'GET /orders/:id → { couponDiscount: number }' }],
  edgeCases: [{ case: '쿠폰 필드가 없는 예전 응답', handling: '할인 줄을 숨긴다', repo: 'shop-web' }],
  ...over,
});

describe('RepoPlan', () => {
  it('먼저 만들어야 하는 저장소부터 시작할 수 있다 (API가 끝나야 웹·앱을 시작한다)', () => {
    const plan = RepoPlan.of(props(), REPOS);
    expect(plan.startable(new Set(), new Set()).map((p) => p.repo)).toEqual(['shop-api']);
    expect(plan.startable(new Set(['shop-api']), new Set(['shop-api'])).map((p) => p.repo)).toEqual(['shop-web', 'shop-app']);
  });

  it('서로 기다릴 필요가 없는 저장소는 함께 시작할 수 있다', () => {
    const plan = RepoPlan.of(props({ parts: [part('shop-web'), part('admin')], contract: [] }), REPOS);
    expect(plan.startable(new Set(), new Set()).map((p) => p.repo)).toEqual(['shop-web', 'admin']);
  });

  it('이미 시작한 저장소는 다시 내주지 않는다', () => {
    const plan = RepoPlan.of(props({ parts: [part('shop-web'), part('admin')], contract: [] }), REPOS);
    expect(plan.startable(new Set(), new Set(['shop-web'])).map((p) => p.repo)).toEqual(['admin']);
  });

  it('앞 저장소가 멈추면 그것에 (간접으로도) 기대는 저장소는 막힌다', () => {
    const plan = RepoPlan.of(props({ parts: [part('shop-api'), part('shop-web', ['shop-api']), part('admin', ['shop-web'])], contract: [] }), REPOS);
    expect(plan.isBlocked('admin', new Set(['shop-api']))).toBe(true);
    expect(plan.isBlocked('shop-api', new Set(['shop-web']))).toBe(false);
  });

  it('저장소마다 그 저장소가 낀 약속과 엣지 케이스만 돌려준다', () => {
    const plan = RepoPlan.of(props({ contract: [
      { what: '쿠폰 할인액', between: ['shop-api', 'shop-web'], shape: '{ couponDiscount: number }' },
      { what: '앱 푸시', between: ['shop-api', 'shop-app'], shape: 'event coupon.applied' },
    ] }), REPOS);
    expect(plan.contractFor('shop-web').map((c) => c.what)).toEqual(['쿠폰 할인액']);
    expect(plan.contractFor('shop-api').map((c) => c.what)).toEqual(['쿠폰 할인액', '앱 푸시']);
    expect(plan.edgeCasesOf('shop-web').map((e) => e.case)).toEqual(['쿠폰 필드가 없는 예전 응답']);
    expect(plan.edgeCasesOf('shop-api')).toEqual([]);
  });

  it('보여 줄 순서는 먼저 만들 저장소가 앞이다', () => {
    const plan = RepoPlan.of(props({ parts: [part('shop-web', ['shop-api']), part('shop-api')], contract: [] }), REPOS);
    expect(plan.order().map((p) => p.repo)).toEqual(['shop-api', 'shop-web']);
  });

  it.each([
    ['고칠 저장소가 하나도 없으면', props({ parts: [], contract: [], edgeCases: [] })],
    ['작업 공간에 없는 저장소면', props({ parts: [part('nope')], contract: [], edgeCases: [] })],
    ['같은 저장소가 두 번 나오면', props({ parts: [part('shop-api'), part('shop-api')], contract: [], edgeCases: [] })],
    ['자기 자신을 기다리면', props({ parts: [part('shop-api', ['shop-api'])], contract: [], edgeCases: [] })],
    ['계획에 없는 저장소를 기다리면', props({ parts: [part('shop-web', ['shop-api'])], contract: [], edgeCases: [] })],
    ['서로를 기다려 순서가 돌면', props({ parts: [part('shop-api', ['shop-web']), part('shop-web', ['shop-api'])], contract: [], edgeCases: [] })],
    ['약속이 저장소 하나에만 걸리면', props({ contract: [{ what: 'x', between: ['shop-api'], shape: 'y' }] })],
    ['약속에 계획에 없는 저장소가 끼면', props({ contract: [{ what: 'x', between: ['shop-api', 'admin'], shape: 'y' }] })],
    ['엣지 케이스를 맡은 저장소가 계획에 없으면', props({ edgeCases: [{ case: 'x', handling: 'y', repo: 'admin' }] })],
  ])('%s 거절한다', (_name, bad) => {
    expect(() => RepoPlan.of(bad, REPOS)).toThrow(DomainError);
  });
});
