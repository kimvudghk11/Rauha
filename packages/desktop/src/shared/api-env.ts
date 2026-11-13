import { ApiError } from './api-request.js';

/** 환경 변수 하나. secret이면 화면에는 값을 보내지 않는다(이름과 "값이 있음"만). */
export interface EnvVar {
  readonly name: string;
  readonly value: string;
  readonly secret: boolean;
}

export const ENV_LIMITS = { environments: 50, variables: 200, value: 8192, name: 64 } as const;
const NAME_RE = /^[A-Za-z_][\w.-]*$/;
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);

/** 변수 이름 규칙: 글자·숫자·_·.·- , 글자나 _로 시작, 위험한 이름 금지 */
export function checkVarName(name: string): string {
  const n = name.trim();
  if (!NAME_RE.test(n) || n.length > ENV_LIMITS.name || FORBIDDEN.has(n)) throw new ApiError(`"${name.slice(0, 40)}" is not a valid variable name. Use letters, digits, _ . - and start with a letter or _.`);
  return n;
}

/** 화면에 보이는 변수. 비밀이면 value는 늘 빈 글자이고 has로 값이 있는지만 안다. */
export interface EnvVarView {
  readonly name: string;
  readonly value: string;
  readonly secret: boolean;
  readonly has: boolean;
}

/** 화면이 보내는 변수 고치기. 비밀 변수의 value가 null이면 지금 값을 그대로 둔다. */
export interface EnvVarEdit {
  readonly name: string;
  readonly value: string | null;
  readonly secret: boolean;
}

/** 환경 바의 색: 이 컴퓨터 · 운영 · 그 밖의 원격 · 환경 없음 */
export type EnvTone = 'local' | 'prod' | 'remote' | 'none';

/** API 탭 맨 위 환경 바의 규칙(base_url 을 바로 고치기, 환경 색) */
export const EnvBar = {
  /** 환경의 base_url 만 바꾼 저장용 변수 목록. 비밀 변수는 value null(지금 값 유지) */
  withBaseUrl(env: { readonly vars: readonly EnvVarView[] }, url: string): EnvVarEdit[] {
    const value = url.trim().replace(/\/+$/, '');
    const vars: EnvVarEdit[] = env.vars.map((v) => (v.name === 'base_url' ? { name: v.name, value, secret: false } : { name: v.name, value: v.secret ? null : v.value, secret: v.secret }));
    return env.vars.some((v) => v.name === 'base_url') ? vars : [{ name: 'base_url', value, secret: false }, ...vars];
  },
  tone(name: string | null, baseUrl: string | null): EnvTone {
    if (name === null && baseUrl === null) return 'none';
    const n = (name ?? '').toLowerCase();
    if (/prod|live|운영|real/.test(n)) return 'prod';
    if (baseUrl !== null && /^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|\[::1\])(:|\/|$)/i.test(baseUrl.trim())) return 'local';
    if (/^(local|dev|로컬)/.test(n)) return 'local';
    return 'remote';
  },
};

export interface ApiEnvironmentProps {
  readonly id: string;
  readonly name: string;
  readonly vars: readonly EnvVar[];
}

export class ApiEnvironment {
  private constructor(readonly props: ApiEnvironmentProps) {}

  static create(props: { readonly id: string; readonly name: string; readonly vars?: readonly EnvVar[] }): ApiEnvironment {
    const name = props.name.trim();
    if (name === '') throw new ApiError('Environment name cannot be empty.');
    return new ApiEnvironment({ id: props.id, name, vars: dedupe(props.vars ?? []) });
  }

  get id(): string {
    return this.props.id;
  }
  get name(): string {
    return this.props.name;
  }

  /** 이름 → 값 */
  variableMap(): Map<string, string> {
    return new Map(this.props.vars.map((v) => [v.name, v.value]));
  }

  /** 비밀 값을 뺀 화면용 모양 */
  view(): { readonly id: string; readonly name: string; readonly vars: readonly EnvVarView[] } {
    return {
      id: this.props.id,
      name: this.props.name,
      vars: this.props.vars.map((v) => ({ name: v.name, value: v.secret ? '' : v.value, secret: v.secret, has: v.value !== '' })),
    };
  }

  /** 화면의 고친 목록으로 바꾼다. 값이 null인 비밀 변수는 지금 값을 이어 받는다. */
  edit(name: string, edits: readonly EnvVarEdit[]): ApiEnvironment {
    const current = new Map(this.props.vars.map((v) => [v.name, v]));
    const vars = edits.map((e): EnvVar => {
      const n = checkVarName(e.name);
      const keep = e.value === null ? current.get(n) : undefined;
      if (e.value === null && keep === undefined) throw new ApiError(`Variable ${n} has no value to keep.`);
      if (e.value === null && keep !== undefined && keep.secret && !e.secret) throw new ApiError(`${n} is a secret. Type the value again to make it a normal variable.`);
      return { name: n, value: e.value ?? (keep as EnvVar).value, secret: e.secret };
    });
    return ApiEnvironment.create({ id: this.props.id, name, vars });
  }

