import { extractExpress, extractNest, extractNext, extractSpring, type ApiSource, type ExtractedApi, type SourceFile } from './api-extract.js';
import { parseOpenApi } from './api-openapi.js';
import { ApiError, type ApiRequestProps } from './api-request.js';

/**
 * 작업 폴더의 프로젝트 하나에서 API 컬렉션을 만드는 규칙:
 * 어떤 프로젝트인지(ProjectStack), 무엇을 만들지(ProjectApiSpec), 마지막에 무엇을 읽었는지(ApiProjects).
 */

// ── 프로젝트 판별 ──

export type StackKind = 'nest' | 'spring' | 'express' | 'next' | 'frontend' | 'unknown';

export interface StackFacts {
  /** 루트와 하위(모노레포) package.json 내용(JSON으로 읽은 값) */
  readonly packageJsons: readonly unknown[];
  /** pom.xml·build.gradle 내용(없으면 null) */
  readonly jvmBuild: string | null;
  /** 후보 파일 상대 경로들(/ 구분) */
  readonly paths: readonly string[];
}

const NEST_DEPS = ['@nestjs/core', '@nestjs/common'];
const SERVER_DEPS = ['express', 'fastify', 'koa', '@koa/router', 'koa-router', 'hono', '@hapi/hapi', 'restify', 'polka', '@adonisjs/core'];
const FRONT_DEPS = ['react', 'react-dom', 'vue', 'svelte', '@sveltejs/kit', '@angular/core', 'vite', 'next', 'nuxt', 'gatsby', 'solid-js', 'preact', 'astro', '@remix-run/react', 'react-native', 'expo', 'webpack', 'parcel'];
const NEXT_ROUTE_RE = /(^|\/)app\/(?:.*\/)?api\/(?:.*\/)?route\.[cm]?[jt]s$|(^|\/)pages\/api\//;
const OPENAPI_RE = /(^|\/)(openapi|swagger)([\w.-]*)\.json$/i;
const CODE_EXT: Record<StackKind, RegExp> = {
  nest: /\.[cm]?ts$/,
  express: /\.[cm]?[jt]s$/,
  next: /\.[cm]?[jt]s$/,
  spring: /\.(java|kt)$|(^|\/)application[\w-]*\.(properties|ya?ml)$/,
  frontend: /$^/,
  unknown: /$^/,
};

const depsOf = (pkg: unknown): string[] => {
  if (typeof pkg !== 'object' || pkg === null) return [];
  const o = pkg as Record<string, unknown>;
  return ['dependencies', 'devDependencies', 'peerDependencies'].flatMap((k) => (typeof o[k] === 'object' && o[k] !== null ? Object.keys(o[k] as object) : []));
};

/** 값 객체: 프로젝트 종류. 서버 프레임워크가 있으면 서버, 화면 라이브러리만 있으면 프론트엔드. */
export class ProjectStack {
  private constructor(readonly kind: StackKind) {}

  static judge(facts: StackFacts): ProjectStack {
    const deps = new Set(facts.packageJsons.flatMap(depsOf));
    const has = (list: readonly string[]): boolean => list.some((d) => deps.has(d));
    if (has(NEST_DEPS)) return new ProjectStack('nest');
    if (facts.jvmBuild !== null && /spring/i.test(facts.jvmBuild)) return new ProjectStack('spring');
    if (has(SERVER_DEPS)) return new ProjectStack('express');
    if (deps.has('next') && facts.paths.some((p) => NEXT_ROUTE_RE.test(p))) return new ProjectStack('next');
    if (has(FRONT_DEPS)) return new ProjectStack('frontend');
    return new ProjectStack('unknown');
  }

  /** 프론트엔드 레포는 API 목록을 만들지 않는다 */
  makesApi(): boolean {
    return this.kind !== 'frontend';
  }

  /** 먼저 쓸 OpenAPI(JSON) 파일들: 얕은 것부터 */
  openApiPaths(paths: readonly string[]): string[] {
    if (!this.makesApi()) return [];
    return paths.filter((p) => OPENAPI_RE.test(p)).sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  }

