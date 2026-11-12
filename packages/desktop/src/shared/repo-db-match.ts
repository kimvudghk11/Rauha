import type { DbConnectionView, DbConnections } from './db-connections.js';
import type { ServerKind } from './db-server.js';

/** 레포에서 DB 단서를 찾는 설정 파일(레포 맨 위). 비밀번호는 읽어도 버리고, 종류·호스트·포트·DB 이름만 남긴다. */
export const REPO_ENV_FILES: readonly string[] = ['.env', '.env.local', '.env.development', '.env.development.local', '.env.dev', '.env.test', '.env.example', '.env.sample'];
/** 설정 파일 하나에서 읽는 글자 상한 */
export const REPO_ENV_MAX_CHARS = 64 * 1024;

/** 레포 설정이 가리키는 DB 서버 하나. 비밀번호·사용자는 담지 않는다. */
export interface RepoDbHint {
  readonly kind: ServerKind | null;
  readonly host: string | null;
  readonly port: number | null;
  readonly database: string;
}

export interface RepoEnvFile {
  readonly name: string;
  readonly text: string;
}

type Slot = 'name' | 'host' | 'port' | 'kind';

/** 키 끝 낱말 → 무엇인지(+ 이름에 든 DB 종류). 긴 것부터 맞춰 본다. */
const SUFFIXES: readonly (readonly [string, Slot, ServerKind | null])[] = (
  [
    ['TYPEORM_DATABASE', 'name', null], ['MYSQL_DATABASE', 'name', 'mysql'], ['DATABASE_NAME', 'name', null], ['POSTGRES_DB', 'name', 'postgres'], ['DB_DATABASE', 'name', null], ['PGDATABASE', 'name', 'postgres'], ['DB_NAME', 'name', null], ['DATABASE', 'name', null],
    ['TYPEORM_HOST', 'host', null], ['DATABASE_HOST', 'host', null], ['POSTGRES_HOST', 'host', 'postgres'], ['MYSQL_HOST', 'host', 'mysql'], ['DB_HOST', 'host', null], ['PGHOST', 'host', 'postgres'],
    ['TYPEORM_PORT', 'port', null], ['DATABASE_PORT', 'port', null], ['POSTGRES_PORT', 'port', 'postgres'], ['MYSQL_PORT', 'port', 'mysql'], ['DB_PORT', 'port', null], ['PGPORT', 'port', 'postgres'],
    ['TYPEORM_CONNECTION', 'kind', null], ['DATABASE_TYPE', 'kind', null], ['DB_CONNECTION', 'kind', null], ['DB_DIALECT', 'kind', null], ['DB_CLIENT', 'kind', null], ['DB_TYPE', 'kind', null],
  ] as const
).slice().sort((a, b) => b[0].length - a[0].length);

/** 이름 → DB 종류. MySQL·PostgreSQL 이 아니면 'other'(그 단서는 버린다) */
function kindOf(value: string): ServerKind | 'other' {
  const v = value.toLowerCase();
  if (/^(mysql2?|mariadb)$/.test(v)) return 'mysql';
  if (/^(postgres|postgresql|pg)$/.test(v)) return 'postgres';
  return 'other';
}

const URL_SCHEME = /^(?:jdbc:)?(mysql2?|mariadb|postgres(?:ql)?|pg)(?:\+[a-z0-9]+)?:\/\//i;

/** 접속 주소에서 종류·호스트·포트·DB 이름만 꺼낸다(사용자·비밀번호는 보지 않는다). 읽지 못하면 null */
function fromUrl(value: string): RepoDbHint | null {
  const scheme = URL_SCHEME.exec(value);
  if (scheme === null) return null;
  try {
    const url = new URL(`rauha-db://${value.slice(scheme[0].length)}`);
    const database = decodeURIComponent(url.pathname.replace(/^\/+/, '').split('/')[0] ?? '');
    if (database === '') return null;
    const kind = kindOf(scheme[1]!);
    return { kind: kind === 'other' ? null : kind, host: url.hostname === '' ? null : url.hostname.replace(/^\[|\]$/g, ''), port: url.port === '' ? null : Number(url.port), database };
  } catch {
    return null;
  }
}

