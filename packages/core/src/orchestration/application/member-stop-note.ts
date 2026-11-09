import { MemberStop } from '../domain/member-stop.js';
import type { MemberResult } from './ports.js';

/** 결과를 못 만들고 멈춘 팀원 호출의 멈춘 이유. 결과가 있거나 멈춘 이유를 SDK가 주지 않았으면 null. */
export function stoppedMember(result: MemberResult): MemberStop | null {
  if (result.output !== null && result.output !== undefined) return null;
  return MemberStop.of({ endReason: result.usage.endReason, denials: result.usage.denials, turns: result.usage.turns });
}