  /** 변수를 더하거나(이미 있으면 값만) 바꾼다 */
  withVar(v: EnvVar): ApiEnvironment {
    const n = checkVarName(v.name);
    const rest = this.props.vars.filter((x) => x.name !== n);
    return ApiEnvironment.create({ id: this.props.id, name: this.props.name, vars: [...rest, { ...v, name: n }] });
  }
}

function dedupe(vars: readonly EnvVar[]): EnvVar[] {
  if (vars.length > ENV_LIMITS.variables) throw new ApiError(`An environment can hold at most ${ENV_LIMITS.variables} variables.`);
  const seen = new Set<string>();
  for (const v of vars) {
    checkVarName(v.name);
    if (v.value.length > ENV_LIMITS.value) throw new ApiError(`Value of ${v.name} is too long.`);
    if (seen.has(v.name)) throw new ApiError(`Variable ${v.name} appears twice.`);
    seen.add(v.name);
  }
  return [...vars];
}

export interface ApiEnvironmentsProps {
  readonly items: readonly ApiEnvironment[];
  readonly selectedId: string | null;
}

/** 환경 모음과 지금 고른 환경 */
export class ApiEnvironments {
  private constructor(
    readonly items: readonly ApiEnvironment[],
    readonly selectedId: string | null,
  ) {}

  static empty(): ApiEnvironments {
    return new ApiEnvironments([], null);
  }

  static of(items: readonly ApiEnvironment[], selectedId: string | null): ApiEnvironments {
    if (items.length > ENV_LIMITS.environments) throw new ApiError(`At most ${ENV_LIMITS.environments} environments.`);
    return new ApiEnvironments(items, items.some((e) => e.id === selectedId) ? selectedId : null);
  }

  find(id: string | null): ApiEnvironment | null {
    return this.items.find((e) => e.id === id) ?? null;
  }

  /** 지금 고른 환경(없으면 null)의 이름 → 값 */
  selectedVariables(): Map<string, string> {
    return this.find(this.selectedId)?.variableMap() ?? new Map();
  }

  add(env: ApiEnvironment): ApiEnvironments {
    if (this.items.some((e) => e.name.toLowerCase() === env.name.toLowerCase())) throw new ApiError(`Environment "${env.name}" already exists.`);
    return ApiEnvironments.of([...this.items, env], this.selectedId ?? env.id);
  }

  replace(env: ApiEnvironment): ApiEnvironments {
    if (this.find(env.id) === null) throw new ApiError('That environment no longer exists.');
    if (this.items.some((e) => e.id !== env.id && e.name.toLowerCase() === env.name.toLowerCase())) throw new ApiError(`Environment "${env.name}" already exists.`);
    return ApiEnvironments.of(
      this.items.map((e) => (e.id === env.id ? env : e)),
      this.selectedId,
    );
  }

  remove(id: string): ApiEnvironments {
    return ApiEnvironments.of(
      this.items.filter((e) => e.id !== id),
      this.selectedId === id ? null : this.selectedId,
    );
  }

  select(id: string | null): ApiEnvironments {
    if (id !== null && this.find(id) === null) throw new ApiError('That environment no longer exists.');
    return new ApiEnvironments(this.items, id);
  }

  /**
   * 요청에서 꺼낸 비밀 값(secret=false면 보통 변수)을 환경에 넣는다. 고른 환경이 없으면 "Default" 환경을 만든다.
   * 같은 이름이 이미 있으면 덮지 않고 그대로 둔다(사용자가 정한 값을 지키려고).
   */
  withSecrets(secrets: readonly { readonly name: string; readonly value: string }[], newId: () => string, secret = true): ApiEnvironments {
    if (secrets.length === 0) return this;
    let all: ApiEnvironments = this;
    if (all.find(all.selectedId) === null) {
      const first = all.items[0];
      all = first !== undefined ? all.select(first.id) : all.add(ApiEnvironment.create({ id: newId(), name: 'Default' }));
    }
    const env = all.find(all.selectedId) as ApiEnvironment;
    const known = env.variableMap();
    let next = env;
    for (const s of secrets) if (!known.has(s.name)) next = next.withVar({ name: s.name, value: s.value, secret });
    return all.replace(next);
  }
}
