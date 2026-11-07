/** 비용은 금액이 아니라 방향만 쓴다(금액은 어디에도 보이지 않는다). */
export type CostDirection = 'up' | 'down' | 'same';
export type Downtime = 'none' | 'brief' | 'long';

/**
 * 인프라 변경을 허락받을 때 운영 팀원이 함께 내놓는 위험도. 모든 칸이 선택이라 못 채운 칸은 null(화면에 "모름"으로 보인다).
 * 운영 팀원은 위험한 명령의 Bash `description` 끝에 `rauha-risk: {...}` 한 줄을 적는다.
 */
export interface InfraRisk {
  /** 영향 범위(어떤 서비스·리소스에 닿는지) 한 줄 */
  readonly scope: string | null;
  readonly downtime: Downtime | null;
  readonly cost: CostDirection | null;
  /** 되돌리는 데 걸리는 시간(예: "5분", "되돌릴 수 없음") */
  readonly rollback: string | null;
  /** qa에 먼저 적용해 봤는지 */
  readonly qaFirst: boolean | null;
}

const MARK = /rauha-risk:\s*(\{.*\})\s*$/s;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const short = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, 120) : null);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | null => (typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null);

/** 위험도 JSON(바깥 입력) → InfraRisk. 틀린 칸은 null로 두고, 모든 칸이 비면 null을 돌려준다. */
export class InfraRiskDto {
  private constructor() {}

  static from(input: unknown): InfraRisk | null {
    if (!isObject(input)) return null;
    const risk: InfraRisk = {
      scope: short(input['scope']),
      downtime: oneOf(input['downtime'], ['none', 'brief', 'long']),
      // 금액("$12", "월 3만원")은 받지 않는다. 방향 낱말만 받는다.
      cost: oneOf(input['cost'], ['up', 'down', 'same']),
      rollback: short(input['rollback']),
      qaFirst: typeof input['qaFirst'] === 'boolean' ? input['qaFirst'] : null,
    };
    return Object.values(risk).every((v) => v === null) ? null : risk;
  }

  /** Bash description 끝의 `rauha-risk: {json}` 줄을 읽는다. 없거나 JSON이 깨졌으면 null. */
  static fromNote(description: unknown): InfraRisk | null {
    if (typeof description !== 'string') return null;
    const m = MARK.exec(description.trim());
    if (m === null) return null;
    try {
      return InfraRiskDto.from(JSON.parse(m[1]!));
    } catch {
      return null;
    }
  }
}
