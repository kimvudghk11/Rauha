import type { RunView } from './gh-actions.js';

/**
 * 작업 전후의 원격 추적 브랜치(@{u})와 HEAD 로 이 작업이 push 했는지 본다. push 했으면 그 커밋, 아니면 null.
 * 원격 추적 브랜치가 바뀌었고 지금 HEAD 와 같을 때만(새 브랜치를 -u 로 올린 경우 포함).
 */
export function pushedSha(p: { readonly upstreamBefore: string | null; readonly upstreamAfter: string | null; readonly head: string | null }): string | null {
  if (p.upstreamAfter === null || p.head === null || p.upstreamAfter === p.upstreamBefore) return null;
  return p.upstreamAfter === p.head ? p.head : null;
}

export type CiVerdict = 'none' | 'waiting' | 'passed' | 'failed';

/** 그 커밋에서 돈 실행들의 판정. 모두 끝나야 passed/failed, 하나라도 도는 중이면 waiting, 실행이 없으면 none */
export function ciVerdict(runs: readonly RunView[], sha: string): CiVerdict {
  const mine = runs.filter((r) => r.sha === sha);
  if (mine.length === 0) return 'none';
  if (mine.some((r) => r.verdict === 'queued' || r.verdict === 'running')) return 'waiting';
  return mine.some((r) => r.verdict === 'failure') ? 'failed' : 'passed';
}

export interface CiFailure {
  readonly branch: string;
  /** 그 커밋의 실행들(실패한 것만 할 일에 적는다) */
  readonly runs: readonly RunView[];
  /** 실패한 작업과 로그 끝부분. 로그인이 없어 못 읽었으면 비어 있다 */
  readonly jobs: readonly { readonly run: string; readonly job: string; readonly tail: readonly string[] }[];
}

/** 실패한 CI → 팀에 넘길 수 있는 할 일(제목·메모). 메모가 길면 로그 앞쪽부터 줄인다(끝부분이 원인에 가깝다). */
export function ciFixTodo(f: CiFailure, noteLimit: number): { title: string; note: string } {
  const failed = f.runs.filter((r) => r.verdict === 'failure');
  const first = failed[0] ?? f.runs[0];
  const title = `CI 실패 고치기: ${first === undefined ? 'GitHub Actions' : `${first.workflow} #${first.number}`} (${f.branch})`;
  const head = [`GitHub Actions 에서 ${f.branch} 브랜치의 실행이 실패했어요.`, ...failed.map((r) => `- ${r.workflow} #${r.number}: ${r.url}`)];
  const tail = '원인을 찾아 고쳐 주세요. 고친 뒤 테스트로 확인해 주세요.';
  if (f.jobs.length === 0) return { title, note: [...head, '로그는 읽지 못했어요(GitHub CLI 로그인이 필요해요). 위 주소에서 실패한 작업을 확인해 주세요.', tail].join('\n').slice(0, noteLimit) };
  const build = (keep: number): string => {
    const logs = f.jobs.map((j) => [`실패한 작업: ${j.job} (${j.run})`, '로그 끝부분:', ...j.tail.slice(-keep)].join('\n'));
    return [...head, ...logs, tail].join('\n');
  };
  let keep = Math.max(...f.jobs.map((j) => j.tail.length));
  let note = build(keep);
  while (note.length > noteLimit && keep > 1) {
    keep = Math.max(1, Math.floor(keep * 0.8));
    note = build(keep);
  }
  return { title, note: note.slice(0, noteLimit) };
}
