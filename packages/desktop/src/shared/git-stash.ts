const US = '\x1f';
const RS = '\x1e';

/** `git stash list --format=`에 넘기는 형식: 커밋 해시, 제목(%gs), 만든 시각. 필드는 \x1f, 줄은 \x1e로 끊는다. */
export const STASH_FORMAT = '%H%x1f%gs%x1f%ct%x1e';

export interface StashView {
  /** git 이 알려 준 순서의 번호(stash@{N} 의 N, 0이 가장 최근) */
  readonly index: number;
  /** stash 커밋 해시(번호가 밀렸는지 맞춰 보는 데 쓴다) */
  readonly hash: string;
  /** 내가 적은 메시지(없으면 git 이 붙인 "해시 커밋 제목") */
  readonly message: string;
  /** 어느 브랜치에서 만들었나(모르면 빈 글) */
  readonly branch: string;
  /** 초 단위 UNIX 시각 */
  readonly at: number;
}

const SUBJECT = /^(?:WIP on|On) ([^:]+): ([\s\S]*)$/;

/** `git stash list` 출력을 화면용 목록으로 바꾼다. 해시가 아닌 줄은 버린다. */
export function parseStashes(text: string): StashView[] {
  const rows = text
    .split(RS)
    .map((r) => r.replace(/^\n/, ''))
    .filter((r) => r.trim() !== '')
    .map((r) => r.split(US))
    .filter(([hash = '']) => /^[0-9a-f]{40}$/.test(hash));
  return rows.map(([hash = '', subject = '', at = '0'], index) => {
    const m = SUBJECT.exec(subject);
    return { index, hash, message: m === null ? subject : (m[2] ?? ''), branch: m === null ? '' : (m[1] ?? ''), at: Number(at) || 0 };
  });
}

export interface StashRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type StashApplyOutcome = { readonly kind: 'done' | 'conflict' | 'blocked'; readonly message: string };

const firstLines = (run: StashRun): string => (run.stderr.trim() || run.stdout.trim() || 'git stash failed').split('\n').slice(0, 6).join('\n');

/**
 * apply·pop 의 결과를 가른다. 충돌이면 stash 는 그대로 남고(pop 도), 변경이 덮어써질 때는 아무것도 바뀌지 않는다.
 */
export function classifyStashApply(mode: 'apply' | 'pop', run: StashRun, name: string): StashApplyOutcome {
  if (run.code === 0) return { kind: 'done', message: mode === 'pop' ? `Applied ${name} and removed it from the list.` : `Applied ${name}. The stash is kept.` };
  if (/CONFLICT/.test(run.stdout) || /CONFLICT/.test(run.stderr)) return { kind: 'conflict', message: `Conflicts found. Resolve them in the Conflicts tab. ${name} was kept so you can try again.` };
  return { kind: 'blocked', message: firstLines(run) };
}

/** drop 결과 한 줄. git 이 알려 준 해시로 바로 되살릴 길을 남긴다. */
export function stashDropMessage(name: string, output: string): string {
  const m = /\(([0-9a-f]{40})\)/.exec(output);
  return m === null ? `Dropped ${name}.` : `Dropped ${name}. To bring it back right away: git stash apply ${(m[1] ?? '').slice(0, 7)}`;
}
