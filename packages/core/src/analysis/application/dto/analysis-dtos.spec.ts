import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../shared/domain-error.js';
import { BlueprintDto, DirectionsDto, InvestigationDto, redactSecrets } from './analysis-dtos.js';

const investigationOut = {
  symptom: '결제가 두 번 깎인다',
  facts: [{ text: '재시도가 같은 번호로 승인을 다시 부른다', evidence: 'packages/api/src/pay/retry.ts:42' }],
  causes: [{ text: '멱등 키가 없다', confidence: 'high', check: '재시도 직전 로그' }],
  unknowns: [],
};

const directionsOut = {
  options: [
    { id: 'a', title: '멱등 키', summary: '키를 붙인다', pros: ['단순'], cons: [], risk: '호출부 변경', reversibility: 'easy', touches: ['packages/api/src/pay'] },
    { id: 'b', title: '락', summary: '락을 건다', pros: [], cons: ['느림'], risk: '교착', reversibility: 'medium', touches: [] },
  ],
  recommendedId: 'a',
  recommendedReason: '되돌리기 쉽다',
};

const blueprintOut = {
  goal: '한 번만 결제',
  nonGoals: [],
  changes: [{ where: 'packages/api/src/pay', what: '키' }],
  flow: ['요청 → 키 → 승인'],
  edgeCases: ['동시 두 번'],
  rejected: [{ option: '락', whyNot: '느리다' }],
  testStrategy: '가짜 PG',
  steps: [{ title: '키 값 객체', testFirst: '같은 키는 한 번', files: ['a.ts'], verify: 'yarn test' }],
  risks: [],
};

describe('InvestigationDto', () => {
  it('팀원 출력을 읽어 조사 결과로 바꾼다', () => {
    const inv = InvestigationDto.from(investigationOut).toEntity();
    expect(inv.symptom).toBe('결제가 두 번 깎인다');
    expect(inv.facts[0]!.evidence).toBe('packages/api/src/pay/retry.ts:42');
  });

  it('객체가 아니거나 증상이 없으면 거절한다', () => {
    expect(() => InvestigationDto.from(null)).toThrow(DomainError);
    expect(() => InvestigationDto.from({ ...investigationOut, symptom: '' })).toThrow(DomainError);
  });

  it('근거 없는 사실은 도메인이 거절한다', () => {
    expect(() => InvestigationDto.from({ ...investigationOut, facts: [{ text: 'x', evidence: '' }] }).toEntity()).toThrow(DomainError);
  });

  it('마크다운에 사실·근거·원인 후보·모르는 것이 절로 나온다', () => {
    const md = InvestigationDto.toMarkdown(InvestigationDto.from({ ...investigationOut, unknowns: ['PG 정책'] }).toEntity());
    expect(md).toContain('### 확인한 사실');
    expect(md).toContain('`packages/api/src/pay/retry.ts:42`');
    expect(md).toContain('### 원인 후보');
    expect(md).toContain('확신도 높음');
    expect(md).toContain('### 아직 모르는 것');
    expect(md).toContain('PG 정책');
  });
});

describe('DirectionsDto', () => {
  it('방향을 읽어 추천과 함께 값 객체로 만든다', () => {
    const set = DirectionsDto.from(directionsOut).toEntity();
    expect(set.options).toHaveLength(2);
    expect(set.recommended().title).toBe('멱등 키');
  });

  it('방향이 배열이 아니면 거절한다', () => {
    expect(() => DirectionsDto.from({ ...directionsOut, options: 'x' })).toThrow(DomainError);
  });

  it('마크다운에서 AI 추천을 표시하고, 사용자가 고른 방향과 이유를 함께 남긴다', () => {
    const set = DirectionsDto.from(directionsOut).toEntity();
    const choice = set.choose({ kind: 'pick', id: 'b', reason: '락이 더 단순하다' });
    const md = DirectionsDto.toMarkdown(set, choice);
    expect(md).toContain('#### 방향 a. 멱등 키 (AI 추천)');
    expect(md).toContain('#### 방향 b. 락');
    expect(md).not.toContain('방향 b. 락 (AI 추천)');
    expect(md).toContain('되돌리기: 쉬움');
    expect(md).toContain('AI 추천: 멱등 키');
    expect(md).toContain('내 선택: 락 (AI 추천과 다르게 골랐어요)');
    expect(md).toContain('이유: 락이 더 단순하다');
  });

  it('아직 고르지 않았으면 선택 줄 대신 기다리는 중이라고 쓴다', () => {
    const md = DirectionsDto.toMarkdown(DirectionsDto.from(directionsOut).toEntity(), null);
    expect(md).toContain('아직 고르지 않았어요');
  });

  it('직접 쓴 방향은 그대로 남긴다', () => {
    const set = DirectionsDto.from(directionsOut).toEntity();
    const md = DirectionsDto.toMarkdown(set, set.choose({ kind: 'custom', text: '통째로 새로 만든다' }));
    expect(md).toContain('내 선택: 통째로 새로 만든다 (직접 쓴 방향');
  });
});

describe('BlueprintDto', () => {
  it('설계와 단계별 계획을 읽는다', () => {
    const bp = BlueprintDto.from(blueprintOut).toEntity();
    expect(bp.steps[0]!.number).toBe(1);
  });

  it('단계에 확인 명령이 없으면 도메인이 거절한다', () => {
    expect(() => BlueprintDto.from({ ...blueprintOut, steps: [{ title: 't', testFirst: 'x', files: ['a'], verify: '' }] }).toEntity()).toThrow(DomainError);
  });

  it('마크다운에 설계 절과 계획 절이 나뉘고, 계획 단계마다 테스트·파일·확인이 있다', () => {
    const md = BlueprintDto.toMarkdown(BlueprintDto.from(blueprintOut).toEntity());
    expect(md.design).toContain('### 목표');
    expect(md.design).toContain('### 비목표');
    expect(md.design).toContain('### 바뀌는 지점');
    expect(md.design).toContain('### 데이터 흐름');
    expect(md.design).toContain('### 엣지 케이스');
    expect(md.design).toContain('### 버린 안');
    expect(md.design).toContain('### 테스트 전략');
    expect(md.plan).toContain('### 1. 키 값 객체');
    expect(md.plan).toContain('먼저 쓸 테스트: 같은 키는 한 번');
    expect(md.plan).toContain('확인: `yarn test`');
  });
});

describe('redactSecrets', () => {
  it('키·토큰·비밀번호 모양을 가린다', () => {
    const text = '키는 sk-abcdefghijklmnopqrstuvwxyz123456 이고 password=hunter2hunter, AKIAABCDEFGHIJKLMNOP, ghp_abcdefghijklmnopqrstuvwxyz0123';
    const out = redactSecrets(text);
    expect(out).not.toContain('sk-abcdefghijklmnop');
    expect(out).not.toContain('hunter2hunter');
    expect(out).not.toContain('AKIAABCDEFGHIJKLMNOP');
    expect(out).not.toContain('ghp_abcdefghij');
    expect(out).toContain('[값 가림]');
  });

  it('일반 글은 그대로 두고, 여러 번 거쳐도 같다', () => {
    const text = '결제 재시도 로직을 packages/api/src/pay/retry.ts:42 에서 본다. 커밋 a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
    expect(redactSecrets(text)).toBe(text);
    const once = redactSecrets('token: abcd1234efgh');
    expect(redactSecrets(once)).toBe(once);
  });
});
