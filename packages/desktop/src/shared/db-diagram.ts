/**
 * 테이블 시각화(ERD): 스키마 재료(테이블·열·PK·FK)와 그림 배치 계산. 그리기(SVG)는 renderer/db-diagram.ts 가 한다.
 * 큰 스키마는 고른 테이블과 FK 로 이어진 이웃만 그린다(한눈에 볼 수 있는 만큼만).
 */

/** 한 번에 읽는 테이블 상한(카탈로그) */
export const GRAPH_MAX_TABLES = 400;
/** 테이블 하나에서 읽는 열 상한 */
const GRAPH_MAX_COLUMNS = 300;

/** 그림 크기 규칙(px) */
export const DIAGRAM = {
  boxWidth: 220,
  header: 28,
  row: 20,
  /** 상자에 그리는 열 수(넘으면 "+N more") */
  maxColumns: 14,
  gapX: 96,
  gapY: 36,
  pad: 24,
  /** 이 수까지는 전체를 그리고, 넘으면 고른 테이블과 이웃만 */
  fullMax: 40,
  /** 고리·같은 칸 선이 상자 밖으로 나가는 거리 */
  loop: 48,
} as const;

export interface DbGraphColumn {
  readonly name: string;
  readonly type: string;
  /** 기본 키에서 몇 번째 열인지(0 이면 아니다) */
  readonly pk: number;
}
export interface DbGraphTable {
  readonly name: string;
  readonly kind: 'table' | 'view';
  readonly columns: readonly DbGraphColumn[];
}
/** FK 하나: from 테이블의 열들 → to 테이블의 열들 */
export interface DbGraphLink {
  readonly from: string;
  readonly fromColumns: readonly string[];
  readonly to: string;
  readonly toColumns: readonly string[];
}
/** 화면으로 넘기는 스키마 그림 재료 */
export interface DbSchemaGraph {
  readonly tables: readonly DbGraphTable[];
  readonly links: readonly DbGraphLink[];
  /** 테이블이 상한보다 많아 일부만 읽었는지 */
  readonly truncated: boolean;
}

/** 카탈로그 질의의 행 모양(엔진마다 같은 모양으로 맞춘다) */
export interface GraphRows {
  /** [테이블, 'table'|'view'] */
  readonly tables: readonly (readonly [string, string])[];
  /** [테이블, 열, 형식] (열 순서대로) */
  readonly columns: readonly (readonly [string, string, string])[];
  /** [테이블, 열, PK 순번] */
  readonly keys: readonly (readonly [string, string, number])[];
  /** [FK 이름, 테이블, 열, 가리키는 테이블, 가리키는 열] (FK 안의 열 순서대로) */
  readonly links: readonly (readonly [string, string, string, string, string])[];
}

/** 스키마 그림 재료(값 객체): 카탈로그 행을 테이블별로 묶는다 */
export class SchemaGraph {
  private constructor(private readonly graph: DbSchemaGraph) {}

  static fromRows(rows: GraphRows): SchemaGraph {
    const truncated = rows.tables.length > GRAPH_MAX_TABLES;
    const order: string[] = [];
    const tables = new Map<string, { kind: 'table' | 'view'; columns: { name: string; type: string; pk: number }[] }>();
    for (const [name, kind] of rows.tables.slice(0, GRAPH_MAX_TABLES)) {
      if (tables.has(name)) continue;
      order.push(name);
      tables.set(name, { kind: /view/i.test(kind) ? 'view' : 'table', columns: [] });
    }
    for (const [table, name, type] of rows.columns) {
      const t = tables.get(table);
      if (t !== undefined && t.columns.length < GRAPH_MAX_COLUMNS && !t.columns.some((c) => c.name === name)) t.columns.push({ name, type, pk: 0 });
    }
    for (const [table, name, ord] of rows.keys) {
      const c = tables.get(table)?.columns.find((x) => x.name === name);
      if (c !== undefined) c.pk = Number.isFinite(ord) && ord > 0 ? ord : 1;
    }
    const links = new Map<string, { from: string; fromColumns: string[]; to: string; toColumns: string[] }>();
    for (const [fk, from, col, to, toCol] of rows.links) {
      if (!tables.has(from)) continue;
      const key = `${from}\u0000${fk}\u0000${to}`;
      const l = links.get(key) ?? { from, fromColumns: [], to, toColumns: [] };
      l.fromColumns.push(col);
      l.toColumns.push(toCol);
      links.set(key, l);
    }
    return new SchemaGraph({ tables: order.map((name) => ({ name, ...tables.get(name)! })), links: [...links.values()], truncated });
  }