/** KEY=VALUE 한 줄 → [키, 값]. 주석·빈 줄은 null */
function envLine(line: string): readonly [string, string] | null {
  const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*(.*)$/.exec(line);
  if (m === null) return null;
  let value = m[2]!.trim();
  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.lastIndexOf(quote) > 0) value = value.slice(1, value.lastIndexOf(quote));
  else value = value.replace(/\s+#.*$/, '');
  return [m[1]!.toUpperCase(), value.trim()];
}

/** 레포 설정 파일들에서 찾은 DB 단서(값 객체) */
export class RepoDbHints {
  private constructor(private readonly hints: readonly RepoDbHint[]) {}

  static fromEnvFiles(files: readonly RepoEnvFile[]): RepoDbHints {
    const out: RepoDbHint[] = [];
    for (const file of files) {
      const groups = new Map<string, { kind: ServerKind | 'other' | null; host: string | null; port: number | null; name: string | null }>();
      for (const raw of file.text.slice(0, REPO_ENV_MAX_CHARS).split(/\r?\n/)) {
        const kv = envLine(raw);
        if (kv === null || kv[1] === '') continue;
        const [key, value] = kv;
        const url = fromUrl(value);
        if (url !== null) {
          out.push(url);
          continue;
        }
        const hit = SUFFIXES.find(([s]) => key === s || key.endsWith(`_${s}`));
        if (hit === undefined) continue;
        const [suffix, slot, implied] = hit;
        const prefix = key.slice(0, key.length - suffix.length);
        const g = groups.get(prefix) ?? { kind: null, host: null, port: null, name: null };
        if (implied !== null && g.kind === null) g.kind = implied;
        if (slot === 'name') g.name ??= value;
        if (slot === 'host') g.host ??= value;
        if (slot === 'port' && /^\d{1,5}$/.test(value)) g.port ??= Number(value);
        if (slot === 'kind') g.kind = kindOf(value);
        groups.set(prefix, g);
      }
      for (const g of groups.values()) {
        if (g.name === null || g.kind === 'other') continue;
        out.push({ kind: g.kind, host: g.host, port: g.port, database: g.name });
      }
    }
    return new RepoDbHints(out);
  }

  list(): readonly RepoDbHint[] {
    return this.hints;
  }
}

const LOCAL_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', 'host.docker.internal']);

function sameHost(a: string, b: string): boolean {
  const x = a.toLowerCase().replace(/^\[|\]$/g, '');
  const y = b.toLowerCase().replace(/^\[|\]$/g, '');
  return x === y || (LOCAL_HOSTS.has(x) && LOCAL_HOSTS.has(y));
}

const folderKey = (path: string): string => `${path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()}/`;

/**
 * 작업 레포에 맞는 DB 연결 고르기. 사용자가 DB 탭에 저장한 연결 중에서만 고른다.
 * 서버: 레포 설정(.env 등)의 DB 이름이 같고, 설정에 적힌 종류·호스트·포트가 있으면 그것도 맞아야 한다(localhost 끼리는 같다).
 * SQLite: 파일이 레포 폴더 안에 있으면 맞다. 여럿이면 최근에 쓴 연결.
 */
export class RepoDbMatch {
  private constructor() {}

  static pick(connections: DbConnections, hints: RepoDbHints, repoRoot: string): DbConnectionView | null {
    const root = folderKey(repoRoot);
    for (const view of connections.list()) {
      const at = connections.locate(view.id);
      if (at === undefined) continue;
      if (at.kind === 'file') {
        if (at.path.value.replace(/\\/g, '/').toLowerCase().startsWith(root)) return view;
        continue;
      }
      const t = at.target;
      const fits = hints.list().some((h) => h.database.toLowerCase() === t.database.toLowerCase() && (h.kind === null || h.kind === t.kind) && (h.host === null || sameHost(h.host, t.host)) && (h.port === null || h.port === t.port));
      if (fits) return view;
    }
    return null;
  }
}

/** 운영 DB 로 보이는지: 연결 이름이나 호스트에 prod(production) 또는 "운영" */
export function looksLikeProduction(...texts: readonly string[]): boolean {
  return texts.some((t) => /prod|운영/i.test(t));
}
