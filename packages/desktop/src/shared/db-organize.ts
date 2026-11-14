import type { DbConnectionView } from './db-connections.js';
import { DbInputError } from './db-names.js';

/**
 * DB 연결 정리: 그룹(폴더)·환경(local·dev·staging·prod) 표시와, 사이드바에 보일 묶음·검색.
 * 연결이 많아져도 "어느 서버가 운영인지" 한눈에 보이게 한다.
 */
export const DB_ENVS = ['local', 'dev', 'staging', 'prod'] as const;
export type DbEnv = (typeof DB_ENVS)[number];

const GROUP_MAX = 40;
const UNGROUPED = 'Ungrouped';

/** 연결 하나의 그룹·환경(값 객체) */
export class ConnectionTag {
  private constructor(
    readonly group: string,
    readonly env: DbEnv | null,
  ) {}

  static none(): ConnectionTag {
    return new ConnectionTag('', null);
  }

  /** 화면에서 들어온 값: 틀리면 이유를 알린다 */
  static of(group: unknown, env: unknown): ConnectionTag {
    if (group !== undefined && group !== null && typeof group !== 'string') throw new DbInputError('The group must be text.');
    const g = (typeof group === 'string' ? group : '').trim().replace(/\s+/g, ' ');
    if (/[\r\n\u0000-\u001f]/.test(typeof group === 'string' ? group.trim() : '')) throw new DbInputError('The group name cannot have a line break.');
    if (g.length > GROUP_MAX) throw new DbInputError(`The group name can be at most ${GROUP_MAX} characters.`);
    if (env !== null && env !== undefined && env !== '' && !(DB_ENVS as readonly unknown[]).includes(env)) throw new DbInputError('The environment must be local, dev, staging or prod.');
    return new ConnectionTag(g, env === null || env === undefined || env === '' ? null : (env as DbEnv));
  }

  /** 저장 파일에서 읽기: 깨진 값은 조용히 "없음" */
  static restore(o: { readonly group?: unknown; readonly env?: unknown }): ConnectionTag {
    try {
      return ConnectionTag.of(typeof o.group === 'string' ? o.group : '', (DB_ENVS as readonly unknown[]).includes(o.env) ? o.env : null);
    } catch {
      return ConnectionTag.none();
    }
  }

  toJSON(): { readonly group: string; readonly env: DbEnv | null } {
    return { group: this.group, env: this.env };
  }
}

/** 환경을 정하지 않은 연결의 추정(이름·주소). 모르면 null */
export function guessEnv(c: Pick<DbConnectionView, 'kind' | 'name' | 'path'>): DbEnv | null {
  const text = `${c.name} ${c.path}`.toLowerCase();
  if (/(^|[^a-z])(prod|production|live|prd)([^a-z]|$)|운영|실서버/.test(text)) return 'prod';
  if (/(^|[^a-z])(staging|stage|stg|qa)([^a-z]|$)|스테이징/.test(text)) return 'staging';
  if (/(^|[^a-z])(dev|develop|development)([^a-z]|$)|개발/.test(text)) return 'dev';
  if (c.kind === 'sqlite' || /@(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?)(:|\/|$)|(^|\s)(localhost|127\.0\.0\.1)/.test(text) || /(^|[^a-z])local([^a-z]|$)|로컬/.test(text)) return 'local';
  return null;
}

/** 보일 환경: 정한 값, 없으면 추정 */
export function envOf(c: DbConnectionView): { readonly env: DbEnv | null; readonly guessed: boolean } {
  if (c.env !== null) return { env: c.env, guessed: false };
  const g = guessEnv(c);
  return { env: g, guessed: g !== null };
}

export interface ConnectionGroup {
  /** 그룹 이름('' 이면 그룹 머리를 그리지 않는다: 그룹을 하나도 쓰지 않을 때) */
  readonly name: string;
  readonly items: readonly DbConnectionView[];
}

/**
 * 사이드바 묶음: 그룹 이름순, 그룹 없는 연결은 맨 끝 "Ungrouped"(그룹을 아무도 안 쓰면 머리 없이 한 묶음).
 * 그룹 안은 이름순(열 때마다 순서가 바뀌지 않게). query 는 이름·주소·그룹·환경으로 거른다.
 */
export function groupConnections(list: readonly DbConnectionView[], query: string): ConnectionGroup[] {
  const q = query.trim().toLowerCase();
  const shown = q === '' ? list : list.filter((c) => [c.name, c.path, c.group, envOf(c).env ?? ''].some((t) => t.toLowerCase().includes(q)));
  if (shown.length === 0) return [];
  const byName = (a: DbConnectionView, b: DbConnectionView): number => a.name.localeCompare(b.name);
  const anyGroup = list.some((c) => c.group !== '');
  if (!anyGroup) return [{ name: '', items: [...shown].sort(byName) }];
  const groups = new Map<string, DbConnectionView[]>();
  for (const c of shown) groups.set(c.group, [...(groups.get(c.group) ?? []), c]);
  const named = [...groups.keys()].filter((g) => g !== '').sort((a, b) => a.localeCompare(b));
  const out: ConnectionGroup[] = named.map((g) => ({ name: g, items: (groups.get(g) as DbConnectionView[]).sort(byName) }));
  const loose = groups.get('');
  if (loose !== undefined) out.push({ name: UNGROUPED, items: loose.sort(byName) });
  return out;
}
