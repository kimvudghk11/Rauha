import { ConnectionId, DbFilePath, DbInputError } from './db-names.js';
import { ConnectionLabel, SavedPassword, ServerTarget, type DbKind, type ServerKind, type SslMode } from './db-server.js';
import type { DbVia } from './db-failover.js';
import type { SqlDialect } from './db-sql.js';
import { ConnectionTag, type DbEnv } from './db-organize.js';

export const MAX_CONNECTIONS = 30;

/** 서버 연결을 고치거나 복제할 때 폼에 다시 채울 값(비밀번호 없음) */
export interface DbServerFields {
  readonly kind: ServerKind;
  /** 접속할 주소(적은 순서대로 시도한다) */
  readonly addresses: readonly { readonly host: string; readonly port: number; readonly label: string | null }[];
  readonly user: string;
  readonly database: string;
  readonly ssl: SslMode;
}

/** 저장한 연결 하나(화면에 보이는 모양). 비밀번호는 평문이든 암호문이든 들어 있지 않다. */
export interface DbConnectionView {
  readonly id: string;
  readonly kind: DbKind;
  /** 보이는 이름(파일 이름 또는 연결 이름) */
  readonly name: string;
  /** 어디에 있는지: 파일 경로 또는 비밀번호 없는 서버 주소(user@host:port/db) */
  readonly path: string;
  readonly lastUsed: number;
  /** 서버 연결이 비밀번호를 암호화해 저장해 두었는지. 파일이면 null */
  readonly savedPassword: boolean | null;
  /** 서버 연결의 폼 값(고치기·복제용). 파일이면 null */
  readonly server: DbServerFields | null;
  /** 이번 실행에서 마지막으로 붙은 주소(서버 연결만, 아직 열지 않았으면 null) */
  readonly via: DbVia | null;
  /** 사이드바 그룹(폴더) 이름. '' 이면 그룹 없음 */
  readonly group: string;
  /** 사용자가 정한 환경(local·dev·staging·prod). 정하지 않았으면 null(화면이 이름·주소로 추정) */
  readonly env: DbEnv | null;
}

/** 연결 id 로 찾은 "어디에 연결할지" */
export type DbLocation = { readonly kind: 'file'; readonly path: DbFilePath } | { readonly kind: 'server'; readonly target: ServerTarget; readonly password: SavedPassword };

/** 저장·복원용 항목(DTO 가 이미 검사한 값만 온다) */
export type StoredConnection =
  | { readonly kind: 'file'; readonly id: string; readonly path: DbFilePath; readonly lastUsed: number; readonly tag: ConnectionTag }
  | { readonly kind: 'server'; readonly id: string; readonly label: ConnectionLabel; readonly target: ServerTarget; readonly password: SavedPassword; readonly lastUsed: number; readonly tag: ConnectionTag };

/** 같은 파일인지 볼 때 쓰는 열쇠: 구분 기호와 대소문자 차이를 없앤다(윈도우·맥 기본 파일 시스템은 대소문자를 구분하지 않는다) */
const sameKey = (path: string): string => path.replace(/\\/g, '/').toLowerCase();

type Item =
  | { readonly kind: 'file'; readonly id: string; readonly path: DbFilePath; lastUsed: number; tag: ConnectionTag }
  | { readonly kind: 'server'; readonly id: string; label: ConnectionLabel; target: ServerTarget; password: SavedPassword; lastUsed: number; tag: ConnectionTag };

/** 저장한 연결 목록(엔티티): SQLite 파일과 MySQL·PostgreSQL 서버. 화면은 경로·주소가 아니라 id 로 고른다. */
export class DbConnections {
  private constructor(private readonly items: Item[]) {}

  static empty(): DbConnections {
    return new DbConnections([]);
  }

  /** 저장된 값에서 되살린다 */
  static restore(items: readonly StoredConnection[]): DbConnections {
    return new DbConnections(items.map((i) => ({ ...i })));
  }

  private assertRoom(): void {
    if (this.items.length >= MAX_CONNECTIONS) throw new DbInputError(`You can save up to ${MAX_CONNECTIONS} databases. Remove one first.`);
  }