  /** 코드에서 읽을 때 열어 볼 파일들 */
  sourcePaths(paths: readonly string[]): string[] {
    const re = CODE_EXT[this.kind];
    return paths.filter((p) => re.test(p) && !OPENAPI_RE.test(p));
  }

  /** 종류에 맞는 추출기로 읽는다 */
  extract(files: readonly SourceFile[]): ExtractedApi | null {
    switch (this.kind) {
      case 'nest':
        return extractNest(files);
      case 'spring':
        return extractSpring(files);
      case 'express':
        return extractExpress(files);
      case 'next':
        return extractNext(files);
      default:
        return null;
    }
  }
}

// ── 만들 요청 ──

export interface GeneratedRequest {
  /** 다시 읽어도 같은 값: `메서드 경로` */
  readonly key: string;
  readonly request: Omit<ApiRequestProps, 'id'>;
}
export interface GeneratedGroup {
  readonly key: string;
  readonly name: string;
  readonly requests: readonly GeneratedRequest[];
}
export interface GeneratedProject {
  /** 프로젝트 구분(루트 경로) */
  readonly project: string;
  readonly name: string;
  readonly source: ApiSource;
  readonly groups: readonly GeneratedGroup[];
  readonly variables: readonly { readonly name: string; readonly value: string; readonly secret: boolean }[];
}

const DEFAULT_PORT = 3000;
const SECRET_NAME_RE = /^(token|api_?key|password|username)$/i;

/** `{{base_url}}/users/{{id}}` → `/users/:id` (키는 경로 변수 이름까지 포함) */
const keyPathOf = (url: string): string => url.replace(/^\{\{base_url\}\}/, '').replace(/\{\{([^}]+)\}\}/g, ':$1') || '/';

/** 엔티티: 프로젝트에서 읽어 낸 "있어야 할 요청 목록". 같은 키는 처음 것만 둔다. */
export class ProjectApiSpec implements GeneratedProject {
  private constructor(
    readonly project: string,
    readonly name: string,
    readonly source: ApiSource,
    readonly groups: readonly GeneratedGroup[],
    readonly variables: readonly { readonly name: string; readonly value: string; readonly secret: boolean }[],
  ) {}

