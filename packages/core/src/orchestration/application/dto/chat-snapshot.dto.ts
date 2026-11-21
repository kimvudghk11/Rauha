/** 대화 세션을 다시 열 때 필요한 것. 비용·호출 수는 새 세션에서 다시 센다. */
export interface ChatSnapshot {
  readonly version: 1;
  readonly turns: readonly { readonly input: string; readonly result: string }[];
  /** 세션 중 rauha가 남긴 파일 → 그때 내용 값 */
  readonly carried: readonly (readonly [string, string])[];
  readonly lastTitle: string | null;
  /** ISO 시각 */
  readonly savedAt: string;
  /** 마지막 깊은 답의 팀원 세션(이어지는 질문이 잇는다). 없으면 새 세션으로 답한다. 옛 파일에는 없다 */
  readonly answerSession?: AnswerSession;
  /** 바로 앞 답(가벼운 답 포함)의 세션과 그 질문 열쇠. "더 깊게"가 잇는다. 옛 파일에는 없다 */
  readonly lastAnswer?: LastAnswer;
}

export interface LastAnswer {
  readonly id: string;
  readonly key: string;
}

function lastAnswerFrom(v: unknown): LastAnswer | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const o = v as Record<string, unknown>;
  return typeof o['id'] === 'string' && o['id'] !== '' && typeof o['key'] === 'string' ? { id: o['id'], key: o['key'] } : undefined;
}

export interface AnswerSession {
  readonly id: string;
  readonly tier: 'sonnet' | 'opus' | 'fable';
  /** epoch ms */
  readonly at: number;
  /** 지금까지 이은 횟수 */
  readonly count: number;
  /** 그 답 때 커밋 안 한 파일 → 내용 해시(다음 질문 전에 바뀐 파일을 알려 주려고). 못 읽었으면 없다 */
  readonly files?: readonly (readonly [string, string])[];
}

const isString = (v: unknown): v is string => typeof v === 'string';

/** 저장본의 answerSession. 모양이 틀리면 버린다(대화 전체를 버리지는 않는다) */
function answerSessionFrom(v: unknown): AnswerSession | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const o = v as Record<string, unknown>;
  const tier = o['tier'];
  if (!isString(o['id']) || o['id'] === '' || (tier !== 'sonnet' && tier !== 'opus' && tier !== 'fable')) return undefined;
  if (typeof o['at'] !== 'number' || !Number.isFinite(o['at']) || typeof o['count'] !== 'number' || !Number.isInteger(o['count']) || o['count'] < 0) return undefined;
  const files = o['files'];
  const validFiles = Array.isArray(files) && files.every((f) => Array.isArray(f) && f.length === 2 && isString(f[0]) && isString(f[1]));
  return { id: o['id'], tier, at: o['at'], count: o['count'], ...(validFiles ? { files: (files as [string, string][]).map(([p, h]) => [p, h] as const) } : {}) };
}

/**
 * 저장해 둔 대화 파일 ↔ 스냅숏. 파일은 rauha 밖에서 바뀌거나 옛 형식일 수 있어서,
 * 모양이 하나라도 틀리면 던지지 않고 null을 돌려준다(새 대화로 시작하면 그만이라서).
 */
export class ChatSnapshotDto {
  private constructor(readonly value: ChatSnapshot) {}

  static of(snapshot: ChatSnapshot): ChatSnapshotDto {
    return new ChatSnapshotDto(snapshot);
  }

  static from(input: unknown): ChatSnapshotDto | null {
    if (typeof input !== 'object' || input === null) return null;
    const o = input as Record<string, unknown>;
    if (o['version'] !== 1 || !isString(o['savedAt'])) return null;
    if (!(o['lastTitle'] === null || isString(o['lastTitle']))) return null;
    const turns = o['turns'];
    const carried = o['carried'];
    if (!Array.isArray(turns) || !Array.isArray(carried)) return null;
    const validTurns = turns.every((t) => typeof t === 'object' && t !== null && isString((t as Record<string, unknown>)['input']) && isString((t as Record<string, unknown>)['result']));
    const validCarried = carried.every((c) => Array.isArray(c) && c.length === 2 && isString(c[0]) && isString(c[1]));
    if (!validTurns || !validCarried) return null;
    const answerSession = answerSessionFrom(o['answerSession']);
    const lastAnswer = lastAnswerFrom(o['lastAnswer']);
    return new ChatSnapshotDto({
      version: 1,
      turns: turns.map((t) => ({ input: (t as { input: string }).input, result: (t as { result: string }).result })),
      carried: carried.map((c) => [c[0] as string, c[1] as string] as const),
      lastTitle: o['lastTitle'] as string | null,
      savedAt: o['savedAt'],
      ...(answerSession !== undefined ? { answerSession } : {}),
      ...(lastAnswer !== undefined ? { lastAnswer } : {}),
    });
  }

  toJson(): string {
    return `${JSON.stringify(this.value, null, 2)}\n`;
  }
}
