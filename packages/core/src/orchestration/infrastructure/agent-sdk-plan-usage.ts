import { query } from '@anthropic-ai/claude-agent-sdk';
import { PlanUsageDto, type PlanUsage } from '../application/dto/plan-usage.dto.js';

/**
 * Claude Code /usage와 같은 구독 사용률을 SDK에서 받아 온다. 프롬프트를 보내지 않는 세션이라 모델을 부르지 않는다
 * (재 보니 1.6초, 비용 $0). 구독 토큰은 rauha가 읽지 않고 SDK가 프로필의 CLAUDE_CONFIG_DIR로 처리한다.
 * SDK에서 실험 중인 기능이라 실패하거나 모양이 바뀌면 null을 돌려준다.
 */
export async function readPlanUsage(env: Record<string, string>, timeoutMs = 15_000, claudeExecutable?: string): Promise<PlanUsage | null> {
  let release: () => void = () => {};
  const idle = (async function* () {
    await new Promise<void>((resolve) => (release = resolve));
  })();
  const session = query({ prompt: idle, options: { env, settingSources: [], ...(claudeExecutable !== undefined ? { pathToClaudeCodeExecutable: claudeExecutable } : {}) } });
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), timeoutMs)));
    const raw = await Promise.race([session.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }), timeout]);
    return PlanUsageDto.from(raw);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    release();
    session.close();
  }
}