  private static make(project: string, name: string, source: ApiSource, groups: readonly GeneratedGroup[], vars: { name: string; value: string; secret: boolean }[]): ProjectApiSpec {
    const seen = new Set<string>();
    const kept = groups
      .map((g) => ({ ...g, requests: g.requests.filter((r) => (seen.has(r.key) ? false : (seen.add(r.key), true))) }))
      .filter((g) => g.requests.length > 0);
    for (const g of kept)
      for (const r of g.requests)
        for (const v of r.request.url.matchAll(/\{\{([^}]+)\}\}/g)) if (!vars.some((x) => x.name === v[1])) vars.push({ name: v[1] as string, value: '', secret: SECRET_NAME_RE.test(v[1] as string) });
    return new ProjectApiSpec(project, name, source, kept, vars);
  }

  static fromExtracted(project: string, name: string, api: ExtractedApi): ProjectApiSpec {
    const vars = [{ name: 'base_url', value: `http://localhost:${api.port ?? DEFAULT_PORT}`, secret: false }];
    if (api.groups.some((g) => g.endpoints.some((e) => e.bearer))) vars.push({ name: 'token', value: '', secret: true });
    // 경로 변수는 환경 값으로 채운다: 처음 나온 예시 값을 쓴다(비밀 이름은 비워 둔다)
    for (const g of api.groups)
      for (const e of g.endpoints)
        for (const m of e.path.matchAll(/:(\w+)/g)) {
          const n = m[1] as string;
          const v = e.examples?.[n];
          if (v !== undefined && !SECRET_NAME_RE.test(n) && !vars.some((x) => x.name === n)) vars.push({ name: n, value: v, secret: false });
        }
    const groups = api.groups.map(
      (g): GeneratedGroup => ({
        key: g.key,
        name: g.name,
        requests: g.endpoints.map((e) => ({
          key: `${e.method} ${e.path}`,
          request: {
            name: e.name.slice(0, 120).trim() || `${e.method} ${e.path}`,
            method: e.method,
            url: `{{base_url}}${e.path.replace(/:(\w+)/g, '{{$1}}')}`,
            query: e.query.map((q) => ({ key: q, value: e.examples?.[q] ?? '', enabled: false })),
            headers: [],
            body: e.body === null || e.body === undefined ? { kind: 'none' } : { kind: 'json', text: JSON.stringify(e.body, null, 2) },
            auth: e.bearer ? { kind: 'bearer', token: '{{token}}' } : { kind: 'none' },
          },
        })),
      }),
    );
    return ProjectApiSpec.make(project, name, api.source, groups, vars);
  }

  /** OpenAPI 3.x JSON 문서(기존 가져오기 규칙을 그대로 쓴다) */
  static fromOpenApi(project: string, name: string, text: string): ProjectApiSpec {
    let n = 0;
    const imp = parseOpenApi(text, () => `gen${++n}`);
    const groups = imp.groups.map(
      (g): GeneratedGroup => ({
        key: g.name === '' ? 'General' : g.name,
        name: g.name === '' ? 'General' : g.name,
        requests: g.requests.map((r) => {
          const { id: _id, ...request } = r.props;
          return { key: `${r.props.method} ${keyPathOf(r.props.url)}`, request };
        }),
      }),
    );
    const vars = imp.variables.map((v) => ({ name: v.name, value: v.name === 'base_url' && v.value === '' ? `http://localhost:${DEFAULT_PORT}` : v.value, secret: SECRET_NAME_RE.test(v.name) }));
    return ProjectApiSpec.make(project, name, 'openapi', groups, vars);
  }

  requestCount(): number {
    return this.groups.reduce((n, g) => n + g.requests.length, 0);
  }

  isEmpty(): boolean {
    return this.requestCount() === 0;
  }
}

// ── 고른 프로젝트와 마지막 동기화 기록 ──

export interface ProjectRecord {
  readonly root: string;
  /** 마지막으로 읽었을 때의 지문(git HEAD + 관련 파일 수정 시각) */
  readonly fingerprint: string;
  /** 한 번이라도 만든 요청 키(사용자가 지운 것을 다시 만들지 않으려고) */
  readonly known: readonly string[];
  readonly syncedAt: string;
  readonly source: ApiSource | 'frontend' | 'none';
  readonly endpoints: number;
}

const MAX_RECORDS = 100;
const MAX_KNOWN = 5000;

/** 엔티티: API 탭이 고른 프로젝트와 프로젝트별 마지막 동기화 기록 */
export class ApiProjects {
  private constructor(
    readonly selected: string | null,
    readonly records: readonly ProjectRecord[],
  ) {}

  static empty(): ApiProjects {
    return new ApiProjects(null, []);
  }

  static of(selected: string | null, records: readonly ProjectRecord[]): ApiProjects {
    return new ApiProjects(selected, records.slice(-MAX_RECORDS));
  }

  record(root: string): ProjectRecord | null {
    return this.records.find((r) => r.root === root) ?? null;
  }

  select(root: string | null): ApiProjects {
    return new ApiProjects(root, this.records);
  }

  /** 다시 읽어야 하나: 처음이거나, 지문이 바뀌었거나, 컬렉션의 프로젝트 폴더가 없어졌으면 */
  needsSync(root: string, fingerprint: string, hasCollection: boolean): boolean {
    const r = this.record(root);
    if (r === null || r.fingerprint !== fingerprint) return true;
    return r.source !== 'frontend' && r.source !== 'none' && !hasCollection;
  }

  /** 다시 읽지 않았을 때 화면에 알릴 결과: 지난번이 프론트엔드였으면 frontend, API가 없었으면 empty */
  static outcomeOf(rec: ProjectRecord | null): 'frontend' | 'empty' | 'unchanged' {
    return rec?.source === 'frontend' ? 'frontend' : rec?.source === 'none' ? 'empty' : 'unchanged';
  }