  toJSON(): DbSchemaGraph {
    return this.graph;
  }
}

export interface DiagramColumn {
  readonly name: string;
  readonly type: string;
  readonly pk: boolean;
  readonly fk: boolean;
}
export interface DiagramBox {
  readonly name: string;
  readonly kind: 'table' | 'view';
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly columns: readonly DiagramColumn[];
  /** 그리지 않은 열 수 */
  readonly more: number;
  readonly focus: boolean;
}
export interface DiagramEdge {
  readonly from: string;
  readonly to: string;
  /** 마우스를 올렸을 때 보일 글: from(cols) → to(cols) */
  readonly label: string;
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  /** SVG path d */
  readonly path: string;
}

/** 상자 높이: 머리 + 열 줄(+ "+N more" 줄) + 아래 여백 */
const boxHeight = (shown: number, more: number): number => DIAGRAM.header + DIAGRAM.row * (shown + (more > 0 ? 1 : 0)) + 6;

/** ERD 배치(값 객체): 어느 테이블을 어디에 놓고 FK 선을 어떻게 긋는지 */
export class DiagramLayout {
  private constructor(
    readonly boxes: readonly DiagramBox[],
    readonly edges: readonly DiagramEdge[],
    readonly width: number,
    readonly height: number,
    /** 일부만 그렸는지(큰 스키마) */
    readonly partial: boolean,
    /** 가운데에 둔 테이블(일부만 그릴 때) */
    readonly focus: string | null,
  ) {}

