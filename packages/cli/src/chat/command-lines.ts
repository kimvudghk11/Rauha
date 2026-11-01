/** !명령 한 번의 결과를 화면 줄로. 출력은 들여 쓰고, 실패나 시간 초과는 마지막 줄로 알린다. */
export function shellLines(result: { readonly output: string; readonly exitCode: number | null; readonly timedOut: boolean }, timeoutMs: number): string[] {
  const body = result.output.trimEnd();
  const status = result.timedOut ? `  ${timeoutMs / 1000}초가 지나 멈췄어요.` : result.exitCode === 0 ? null : `  종료 코드 ${result.exitCode ?? '-'}`;
  return [...(body === '' ? [] : body.split(/\r?\n/).map((l) => `  ${l}`)), ...(status === null ? [] : [status])];
}

/** /queue: 일하는 중에 쌓아 둔 입력 */
export function queueLines(queued: readonly string[]): string[] {
  if (queued.length === 0) return ['  기다리는 입력이 없어요.'];
  return ['', `  기다리는 입력 ${queued.length}개 (/queue clear로 비워요)`, ...queued.map((t, i) => `    ${i + 1}. ${t}`)];
}
