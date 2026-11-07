import { describe, expect, it } from 'vitest';
import { InfraRiskDto } from './infra-risk.dto.js';

describe('InfraRiskDto.fromNote', () => {
  it('설명 끝의 rauha-risk 줄을 읽는다', () => {
    const note = 'ECS 서비스 desired count를 2로 올림\nrauha-risk: {"scope":"결제 API 서비스","downtime":"none","cost":"up","rollback":"5분","qaFirst":true}';
    expect(InfraRiskDto.fromNote(note)).toEqual({ scope: '결제 API 서비스', downtime: 'none', cost: 'up', rollback: '5분', qaFirst: true });
  });

  it('없는 칸은 null로 둔다', () => {
    expect(InfraRiskDto.fromNote('rauha-risk: {"cost":"down"}')).toEqual({ scope: null, downtime: null, cost: 'down', rollback: null, qaFirst: null });
  });

  it('비용은 방향 낱말만 받고 금액은 버린다', () => {
    expect(InfraRiskDto.fromNote('rauha-risk: {"cost":"$12 늘어남","scope":"x"}')?.cost).toBeNull();
    expect(InfraRiskDto.fromNote('rauha-risk: {"cost":"월 3만원","scope":"x"}')?.cost).toBeNull();
  });

  it('줄이 없거나 JSON이 깨졌거나 모든 칸이 비면 null이다', () => {
    expect(InfraRiskDto.fromNote('그냥 설명')).toBeNull();
    expect(InfraRiskDto.fromNote('rauha-risk: {깨짐}')).toBeNull();
    expect(InfraRiskDto.fromNote('rauha-risk: {"downtime":"몰라"}')).toBeNull();
    expect(InfraRiskDto.fromNote(undefined)).toBeNull();
  });

  it('긴 글은 잘라서 담는다', () => {
    const scope = 'x'.repeat(500);
    expect(InfraRiskDto.fromNote(`rauha-risk: {"scope":"${scope}"}`)?.scope?.length).toBe(120);
  });
});
