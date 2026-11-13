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
/** IPv6(대괄호는 있어도 없어도). 콜론이 둘 이상이어야 한다(3.39.2.12:3306 처럼 IPv4:포트 를 IPv6 로 읽지 않게) */
const HOST_V6 = /^\[?[0-9A-Fa-f.]*:[0-9A-Fa-f.]*:[0-9A-Fa-f:.]*\]?$/;
/** 숫자 네 칸(IPv4 모양) */
const IPV4_SHAPE = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/;
/** 호스트 칸에 붙여 넣은 "호스트:포트" · "[IPv6]:포트" */
const HOST_WITH_PORT = /^(?:\[([^\]]+)\]|([^:[\]]+)):(\d{1,5})$/;

/** "3.39.2.12:3306" 처럼 호스트 칸에 포트가 붙어 오면 둘로 나눈다. 아니면 port 는 null */
function splitHostPort(input: unknown): { host: unknown; port: string | null } {
  if (typeof input !== 'string') return { host: input, port: null };
  const m = HOST_WITH_PORT.exec(input.trim());
  return m === null ? { host: input, port: null } : { host: m[1] ?? m[2], port: m[3]! };
}
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
/** Amazon RDS(·Aurora) 엔드포인트: <이름>.<id>.<지역>.rds.amazonaws.com(중국 지역은 .com.cn). 이름만 비슷한 다른 도메인은 맞지 않는다 */
const AWS_RDS_HOST = /^(?:[a-z0-9-]+\.)+rds\.amazonaws\.com(?:\.cn)?$/i;

/** 접속할 때 Node 기본 CA 에 더해 믿을 CA 묶음(앱에 넣어 둔 것) */
export type ExtraCa = 'aws-rds';

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
  const v4 = IPV4_SHAPE.exec(v);
  if (v4 !== null && v4.slice(1).some((p) => Number(p) > 255)) throw new DbInputError(`"${v}" is not a valid IPv4 address (each part is 0-255).`);
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

/** 주소 하나에 붙일 수 있는 이름표 길이(예: Private, Public, VPN) */
const ADDRESS_LABEL_MAX = 24;
/** 한 연결에 적을 수 있는 주소 수 */
export const MAX_ADDRESSES = 6;
/** 주소가 하나일 때의 접속 시간 제한 */
export const CONNECT_TIMEOUT_MS = 10_000;
/** 주소가 여럿일 때 주소마다의 접속 시간 제한(닿지 않는 주소에서 오래 기다리지 않고 다음으로) */
export const FAILOVER_CONNECT_TIMEOUT_MS = 4_000;

function addressLabel(input: unknown): string | null {
  if (input === undefined || input === null) return null;
  if (typeof input !== 'string') throw new DbInputError('The address label must be text.');
  const v = input.trim();
  if (v === '') return null;
  if (v.length > ADDRESS_LABEL_MAX) throw new DbInputError(`The address label is too long (up to ${ADDRESS_LABEL_MAX} characters).`);
  if (CONTROL.test(v)) throw new DbInputError('The address label has a control character.');
  return v;
}

/** 서버 주소 하나(값 객체): 호스트 · 포트 · 이름표(선택) */
export class ServerAddress {
  private constructor(
    readonly host: string,
    readonly port: number,
    readonly label: string | null,
  ) {}

  static parse(input: unknown, kind: ServerKind): ServerAddress {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new DbInputError('The address is missing.');
    const o = input as Readonly<Record<string, unknown>>;
    const split = splitHostPort(o['host']);
    const typed = o['port'] === undefined || o['port'] === null || String(o['port']).trim() === '' ? null : port(o['port'], kind);
    if (split.port !== null && typed !== null && typed !== Number(split.port)) {
      throw new DbInputError(`The host ends with :${split.port} but the port box says ${typed}. Keep the port in one place.`);
    }
    return new ServerAddress(host(split.host), split.port !== null ? port(split.port, kind) : (typed ?? DEFAULT_PORT[kind]), addressLabel(o['label']));
  }

  /** host:port (IPv6 는 대괄호) */
  endpoint(): string {
    const h = this.host.includes(':') && !this.host.startsWith('[') ? `[${this.host}]` : this.host;
    return `${h}:${this.port}`;
  }

  /** 같은 호스트(대소문자 무시)·포트인지 */
  equals(other: ServerAddress): boolean {
    return this.host.toLowerCase() === other.host.toLowerCase() && this.port === other.port;
  }

  toJSON(): { host: string; port: number; label: string | null } {
    return { host: this.host, port: this.port, label: this.label };
  }
}

/** 접속할 주소 목록(값 객체): 적은 순서대로 시도한다(1번이 안 되면 2번…). 1~6개, 같은 주소는 두 번 없다. */
export class ServerAddresses {
  private constructor(private readonly items: readonly ServerAddress[]) {}