  /** 파일을 목록에 더한다. 이미 있는 파일이면 새로 만들지 않고 최근으로 올려 돌려준다. */
  add(path: DbFilePath, id: string, now: number): DbConnectionView {
    const key = sameKey(path.value);
    const existing = this.items.find((i) => i.kind === 'file' && sameKey(i.path.value) === key);
    if (existing !== undefined) {
      existing.lastUsed = now;
      return view(existing);
    }
    this.assertRoom();
    ConnectionId.parse(id);
    const item: Item = { kind: 'file', id, path, lastUsed: now, tag: ConnectionTag.none() };
    this.items.push(item);
    return view(item);
  }

  /** 서버 연결을 더한다. 같은 서버·사용자·DB 가 이미 있으면 새로 만들지 않고 이름과 저장한 비밀번호를 새것으로 바꾼다. */
  addServer(target: ServerTarget, label: ConnectionLabel, password: SavedPassword, id: string, now: number): DbConnectionView {
    const existing = this.items.find((i) => i.kind === 'server' && i.target.sameServer(target));
    if (existing !== undefined && existing.kind === 'server') {
      existing.label = label;
      existing.password = password;
      existing.lastUsed = now;
      return view(existing);
    }
    this.assertRoom();
    ConnectionId.parse(id);
    const item: Item = { kind: 'server', id, label, target, password, lastUsed: now, tag: ConnectionTag.none() };
    this.items.push(item);
    return view(item);
  }

  /**
   * 저장한 서버 연결을 고친다(같은 id). password 가 null 이면 저장한 비밀번호를 그대로 둔다.
   * 고친 대상이 다른 저장 연결과 같은 서버면 거절한다(둘이 하나로 겹치지 않게). 파일 연결·모르는 id 도 거절한다.
   */
  editServer(id: string, target: ServerTarget, label: ConnectionLabel, password: SavedPassword | null, now: number): DbConnectionView {
    const item = this.items.find((i) => i.id === id);
    if (item?.kind !== 'server') throw new DbInputError('That server connection is not in your list. Add it again.');
    if (this.items.some((i) => i.id !== id && i.kind === 'server' && i.target.sameServer(target))) throw new DbInputError('Another saved connection already points at this server, user and database.');
    item.target = target;
    item.label = label;
    if (password !== null) item.password = password;
    item.lastUsed = now;
    return view(item);
  }

  /** 서버 연결의 저장한 비밀번호(암호문)를 바꾼다. 파일이면 아무 일도 없다. */
  rememberPassword(id: string, password: SavedPassword): void {
    const item = this.items.find((i) => i.id === id);
    if (item?.kind === 'server') item.password = password;
  }

  /** 저장한 비밀번호를 지운다(다음 접속 때 묻는다) */
  forgetPassword(id: string): void {
    this.rememberPassword(id, SavedPassword.none());
  }

  find(id: string): DbConnectionView | undefined {
    const item = this.items.find((i) => i.id === id);
    return item === undefined ? undefined : view(item);
  }

  locate(id: string): DbLocation | undefined {
    const item = this.items.find((i) => i.id === id);
    if (item === undefined) return undefined;
    return item.kind === 'file' ? { kind: 'file', path: item.path } : { kind: 'server', target: item.target, password: item.password };
  }

  /** 이 연결의 SQL 문법(모르는 id 면 SQLite: 어차피 그 뒤에 "목록에 없음"으로 거절된다) */
  dialectOf(id: string): SqlDialect {
    const item = this.items.find((i) => i.id === id);
    return item?.kind === 'server' ? item.target.kind : 'sqlite';
  }

  /** 그룹·환경을 바꾼다(파일·서버 모두). 모르는 id 면 거절한다 */
  retag(id: string, tag: ConnectionTag): DbConnectionView {
    const item = this.items.find((i) => i.id === id);
    if (item === undefined) throw new DbInputError('That connection is not in your list.');
    item.tag = tag;
    return view(item);
  }

