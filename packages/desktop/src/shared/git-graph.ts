/** 그래프에 그릴 커밋 한 개: 해시, 부모들(첫 번째가 같은 줄기), 붙은 ref 이름들(`git log %D`) */
export interface GraphCommit {
  readonly hash: string;
  readonly parents: readonly string[];
  readonly refs?: readonly string[];
}

/** 한 칸(레인)에서 다른 칸으로 가는 선. 위쪽 선은 줄 맨 위→점 높이, 아래쪽 선은 점 높이→줄 맨 아래 */
export interface GraphEdge {
  readonly from: number;
  readonly to: number;
  /** 0 ~ GRAPH_COLORS-1 */
  readonly color: number;
}

export interface GraphRow {
  readonly hash: string;
  /** 점이 놓이는 칸 */
  readonly col: number;
  readonly color: number;
  /** 부모가 둘 이상인 병합 커밋 */
  readonly merge: boolean;
  readonly top: readonly GraphEdge[];
  readonly bottom: readonly GraphEdge[];
  /** 이 줄에서 쓰는 칸 수(점과 모든 선 포함) */
  readonly cols: number;
}

/** 한 번에 그리는 커밋 상한. 거대 레포에서 화면이 멈추지 않게 한다. */
export const GRAPH_LIMIT = 500;
/** 팔레트 색 수. 화면은 이 번호를 CSS 토큰 색 클래스로 옮긴다. */
export const GRAPH_COLORS = 8;

function fnv(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 이름(브랜치 이름이나 해시)으로 정해지는 색 번호. 같은 이름은 언제나 같은 색이다. */
export function laneColor(key: string): number {
  return fnv(key) % GRAPH_COLORS;
}

/** 줄기의 이름: 태그가 아닌 첫 ref에서 `HEAD -> `와 원격 이름(origin/)을 뗀 것. 없으면 해시. */
function laneKey(commit: GraphCommit): string {
  for (const raw of commit.refs ?? []) {
    if (raw.startsWith('tag: ')) continue;
    const name = raw.replace(/^HEAD -> /, '').replace(/^(origin|upstream)\//, '');
    if (name !== '' && name !== 'HEAD') return name;
  }
  return commit.hash;
}

interface Lane {
  readonly hash: string;
  readonly color: number;
}

/** 지금 칸들이 쓰는 색을 피해 새 줄기의 색을 고른다(전부 쓰고 있으면 이름이 정한 색 그대로) */
function freshColor(key: string, lanes: readonly (Lane | null)[]): number {
  const used = new Set<number>();
  for (const l of lanes) if (l !== null) used.add(l.color);
  const start = laneColor(key);
  for (let k = 0; k < GRAPH_COLORS; k++) {
    const c = (start + k) % GRAPH_COLORS;
    if (!used.has(c)) return c;
  }
  return start;
}

/**
 * 커밋 목록(자식이 먼저, 부모가 나중: `git log --topo-order`)을 줄마다 칸과 선으로 바꾼다.
 * 칸마다 "다음에 올 커밋의 해시"를 기억하고, 그 커밋이 나오면 점을 찍고 부모로 선을 잇는다.
 * 첫 부모는 같은 칸을 이어 가고, 나머지 부모(병합으로 들어온 가지)는 새 칸을 열거나 이미 기다리는 칸으로 휜다.
 */
export function layoutGraph(commits: readonly GraphCommit[], limit: number = GRAPH_LIMIT): GraphRow[] {
  const lanes: (Lane | null)[] = [];
  const rows: GraphRow[] = [];
  const freeSlot = (): number => {
    const i = lanes.indexOf(null);
    return i === -1 ? lanes.length : i;
  };
  const waiting = (hash: string): number => lanes.findIndex((l) => l !== null && l.hash === hash);

  for (const commit of commits.slice(0, Math.max(0, limit))) {
    const top: GraphEdge[] = [];
    const bottom: GraphEdge[] = [];
    const arriving = lanes.flatMap((l, i) => (l !== null && l.hash === commit.hash ? [i] : []));
    let col: number;
    let color: number;
    if (arriving.length > 0) {
      col = arriving[0]!;
      color = lanes[col]!.color;
    } else {
      col = freeSlot();
      color = freshColor(laneKey(commit), lanes);
    }
    lanes.forEach((l, i) => {
      if (l === null) return;
      top.push({ from: i, to: l.hash === commit.hash ? col : i, color: l.color });
    });
    for (const i of arriving) lanes[i] = null;

    const touched = new Set<number>();
    const [first, ...others] = commit.parents;
    if (first !== undefined) {
      const at = waiting(first);
      if (at === -1) {
        lanes[col] = { hash: first, color };
        bottom.push({ from: col, to: col, color });
        touched.add(col);
      } else {
        bottom.push({ from: col, to: at, color });
      }
    }
    for (const p of others) {
      const at = waiting(p);
      if (at !== -1) {
        bottom.push({ from: col, to: at, color: lanes[at]!.color });
        continue;
      }
      const slot = freeSlot();
      const c = freshColor(p, lanes);
      lanes[slot] = { hash: p, color: c };
      bottom.push({ from: col, to: slot, color: c });
      touched.add(slot);
    }
    lanes.forEach((l, i) => {
      if (l !== null && !touched.has(i)) bottom.push({ from: i, to: i, color: l.color });
    });
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();

    let cols = col + 1;
    for (const e of [...top, ...bottom]) cols = Math.max(cols, e.from + 1, e.to + 1);
    rows.push({ hash: commit.hash, col, color, merge: commit.parents.length > 1, top, bottom, cols });
  }
  return rows;
}
