/** 레포 한 곳의 상태(코드 탭 레포 노드에 보인다) */
export interface RepoStatus {
  /** 지금 브랜치(분리된 HEAD면 null) */
  readonly branch: string | null;
  /** 원격 브랜치보다 앞선·뒤처진 커밋 수. 원격이 없으면 null */
  readonly ahead: number | null;
  readonly behind: number | null;
  /** 바뀐(커밋 안 한) 파일 수 */
  readonly changed: number;
}

/** `git status -sb --porcelain` 출력을 읽는다. 첫 줄 `## main...origin/main [ahead 1, behind 2]`, 나머지는 바뀐 파일 줄. */
export function parseStatus(text: string): RepoStatus {
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  const head = lines.find((l) => l.startsWith('## ')) ?? '';
  const changed = lines.filter((l) => !l.startsWith('## ')).length;
  const rest = head.slice(3);
  if (rest.startsWith('HEAD (no branch)')) return { branch: null, ahead: null, behind: null, changed };
  const tracking = /^(.+?)\.\.\.(\S+)(?: \[(.*)\])?$/.exec(rest);
  if (tracking === null) {
    // 원격이 없는 브랜치: `## main` 또는 `## No commits yet on main`
    const noCommits = /^No commits yet on (.+)$/.exec(rest);
    return { branch: (noCommits?.[1] ?? rest) || null, ahead: null, behind: null, changed };
  }
  const info = tracking[3] ?? '';
  const num = (word: string) => Number(new RegExp(`${word} (\\d+)`).exec(info)?.[1] ?? 0);
  return { branch: tracking[1] ?? null, ahead: num('ahead'), behind: num('behind'), changed };
}
