import { DbInputError } from './db-names.js';

/** 연결할 수 있는 DB 서버 종류 */
export type ServerKind = 'mysql' | 'postgres';
/** 목록에 보이는 DB 종류(파일 + 서버) */
export type DbKind = 'sqlite' | ServerKind;
/** off: 암호화 안 함 · require: 암호화하되 인증서는 보지 않음(libpq sslmode=require) · verify: 인증서까지 확인 */
export type SslMode = 'off' | 'require' | 'verify';

export const SERVER_KINDS: readonly ServerKind[] = ['mysql', 'postgres'];
const DEFAULT_PORT: Readonly<Record<ServerKind, number>> = { mysql: 3306, postgres: 5432 };
const HOST_MAX = 253;
const NAME_MAX = 128;
const LABEL_MAX = 80;
const PASSWORD_MAX = 1024;
const SEALED_MAX = 8192;
/* eslint-disable-next-line no-control-regex */
const CONTROL = /[\u0000-\u001f\u007f]/;
/** 호스트 이름·IPv4 */
const HOST_NAME = /^[A-Za-z0-9_](?:[A-Za-z0-9._-]*[A-Za-z0-9_])?$/;
/** IPv6(대괄호는 있어도 없어도) */
const HOST_V6 = /^\[?[0-9A-Fa-f:.]*:[0-9A-Fa-f:.]*\]?$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export function defaultPort(kind: ServerKind): number {
  return DEFAULT_PORT[kind];
}

export function parseServerKind(input: unknown): ServerKind {
  if (input === 'mysql' || input === 'postgres') return input;
  throw new DbInputError('Pick MySQL or PostgreSQL.');
}

function host(input: unknown): string {
  if (typeof input !== 'string' || input.trim() === '') throw new DbInputError('The host is empty.');
  const v = input.trim();
  if (v.length > HOST_MAX) throw new DbInputError(`The host is too long (up to ${HOST_MAX} characters).`);
  if (/[/@\s]/.test(v) || v.includes('://')) throw new DbInputError('Type only the host name or IP (e.g. db.example.com), not a URL.');
  if (!HOST_NAME.test(v) && !HOST_V6.test(v)) throw new DbInputError('The host can use only letters, digits, ".", "-" and "_".');
  return v;
}

function port(input: unknown, kind: ServerKind): number {
  if (input === undefined || input === null || (typeof input === 'string' && input.trim() === '')) return DEFAULT_PORT[kind];
  const n = typeof input === 'string' && /^\d{1,5}$/.test(input.trim()) ? Number(input.trim()) : input;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 65535) throw new DbInputError('The port must be a number from 1 to 65535.');
  return n;
}

function text(input: unknown, what: string): string {
  if (typeof input !== 'string' || input.trim() === '') throw new DbInputError(`The ${what} is empty.`);
  const v = input.trim();
  if (v.length > NAME_MAX) throw new DbInputError(`The ${what} is too long (up to ${NAME_MAX} characters).`);
  if (CONTROL.test(v)) throw new DbInputError(`The ${what} has a control character.`);
  return v;
}

function ssl(input: unknown): SslMode {
  if (input === undefined || input === null || input === '' || input === 'off') return 'off';
  if (input === 'require' || input === 'verify') return input;
  throw new DbInputError('SSL must be off, require or verify.');
}

/** 서버 연결 대상(값 객체): 종류 · 호스트 · 포트 · 사용자 · 데이터베이스 · SSL. 비밀번호는 여기에 없다. */
export class ServerTarget {
  private constructor(
    readonly kind: ServerKind,
    readonly host: string,
    readonly port: number,
    readonly user: string,
    readonly database: string,
    readonly ssl: SslMode,
  ) {}

  /** 화면·저장 파일에서 온 값을 검사한다(키: kind, host, port, user, database, ssl) */
  static parse(input: unknown): ServerTarget {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new DbInputError('The connection details are missing.');
    const o = input as Readonly<Record<string, unknown>>;
    const kind = parseServerKind(o['kind']);
    return new ServerTarget(kind, host(o['host']), port(o['port'], kind), text(o['user'], 'user name'), text(o['database'], 'database name'), ssl(o['ssl']));
  }

  /** 화면에 보일 주소(비밀번호 없음): user@host:port/database */
  address(): string {
    const h = this.host.includes(':') && !this.host.startsWith('[') ? `[${this.host}]` : this.host;
    return `${this.user}@${h}:${this.port}/${this.database}`;
  }

  /** 같은 서버·사용자·DB 인지(호스트는 대소문자 무시) */
  sameServer(other: ServerTarget): boolean {
    return this.kind === other.kind && this.host.toLowerCase() === other.host.toLowerCase() && this.port === other.port && this.user === other.user && this.database === other.database;
  }

  toJSON(): { kind: ServerKind; host: string; port: number; user: string; database: string; ssl: SslMode } {
    return { kind: this.kind, host: this.host, port: this.port, user: this.user, database: this.database, ssl: this.ssl };
  }
}

/** 목록에 보일 연결 이름. 비우면 "DB on 호스트" */
export class ConnectionLabel {
  private constructor(readonly value: string) {}
  static parse(input: unknown, target: ServerTarget): ConnectionLabel {
    const v = typeof input === 'string' ? input.trim() : '';
    if (v === '') return new ConnectionLabel(`${target.database} on ${target.host}`);
    if (v.length > LABEL_MAX) throw new DbInputError(`The name is too long (up to ${LABEL_MAX} characters).`);
    if (CONTROL.test(v)) throw new DbInputError('The name has a control character.');
    return new ConnectionLabel(v);
  }
}

/** 평문 비밀번호(main 메모리에만). JSON·글로 바꿔도 드러나지 않는다. 꺼낼 때는 reveal() 로만. */
export class DbPassword {
  readonly #value: string;
  private constructor(value: string) {
    this.#value = value;
  }
  static parse(input: unknown): DbPassword {
    if (typeof input !== 'string') throw new DbInputError('The password is missing.');
    if (input.length > PASSWORD_MAX) throw new DbInputError(`The password is too long (up to ${PASSWORD_MAX} characters).`);
    return new DbPassword(input);
  }
  reveal(): string {
    return this.#value;
  }
  toJSON(): string {
    return '[hidden]';
  }
  toString(): string {
    return '[hidden]';
  }
}

/** 저장해 둔 비밀번호: 운영체제 암호화(safeStorage)로 만든 암호문(base64) 또는 없음(접속할 때 묻는다) */
export class SavedPassword {
  private constructor(private readonly sealed: string | null) {}

  static none(): SavedPassword {
    return new SavedPassword(null);
  }

  /** 저장 파일에서 되살린다. 없으면 none, base64 가 아니면 거절 */
  static restore(input: unknown): SavedPassword {
    if (input === undefined || input === null) return SavedPassword.none();
    if (typeof input !== 'string' || input.length > SEALED_MAX || !BASE64.test(input)) throw new DbInputError('The saved password is damaged.');
    return new SavedPassword(input);
  }

  /** 저장을 원하고 암호화할 수 있을 때만 암호문으로 남긴다. 암호화가 실패해도(키체인 거절 등) 평문으로 두지 않고 저장하지 않는다. */
  static keep(password: DbPassword, seal: ((plain: string) => string) | null, wanted: boolean): SavedPassword {
    if (!wanted || seal === null) return SavedPassword.none();
    try {
      return SavedPassword.restore(seal(password.reveal()));
    } catch {
      return SavedPassword.none();
    }
  }

  isSaved(): boolean {
    return this.sealed !== null;
  }
  sealedText(): string | null {
    return this.sealed;
  }
}
