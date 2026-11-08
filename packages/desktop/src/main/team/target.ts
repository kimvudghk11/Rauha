/** 일을 맡길 곳으로 고를 수 있는 폴더 하나(레포이거나 문서 폴더) */
export interface TargetFolder {
  readonly name: string;
  readonly root: string;
}

export interface ParsedRequest {
  /** @이름으로 고른 폴더. 없으면 null(작업 폴더 그대로) */
  readonly folder: TargetFolder | null;
  /** @이름을 뺀 요청 글 */
  readonly text: string;
  /** @이름을 적었는데 맞는 폴더가 없으면 그 이름 */
  readonly unknown: string | null;
}

const MENTION = /^@([^\s@]+)\s*/;

/** "@api-server 결제 원인 찾아줘"처럼 앞에 @폴더이름을 적으면 대상 폴더를 정한다. 이름은 대소문자를 가리지 않는다. */
export function parseTarget(request: string, folders: readonly TargetFolder[]): ParsedRequest {
  const trimmed = request.trim();
  const m = MENTION.exec(trimmed);
  if (m === null) return { folder: null, text: trimmed, unknown: null };
  const name = m[1]!;
  const folder = folders.find((f) => f.name.toLowerCase() === name.toLowerCase()) ?? null;
  const rest = trimmed.slice(m[0].length).trim();
  if (folder === null) return { folder: null, text: trimmed, unknown: name };
  return { folder, text: rest === '' ? trimmed : rest, unknown: null };
}
