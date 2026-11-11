import { ConnectionId, DbFilePath, DbInputError } from './db-names.js';

export const MAX_CONNECTIONS = 30;

/** 저장한 DB 파일 하나(화면에 보이는 모양) */
export interface DbConnectionView {
  readonly id: string;
  /** 보이는 이름(파일 이름) */
  readonly name: string;
  readonly path: string;
  readonly lastUsed: number;
}

/** 같은 파일인지 볼 때 쓰는 열쇠: 구분 기호와 대소문자 차이를 없앤다(윈도우·맥 기본 파일 시스템은 대소문자를 구분하지 않는다) */
const sameKey = (path: string): string => path.replace(/\\/g, '/').toLowerCase();

interface Item {
  readonly id: string;
  readonly path: DbFilePath;
  lastUsed: number;
}

/** 저장한 DB 파일 목록(엔티티). 화면은 경로가 아니라 id 로 고른다. */
export class DbConnections {
  private constructor(private readonly items: Item[]) {}

  static empty(): DbConnections {
    return new DbConnections([]);
  }

  /** 저장된 값에서 되살린다(DTO 가 이미 검사한 항목만 온다) */
  static restore(items: readonly { readonly id: string; readonly path: DbFilePath; readonly lastUsed: number }[]): DbConnections {
    return new DbConnections(items.map((i) => ({ ...i })));
  }

  /** 파일을 목록에 더한다. 이미 있는 파일이면 새로 만들지 않고 최근으로 올려 돌려준다. */
  add(path: DbFilePath, id: string, now: number): DbConnectionView {
    const key = sameKey(path.value);
    const existing = this.items.find((i) => sameKey(i.path.value) === key);
    if (existing !== undefined) {
      existing.lastUsed = now;
      return view(existing);
    }
    if (this.items.length >= MAX_CONNECTIONS) throw new DbInputError(`You can save up to ${MAX_CONNECTIONS} database files. Remove one first.`);
    ConnectionId.parse(id);
    const item: Item = { id, path, lastUsed: now };
    this.items.push(item);
    return view(item);
  }

  find(id: string): DbConnectionView | undefined {
    const item = this.items.find((i) => i.id === id);
    return item === undefined ? undefined : view(item);
  }

  touch(id: string, now: number): void {
    const item = this.items.find((i) => i.id === id);
    if (item !== undefined) item.lastUsed = now;
  }

  remove(id: string): void {
    const at = this.items.findIndex((i) => i.id === id);
    if (at !== -1) this.items.splice(at, 1);
  }

  /** 최근에 쓴 것이 위로 */
  list(): readonly DbConnectionView[] {
    return [...this.items].sort((a, b) => b.lastUsed - a.lastUsed).map(view);
  }
}

const view = (i: Item): DbConnectionView => ({ id: i.id, name: i.path.fileName(), path: i.path.value, lastUsed: i.lastUsed });

type Obj = Readonly<Record<string, unknown>>;

/** 목록 파일(JSON) ↔ 엔티티. 깨진 항목은 건너뛰고 개수를 센다. */
export class ConnectionsDto {
  private constructor(
    private readonly items: readonly { readonly id: string; readonly path: DbFilePath; readonly lastUsed: number }[],
    readonly skipped: number,
  ) {}

  static from(raw: unknown): ConnectionsDto {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return new ConnectionsDto([], 0);
    const list = (raw as Obj)['items'];
    if (!Array.isArray(list)) return new ConnectionsDto([], 0);
    const seen = new Set<string>();
    const out: { id: string; path: DbFilePath; lastUsed: number }[] = [];
    let skipped = 0;
    for (const entry of list.slice(0, MAX_CONNECTIONS * 2) as unknown[]) {
      try {
        if (typeof entry !== 'object' || entry === null) throw new DbInputError('not an object');
        const o = entry as Obj;
        const id = ConnectionId.parse(o['id']).value;
        const path = DbFilePath.parse(o['path']);
        const key = sameKey(path.value);
        if (seen.has(id) || seen.has(key)) throw new DbInputError('duplicate');
        const used = o['lastUsed'];
        seen.add(id);
        seen.add(key);
        out.push({ id, path, lastUsed: typeof used === 'number' && Number.isFinite(used) ? used : 0 });
      } catch {
        skipped += 1;
      }
    }
    return new ConnectionsDto(out.slice(0, MAX_CONNECTIONS), skipped);
  }

  toEntity(): DbConnections {
    return DbConnections.restore(this.items);
  }

  static fromEntity(c: DbConnections): ConnectionsDto {
    return new ConnectionsDto(
      c.list().map((v) => ({ id: v.id, path: DbFilePath.parse(v.path), lastUsed: v.lastUsed })),
      0,
    );
  }

  toJSON(): unknown {
    return { version: 1, items: this.items.map((i) => ({ id: i.id, path: i.path.value, lastUsed: i.lastUsed })) };
  }
}
