/** 메인 채팅 말 하나가 어디로 가는지. 기본은 원문 그대로 Claude(direct), /work 로 시작하면 팀 흐름(라우터 → 테스트 먼저·구현·리뷰). */
export interface WorkModeOf {
  readonly team: boolean;
  /** 팀원에게 넘길 글(/work 를 뺀 것). 보통 말은 원문 그대로 */
  readonly text: string;
}

const TEAM_PREFIX = /^\s*\/work(?:\s+)([\s\S]*\S[\s\S]*)$/i;

/**
 * 라우터는 길잡이일 뿐 사용자 말을 다른 일로 끌고 가지 않는다(2026-11-24 사용자 결정).
 * 팀 흐름은 사용자가 /work 로 분명히 시킬 때만 탄다.
 */
export class WorkMode {
  private constructor() {}

  static of(request: string): WorkModeOf {
    const m = TEAM_PREFIX.exec(request);
    return m === null ? { team: false, text: request } : { team: true, text: m[1]!.trim() };
  }
}