  knownKeys(root: string): ReadonlySet<string> {
    return new Set(this.record(root)?.known ?? []);
  }

  recordSync(root: string, fingerprint: string, at: Date, source: ProjectRecord['source'], endpoints: number, known: readonly string[]): ApiProjects {
    const rec: ProjectRecord = { root, fingerprint, known: known.slice(-MAX_KNOWN), syncedAt: at.toISOString(), source, endpoints };
    return ApiProjects.of(this.selected, [...this.records.filter((r) => r.root !== root), rec]);
  }
}

// ── 저장 파일·화면 입력 ──

export interface ApiProjectsJson {
  readonly version: 1;
  readonly selected: string | null;
  readonly records: readonly ProjectRecord[];
}

const SOURCES = new Set(['openapi', 'nest', 'spring', 'express', 'next', 'frontend', 'none']);
const PATH_MAX = 1000;

export class ApiProjectsDto {
  private constructor(readonly json: ApiProjectsJson) {}

  /** 저장 파일을 읽는다. 깨진 줄은 건너뛴다 */
  static from(value: unknown): ApiProjectsDto {
    const o = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
    const records: ProjectRecord[] = [];
    for (const r of Array.isArray(o['records']) ? o['records'].slice(0, MAX_RECORDS) : []) {
      if (typeof r !== 'object' || r === null) continue;
      const x = r as Record<string, unknown>;
      if (typeof x['root'] !== 'string' || x['root'].length > PATH_MAX || typeof x['fingerprint'] !== 'string' || !SOURCES.has(String(x['source']))) continue;
      records.push({
        root: x['root'],
        fingerprint: x['fingerprint'].slice(0, 200),
        known: Array.isArray(x['known']) ? x['known'].filter((k): k is string => typeof k === 'string' && k.length <= PATH_MAX).slice(0, MAX_KNOWN) : [],
        syncedAt: typeof x['syncedAt'] === 'string' ? x['syncedAt'].slice(0, 40) : '',
        source: x['source'] as ProjectRecord['source'],
        endpoints: typeof x['endpoints'] === 'number' && Number.isFinite(x['endpoints']) ? x['endpoints'] : 0,
      });
    }
    const selected = typeof o['selected'] === 'string' && o['selected'].length <= PATH_MAX ? o['selected'] : null;
    return new ApiProjectsDto({ version: 1, selected, records });
  }

  static fromEntity(p: ApiProjects): ApiProjectsDto {
    return new ApiProjectsDto({ version: 1, selected: p.selected, records: p.records });
  }

  toEntity(): ApiProjects {
    return ApiProjects.of(this.json.selected, this.json.records);
  }

  toJSON(): ApiProjectsJson {
    return this.json;
  }
}

/** 훑은 결과(package.json 글 등)를 판별 재료로 바꾼다. 읽지 못하는 package.json은 빼고 본다 */
export const StackFactsDto = {
  from(survey: { readonly packageJsons: readonly string[]; readonly jvmBuild: string | null; readonly paths: readonly string[] }): StackFacts {
    const packageJsons = survey.packageJsons.flatMap((t): unknown[] => {
      try {
        return [JSON.parse(t)];
      } catch {
        return [];
      }
    });
    return { packageJsons, jvmBuild: survey.jvmBuild, paths: survey.paths };
  },
};

export interface ProjectSyncRequest {
  readonly root: string;
  /** 지문이 같아도 다시 읽는다(새로 고침 버튼) */
  readonly force: boolean;
}

export const ProjectSyncRequestDto = {
  from(value: unknown): ProjectSyncRequest {
    if (typeof value !== 'object' || value === null) throw new ApiError('Choose a project.');
    const o = value as Record<string, unknown>;
    if (typeof o['root'] !== 'string' || o['root'] === '' || o['root'].length > PATH_MAX) throw new ApiError('Choose a project.');
    return { root: o['root'], force: o['force'] === true };
  },
};
