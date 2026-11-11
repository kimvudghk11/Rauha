import type { ModelNames } from '../domain/model-names.js';
import type { MemberCall, MemberResult, PreparedCall, TeamMemberPort } from './ports.js';

/**
 * 팀원 호출마다 설정에서 정한 등급별 모델 ID를 붙여 안쪽 팀원(SDK 어댑터)에게 넘긴다.
 * 이름은 부를 때마다 읽어서, 설정을 바꾸면 다음 호출부터 바로 반영된다.
 */
export class ModelRoutingTeam implements TeamMemberPort {
  constructor(
    private readonly inner: TeamMemberPort,
    private readonly names: () => ModelNames,
  ) {}

  run(call: MemberCall): Promise<MemberResult> {
    return this.inner.run({ ...call, model: this.names().idOf(call.setting.tier) });
  }

  prepare(call: PreparedCall): void {
    this.inner.prepare?.({ ...call, model: this.names().idOf(call.setting.tier) });
  }
}
