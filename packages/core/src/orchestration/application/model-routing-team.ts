import { ModelFallback } from '../domain/model-fallback.js';
import type { ModelNames } from '../domain/model-names.js';
import type { MemberCall, MemberResult, PreparedCall, TeamMemberPort } from './ports.js';

/**
 * 팀원 호출마다 설정에서 정한 등급별 모델 ID를 붙여 안쪽 팀원(SDK 어댑터)에게 넘긴다.
 * 이름은 부를 때마다 읽어서, 설정을 바꾸면 다음 호출부터 바로 반영된다.
 *
 * 모델을 쓸 수 없다는 오류(없음·권한 없음)로 실패하면 ModelFallback 이 정한 순서
 * (같은 등급의 이전 버전 → 한 단계 낮은 등급, 최대 2번)로 다시 부르고, 대체했으면 한 줄로 알린다.
 */
export class ModelRoutingTeam implements TeamMemberPort {
  constructor(
    private readonly inner: TeamMemberPort,
    private readonly names: () => ModelNames,
    /** 모델을 대체해서 실행했을 때 사용자에게 보일 한 줄 */
    private readonly onFallback: (line: string) => void = () => undefined,
  ) {}

  async run(call: MemberCall): Promise<MemberResult> {
    const names = this.names();
    const fallback = ModelFallback.start(names, call.setting.tier);
    let result = await this.inner.run({ ...call, model: names.idOf(call.setting.tier) });
    let step = fallback.next(result.error, result.blocked != null);
    while (step !== null) {
      result = await this.inner.run({ ...call, model: step.model });
      step = fallback.next(result.error, result.blocked != null);
    }
    const line = fallback.notice(result.error);
    if (line !== null) this.onFallback(line);
    return result;
  }

  prepare(call: PreparedCall): void {
    this.inner.prepare?.({ ...call, model: this.names().idOf(call.setting.tier) });
  }
}