  /** focus: 고른 테이블(없으면 null). 큰 스키마에서는 이 테이블과 이웃만 그린다 */
  static of(graph: DbSchemaGraph, focus: string | null): DiagramLayout {
    const byName = new Map(graph.tables.map((t) => [t.name, t]));
    const links = graph.links.filter((l) => byName.has(l.from) && byName.has(l.to));
    const degree = new Map<string, number>();
    for (const l of links) {
      degree.set(l.from, (degree.get(l.from) ?? 0) + 1);
      if (l.to !== l.from) degree.set(l.to, (degree.get(l.to) ?? 0) + 1);
    }
    const fkCols = new Map<string, Set<string>>();
    for (const l of links) for (const c of l.fromColumns) (fkCols.get(l.from) ?? fkCols.set(l.from, new Set()).get(l.from)!).add(c);

    const partial = graph.tables.length > DIAGRAM.fullMax;
    const centre = !partial ? null : focus !== null && byName.has(focus) ? focus : ([...graph.tables].sort((a, b) => (degree.get(b.name) ?? 0) - (degree.get(a.name) ?? 0))[0]?.name ?? null);

    const place: { name: string; x: number; y: number }[] = [];
    const heightOf = (name: string): number => {
      const t = byName.get(name)!;
      const shown = Math.min(t.columns.length, DIAGRAM.maxColumns);
      return boxHeight(shown, t.columns.length - shown);
    };
    const colX = (c: number): number => DIAGRAM.pad + c * (DIAGRAM.boxWidth + DIAGRAM.gapX);

    if (centre !== null) {
      // 왼쪽: 고른 테이블이 가리키는(부모) 테이블 · 가운데: 고른 테이블 · 오른쪽: 고른 테이블을 가리키는(자식) 테이블
      const parents = new Set(links.filter((l) => l.from === centre && l.to !== centre).map((l) => l.to));
      const children = new Set(links.filter((l) => l.to === centre && l.from !== centre && !parents.has(l.from)).map((l) => l.from));
      const room = DIAGRAM.fullMax - 1;
      const left = [...parents].slice(0, room);
      const right = [...children].slice(0, Math.max(0, room - left.length));
      const stack = (names: readonly string[], c: number): void => {
        let y = DIAGRAM.pad;
        for (const name of names) {
          place.push({ name, x: colX(c), y });
          y += heightOf(name) + DIAGRAM.gapY;
        }
      };
      stack(left, 0);
      stack([centre], 1);
      stack(right, 2);
    } else {
      // 이어진 테이블끼리 가깝게: 많이 이어진 것부터 너비 우선으로 줄을 세워 격자에 놓는다
      const order: string[] = [];
      const seen = new Set<string>();
      const starts = [...graph.tables].sort((a, b) => (degree.get(b.name) ?? 0) - (degree.get(a.name) ?? 0));
      for (const s of starts) {
        if (seen.has(s.name)) continue;
        const queue = [s.name];
        seen.add(s.name);
        while (queue.length > 0) {
          const n = queue.shift()!;
          order.push(n);
          for (const l of links) {
            const other = l.from === n ? l.to : l.to === n ? l.from : null;
            if (other !== null && !seen.has(other)) {
              seen.add(other);
              queue.push(other);
            }
          }
        }
      }
      const cols = Math.max(1, Math.ceil(Math.sqrt(order.length)));
      let y = DIAGRAM.pad;
      for (let r = 0; r * cols < order.length; r += 1) {
        const row = order.slice(r * cols, r * cols + cols);
        row.forEach((name, c) => place.push({ name, x: colX(c), y }));
        y += Math.max(...row.map(heightOf)) + DIAGRAM.gapY;
      }
    }

    const boxes: DiagramBox[] = place.map((p) => {
      const t = byName.get(p.name)!;
      const shown = t.columns.slice(0, DIAGRAM.maxColumns);
      const fks = fkCols.get(t.name) ?? new Set<string>();
      return { name: t.name, kind: t.kind, x: p.x, y: p.y, w: DIAGRAM.boxWidth, h: heightOf(t.name), columns: shown.map((c) => ({ name: c.name, type: c.type, pk: c.pk > 0, fk: fks.has(c.name) })), more: t.columns.length - shown.length, focus: t.name === centre };
    });
    const box = new Map(boxes.map((b) => [b.name, b]));
    const rowY = (b: DiagramBox, column: string | undefined): number => {
      // 열을 적지 않은 REFERENCES(SQLite)는 가리키는 테이블의 기본 키로 간다
      const i = column === undefined ? -1 : column === '' ? b.columns.findIndex((c) => c.pk) : b.columns.findIndex((c) => c.name === column);
      return i < 0 ? b.y + DIAGRAM.header / 2 : b.y + DIAGRAM.header + DIAGRAM.row * i + DIAGRAM.row / 2;
    };
    const edges: DiagramEdge[] = [];
    for (const l of links) {
      const a = box.get(l.from);
      const b = box.get(l.to);
      if (a === undefined || b === undefined) continue;
      const y1 = rowY(a, l.fromColumns[0]);
      const y2 = rowY(b, l.toColumns[0]);
      let x1: number;
      let x2: number;
      let path: string;
      if (a.x + a.w <= b.x || b.x + b.w <= a.x) {
        const rightward = a.x + a.w <= b.x;
        x1 = rightward ? a.x + a.w : a.x;
        x2 = rightward ? b.x : b.x + b.w;
        const dx = Math.max(24, Math.abs(x2 - x1) / 2) * (rightward ? 1 : -1);
        path = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
      } else {
        // 같은 칸(또는 자기 자신): 둘 다 오른쪽 변에서 밖으로 휘어 돌아온다
        x1 = a.x + a.w;
        x2 = b.x + b.w;
        const out = Math.max(x1, x2) + DIAGRAM.loop;
        path = `M ${x1} ${y1} C ${out} ${y1}, ${out} ${y2 === y1 ? y2 + DIAGRAM.row : y2}, ${x2} ${y2}`;
      }
      edges.push({ from: l.from, to: l.to, label: `${l.from}(${l.fromColumns.join(', ')}) → ${l.to}(${l.toColumns.join(', ')})`, x1, y1, x2, y2, path });
    }
    const width = Math.max(DIAGRAM.pad * 2, ...boxes.map((b) => b.x + b.w)) + DIAGRAM.pad + DIAGRAM.loop;
    const height = Math.max(DIAGRAM.pad * 2, ...boxes.map((b) => b.y + b.h)) + DIAGRAM.pad;
    return new DiagramLayout(boxes, edges, width, height, partial, centre);
  }
}
