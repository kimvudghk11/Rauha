import { SECRET_PATTERNS } from './record-book.js';

/** 채팅 기록에 담기 전에 토큰·키처럼 보이는 값을 가린다(기록 탭과 같은 패턴을 쓴다) */
export function redactSecrets(text: string): string {
  let out = text;
  for (const [pattern, to] of SECRET_PATTERNS) out = out.replace(pattern, to);
  return out;
}
