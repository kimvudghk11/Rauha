/** SQL 편집기에서 돌린 최근 쿼리(값 객체, 불변). 화면이 localStorage 에 저장한다. 비밀번호는 들어가지 않는다(쿼리 글만). */

export const HISTORY_MAX = 50;
/** 이보다 긴 쿼리는 남기지 않는다(기록이 저장소를 채우지 않게) */
const SQL_KEEP_MAX = 20_000;
const LINE_MAX = 120;

export interface HistoryItem {
  readonly sql: string;
  /** 돌린 연결 id */
  readonly id: string;
  /** 돌린 시각(ms) */
  readonly at: number;
}

export class QueryHistory {
  private constructor(private readonly list: readonly HistoryItem[]) {}

  static empty(): QueryHistory {
    return new QueryHistory([]);
  }

  /** 저장해 둔 값에서 되살린다. 깨진 항목은 버린다 */
  static restore(raw: unknown): QueryHistory {
    if (!Array.isArray(raw)) return QueryHistory.empty();
    const items: HistoryItem[] = [];
    for (const e of raw.slice(0, HISTORY_MAX) as unknown[]) {
      if (typeof e !== 'object' || e === null) continue;
      const o = e as Readonly<Record<string, unknown>>;
      const sql = o['sql'];
      const id = o['id'];
      const at = o['at'];
      if (typeof sql !== 'string' || sql.trim() === '' || sql.length > SQL_KEEP_MAX || typeof id !== 'string' || typeof at !== 'number' || !Number.isFinite(at)) continue;
      items.push({ sql, id, at });
    }
    return new QueryHistory(items);
  }

  /** 맨 위에 더한다. 같은 연결의 같은 쿼리(앞뒤 공백 무시)는 하나만 남긴다 */
  add(sql: string, id: string, at: number): QueryHistory {
    const text = sql.trim();
    if (text === '' || text.length > SQL_KEEP_MAX) return this;
    const rest = this.list.filter((i) => !(i.id === id && i.sql === text));
    return new QueryHistory([{ sql: text, id, at }, ...rest].slice(0, HISTORY_MAX));
  }

  items(): readonly HistoryItem[] {
    return this.list;
  }

  forConnection(id: string): readonly HistoryItem[] {
    return this.list.filter((i) => i.id === id);
  }

  toJSON(): readonly HistoryItem[] {
    return this.list;
  }

  /** 목록에 보일 한 줄 */
  static oneLine(sql: string): string {
    const flat = sql.replace(/\s+/g, ' ').trim();
    return flat.length <= LINE_MAX ? flat : `${flat.slice(0, LINE_MAX)}…`;
  }
}