  /** 지금 쓰는 그룹 이름들(이름순) */
  groups(): readonly string[] {
    return [...new Set(this.items.map((i) => i.tag.group).filter((g) => g !== ''))].sort((a, b) => a.localeCompare(b));
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
    return this.sorted().map(view);
  }

  /** 저장할 항목(최근 순) */
  snapshot(): readonly StoredConnection[] {
    return this.sorted().map((i) => ({ ...i }));
  }

  private sorted(): Item[] {
    return [...this.items].sort((a, b) => b.lastUsed - a.lastUsed);
  }
}

const view = (i: Item): DbConnectionView =>
  i.kind === 'file'
    ? { id: i.id, kind: 'sqlite', name: i.path.fileName(), path: i.path.value, lastUsed: i.lastUsed, savedPassword: null, server: null, via: null, ...i.tag.toJSON() }
    : { id: i.id, kind: i.target.kind, name: i.label.value, path: i.target.address(), lastUsed: i.lastUsed, savedPassword: i.password.isSaved(), server: i.target.toJSON(), via: null, ...i.tag.toJSON() };

type Obj = Readonly<Record<string, unknown>>;

/**
 * 목록 파일(JSON) ↔ 엔티티. 깨진 항목은 건너뛰고 개수를 센다.
 * version 1(SQLite 파일만, kind 없음)·version 2(서버 주소 하나: host·port)도 그대로 읽는다. 쓸 때는 version 3(서버 주소 목록: addresses).
 * 서버 비밀번호는 safeStorage 암호문(sealedPassword)만 저장하고, 저장하지 않기로 했으면 키 자체가 없다.
 */
export class ConnectionsDto {
  private constructor(
    private readonly items: readonly StoredConnection[],
    readonly skipped: number,
  ) {}

  static from(raw: unknown): ConnectionsDto {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return new ConnectionsDto([], 0);
    const list = (raw as Obj)['items'];
    if (!Array.isArray(list)) return new ConnectionsDto([], 0);
    const seen = new Set<string>();
    const servers: ServerTarget[] = [];
    const out: StoredConnection[] = [];
    let skipped = 0;
    for (const entry of list.slice(0, MAX_CONNECTIONS * 2) as unknown[]) {
      try {
        if (typeof entry !== 'object' || entry === null) throw new DbInputError('not an object');
        const o = entry as Obj;
        const id = ConnectionId.parse(o['id']).value;
        if (seen.has(id)) throw new DbInputError('duplicate');
        const used = o['lastUsed'];
        const lastUsed = typeof used === 'number' && Number.isFinite(used) ? used : 0;
        const kind = o['kind'];
        if (kind === undefined || kind === 'sqlite') {
          const path = DbFilePath.parse(o['path']);
          const key = `file:${sameKey(path.value)}`;
          if (seen.has(key)) throw new DbInputError('duplicate');
          seen.add(key);
          out.push({ kind: 'file', id, path, lastUsed, tag: ConnectionTag.restore(o) });
        } else {
          const target = ServerTarget.parse(o);
          if (servers.some((s) => s.sameServer(target))) throw new DbInputError('duplicate');
          const label = ConnectionLabel.parse(o['name'], target);
          const password = SavedPassword.restore(o['sealedPassword']);
          servers.push(target);
          out.push({ kind: 'server', id, label, target, password, lastUsed, tag: ConnectionTag.restore(o) });
        }
        seen.add(id);
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
    return new ConnectionsDto(c.snapshot(), 0);
  }

  toJSON(): unknown {
    return {
      version: 3,
      items: this.items.map((i) => {
        const tag = i.tag.toJSON();
        const extra = { ...(tag.group === '' ? {} : { group: tag.group }), ...(tag.env === null ? {} : { env: tag.env }) };
        if (i.kind === 'file') return { id: i.id, kind: 'sqlite', path: i.path.value, lastUsed: i.lastUsed, ...extra };
        const sealed = i.password.sealedText();
        return { id: i.id, ...i.target.toJSON(), name: i.label.value, ...(sealed === null ? {} : { sealedPassword: sealed }), lastUsed: i.lastUsed, ...extra };
      }),
    };
  }
}