  static parse(input: unknown, kind: ServerKind): ServerAddresses {
    if (!Array.isArray(input) || input.length === 0) throw new DbInputError('Add at least one host.');
    if (input.length > MAX_ADDRESSES) throw new DbInputError(`You can add up to ${MAX_ADDRESSES} hosts.`);
    const items: ServerAddress[] = [];
    input.forEach((raw: unknown, i) => {
      let a: ServerAddress;
      try {
        a = ServerAddress.parse(raw, kind);
      } catch (e) {
        if (e instanceof DbInputError && input.length > 1) throw new DbInputError(`Host #${i + 1}: ${e.message}`);
        throw e;
      }
      const same = items.findIndex((x) => x.equals(a));
      if (same !== -1) throw new DbInputError(`Host #${i + 1} is the same as #${same + 1}.`);
      items.push(a);
    });
    return new ServerAddresses(items);
  }

  /** 주소 하나만 든 목록 */
  static only(address: ServerAddress): ServerAddresses {
    return new ServerAddresses([address]);
  }

  get size(): number {
    return this.items.length;
  }
  list(): readonly ServerAddress[] {
    return this.items;
  }
  primary(): ServerAddress {
    return this.items[0]!;
  }
  at(index: number): ServerAddress {
    const a = this.items[index];
    if (a === undefined) throw new DbInputError('That host is not in this connection.');
    return a;
  }
  /** 주소 하나라도 겹치는지 */
  overlaps(other: ServerAddresses): boolean {
    return this.items.some((a) => other.items.some((b) => a.equals(b)));
  }
  /** 주소마다의 접속 시간 제한: 하나면 넉넉히, 여럿이면 빨리 다음으로 */
  connectTimeoutMs(): number {
    return this.items.length > 1 ? FAILOVER_CONNECT_TIMEOUT_MS : CONNECT_TIMEOUT_MS;
  }
}

/** 서버 연결 대상(값 객체): 종류 · 주소 목록 · 사용자 · 데이터베이스 · SSL. 비밀번호는 여기에 없다. SSL 은 주소마다가 아니라 연결 하나에. */
export class ServerTarget {
  private constructor(
    readonly kind: ServerKind,
    readonly addresses: ServerAddresses,
    readonly user: string,
    readonly database: string,
    readonly ssl: SslMode,
  ) {}

  /** 화면·저장 파일에서 온 값을 검사한다(키: kind, addresses[{host, port, label}], user, database, ssl). 예전 형식(host, port 하나)도 읽는다 */
  static parse(input: unknown): ServerTarget {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new DbInputError('The connection details are missing.');
    const o = input as Readonly<Record<string, unknown>>;
    const kind = parseServerKind(o['kind']);
    const addresses = o['addresses'] !== undefined ? ServerAddresses.parse(o['addresses'], kind) : ServerAddresses.parse([{ host: o['host'], port: o['port'] }], kind);
    return new ServerTarget(kind, addresses, text(o['user'], 'user name'), text(o['database'], 'database name'), ssl(o['ssl']));
  }

  /** 첫(우선) 주소의 호스트 */
  get host(): string {
    return this.addresses.primary().host;
  }
  /** 첫(우선) 주소의 포트 */
  get port(): number {
    return this.addresses.primary().port;
  }

  /** 주소 하나로 좁힌 대상(드라이버는 이것으로 접속한다) */
  via(index: number): ServerTarget {
    return new ServerTarget(this.kind, ServerAddresses.only(this.addresses.at(index)), this.user, this.database, this.ssl);
  }

  /** 호스트가 Amazon RDS 엔드포인트인지 */
  static isAwsRdsHost(host: string): boolean {
    return AWS_RDS_HOST.test(host.trim());
  }

  /** 인증서를 확인할 때 함께 믿을 CA: (첫) 주소가 RDS 호스트 + verify 면 Amazon RDS CA. 주소별 판정은 via(i) 로 좁힌 대상에서 한다 */
  extraCa(): ExtraCa | null {
    return this.ssl === 'verify' && ServerTarget.isAwsRdsHost(this.host) ? 'aws-rds' : null;
  }

  /** 화면에 보일 주소(비밀번호 없음): user@host:port/database, 주소가 더 있으면 (+N more) */
  address(): string {
    const more = this.addresses.size > 1 ? ` (+${this.addresses.size - 1} more)` : '';
    return `${this.user}@${this.addresses.primary().endpoint()}/${this.database}${more}`;
  }

  /** 같은 서버·사용자·DB 인지: 종류·사용자·DB 가 같고 주소가 하나라도 겹친다(호스트는 대소문자 무시) */
  sameServer(other: ServerTarget): boolean {
    return this.kind === other.kind && this.user === other.user && this.database === other.database && this.addresses.overlaps(other.addresses);
  }

  toJSON(): { kind: ServerKind; addresses: { host: string; port: number; label: string | null }[]; user: string; database: string; ssl: SslMode } {
    return { kind: this.kind, addresses: this.addresses.list().map((a) => a.toJSON()), user: this.user, database: this.database, ssl: this.ssl };
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
