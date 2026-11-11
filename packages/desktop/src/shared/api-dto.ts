import { ApiCollections, type CollectionNode } from './api-collections.js';
import { ApiEnvironment, ApiEnvironments, ENV_LIMITS, type EnvVar, type EnvVarEdit, type EnvVarView } from './api-env.js';
import { ApiHistory, type HistoryEntry, type ResponseSummaryProps } from './api-response.js';
import { API_METHODS, ApiError, ApiRequest, type ApiAuth, type ApiBody, type ApiMethod, type ApiRequestProps, type KeyValue } from './api-request.js';

/** 바깥에서 들어온 값을 검사해 엔티티로 바꾸는 곳. 모양이 틀리면 ApiError(영어 문장)를 던진다. */

export const DTO_LIMITS = { url: 8192, text: 1_000_000, cell: 8192, rows: 100, id: 64, name: 200, nodes: 20_000, depth: 10, import: 5_000_000 } as const;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** 깊이·개수·위험한 키(__proto__ 등)를 한 번 훑어 막는다 */
export function assertPlain(value: unknown): void {
  let seen = 0;
  const walk = (v: unknown, depth: number): void => {
    if (++seen > DTO_LIMITS.nodes) throw new ApiError('That request is too large.');
    if (depth > DTO_LIMITS.depth) throw new ApiError('That request is nested too deeply.');
    if (Array.isArray(v)) {
      if (v.length > DTO_LIMITS.nodes) throw new ApiError('That request is too large.');
      for (const x of v) walk(x, depth + 1);
    } else if (typeof v === 'object' && v !== null) {
      for (const k of Object.getOwnPropertyNames(v)) {
        if (FORBIDDEN_KEYS.has(k)) throw new ApiError('That request has a forbidden field name.');
        walk((v as Record<string, unknown>)[k], depth + 1);
      }
    }
  };
  walk(value, 0);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function obj(v: unknown, field: string): Record<string, unknown> {
  if (!isObj(v)) throw new ApiError(`${field} must be an object.`);
  return v;
}

function text(v: unknown, field: string, max: number, fallback?: string): string {
  if (v === undefined && fallback !== undefined) return fallback;
  if (typeof v !== 'string') throw new ApiError(`${field} must be text.`);
  if (v.length > max) throw new ApiError(`${field} is too long.`);
  return v;
}

function flag(v: unknown, field: string, fallback: boolean): boolean {
  if (v === undefined) return fallback;
  if (typeof v !== 'boolean') throw new ApiError(`${field} must be true or false.`);
  return v;
}

const idOf = (v: unknown, field = 'id'): string => {
  const s = text(v, field, DTO_LIMITS.id);
  if (!/^[\w.-]+$/.test(s)) throw new ApiError(`${field} is not valid.`);
  return s;
};

function rows(v: unknown, field: string): KeyValue[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new ApiError(`${field} must be a list.`);
  if (v.length > DTO_LIMITS.rows) throw new ApiError(`${field} can have at most ${DTO_LIMITS.rows} rows.`);
  return v.map((r, i) => {
    const o = obj(r, `${field}[${i}]`);
    return { key: text(o['key'], `${field} name`, DTO_LIMITS.cell, ''), value: text(o['value'], `${field} value`, DTO_LIMITS.cell, ''), enabled: flag(o['enabled'], `${field} enabled`, true) };
  });
}

function bodyOf(v: unknown): ApiBody {
  if (v === undefined) return { kind: 'none' };
  const o = obj(v, 'body');
  switch (o['kind']) {
    case 'none':
      return { kind: 'none' };
    case 'json':
    case 'raw':
      return { kind: o['kind'], text: text(o['text'], 'body', DTO_LIMITS.text, '') };
    case 'form':
      return { kind: 'form', fields: rows(o['fields'], 'form') };
    default:
      throw new ApiError('Body type must be none, json, form or raw.');
  }
}

function authOf(v: unknown): ApiAuth {
  if (v === undefined) return { kind: 'none' };
  const o = obj(v, 'auth');
  const cell = (k: string): string => text(o[k], `auth ${k}`, DTO_LIMITS.cell, '');
  switch (o['kind']) {
    case 'none':
      return { kind: 'none' };
    case 'bearer':
      return { kind: 'bearer', token: cell('token') };
    case 'basic':
      return { kind: 'basic', username: cell('username'), password: cell('password') };
    case 'apikey': {
      const where = o['in'] === undefined ? 'header' : o['in'];
      if (where !== 'header' && where !== 'query') throw new ApiError('API key location must be header or query.');
      return { kind: 'apikey', name: cell('name'), value: cell('value'), in: where };
    }
    default:
      throw new ApiError('Auth type must be none, bearer, basic or apikey.');
  }
}

export type ApiRequestJson = ApiRequestProps;

export class ApiRequestDto {
  private constructor(readonly json: ApiRequestProps) {}

  static from(value: unknown): ApiRequestDto {
    assertPlain(value);
    const o = obj(value, 'request');
    const method = text(o['method'], 'method', 10, 'GET').toUpperCase();
    if (!API_METHODS.includes(method as ApiMethod)) throw new ApiError(`The method ${method.slice(0, 10)} is not supported.`);
    return new ApiRequestDto({
      id: idOf(o['id']),
      name: text(o['name'], 'name', DTO_LIMITS.name, 'New request'),
      method: method as ApiMethod,
      url: text(o['url'], 'url', DTO_LIMITS.url, ''),
      query: rows(o['query'], 'query'),
      headers: rows(o['headers'], 'headers'),
      body: bodyOf(o['body']),
      auth: authOf(o['auth']),
    });
  }

  static fromEntity(r: ApiRequest): ApiRequestDto {
    return new ApiRequestDto(r.props);
  }

  toEntity(): ApiRequest {
    return ApiRequest.create(this.json);
  }

  toJSON(): ApiRequestProps {
    return this.json;
  }
}

/** 화면에 보내는 요청: 값으로 적힌 비밀은 변수 이름으로 바꿔서 */
export const safeRequestJson = (r: ApiRequest): ApiRequestProps => r.withSecretsAsVariables().request.props;

// ── 저장 파일 ──

export interface CollectionsJson {
  readonly version: 1;
  readonly nodes: readonly ({ readonly kind: 'folder'; readonly id: string; readonly parentId: string | null; readonly name: string } | { readonly kind: 'request'; readonly id: string; readonly parentId: string | null; readonly request: ApiRequestProps })[];
}

export class CollectionsDto {
  private constructor(
    readonly json: CollectionsJson,
    /** 읽지 못해 건너뛴 항목 수 */
    readonly skipped: number,
  ) {}

  static from(value: unknown): CollectionsDto {
    if (!isObj(value) || !Array.isArray(value['nodes'])) return new CollectionsDto({ version: 1, nodes: [] }, 0);
    const nodes: CollectionsJson['nodes'][number][] = [];
    let skipped = 0;
    for (const n of value['nodes']) {
      try {
        assertPlain(n);
        const o = obj(n, 'item');
        const parentId = o['parentId'] === null || o['parentId'] === undefined ? null : idOf(o['parentId'], 'parentId');
        if (o['kind'] === 'folder') nodes.push({ kind: 'folder', id: idOf(o['id']), parentId, name: text(o['name'], 'name', DTO_LIMITS.name) });
        else if (o['kind'] === 'request') nodes.push({ kind: 'request', id: idOf(o['id']), parentId, request: ApiRequestDto.from(o['request']).json });
        else throw new ApiError('Unknown item.');
      } catch {
        skipped++;
      }
    }
    // 부모가 없는 항목은 건너뛴다
    const ids = new Set(nodes.map((n) => n.id));
    const kept = nodes.filter((n) => n.parentId === null || ids.has(n.parentId));
    return new CollectionsDto({ version: 1, nodes: kept }, skipped + (nodes.length - kept.length));
  }

  static fromEntity(c: ApiCollections): CollectionsDto {
    return new CollectionsDto(
      {
        version: 1,
        nodes: c.nodes.map((n) => (n.kind === 'folder' ? { kind: 'folder', id: n.id, parentId: n.parentId, name: n.name } : { kind: 'request', id: n.id, parentId: n.parentId, request: n.request.props })),
      },
      0,
    );
  }

  toEntity(): ApiCollections {
    const nodes: CollectionNode[] = this.json.nodes.map((n) => (n.kind === 'folder' ? n : { kind: 'request', id: n.id, parentId: n.parentId, request: ApiRequest.create(n.request) }));
    try {
      return ApiCollections.of(nodes);
    } catch {
      return ApiCollections.empty();
    }
  }

  toJSON(): CollectionsJson {
    return this.json;
  }
}

export interface EnvironmentsJson {
  readonly version: 1;
  readonly selectedId: string | null;
  readonly items: readonly { readonly id: string; readonly name: string; readonly vars: readonly EnvVar[] }[];
}

/** 화면에 보내는 환경 목록: 비밀 값은 들어 있지 않다 */
export interface EnvironmentsView {
  readonly selectedId: string | null;
  readonly items: readonly { readonly id: string; readonly name: string; readonly vars: readonly EnvVarView[] }[];
}

export class EnvironmentsDto {
  private constructor(readonly json: EnvironmentsJson) {}

  static from(value: unknown): EnvironmentsDto {
    const items: EnvironmentsJson['items'][number][] = [];
    if (isObj(value) && Array.isArray(value['items'])) {
      for (const e of value['items'].slice(0, ENV_LIMITS.environments)) {
        try {
          assertPlain(e);
          const o = obj(e, 'environment');
          const vars = Array.isArray(o['vars']) ? o['vars'] : [];
          const env = ApiEnvironment.create({
            id: idOf(o['id']),
            name: text(o['name'], 'name', DTO_LIMITS.name),
            vars: vars.map((x): EnvVar => {
              const v = obj(x, 'variable');
              return { name: text(v['name'], 'name', ENV_LIMITS.name), value: text(v['value'], 'value', ENV_LIMITS.value, ''), secret: flag(v['secret'], 'secret', false) };
            }),
          });
          items.push(env.props);
        } catch {
          /* 깨진 환경은 건너뛴다 */
        }
      }
    }
    const sel = isObj(value) && typeof value['selectedId'] === 'string' ? value['selectedId'] : null;
    return new EnvironmentsDto({ version: 1, selectedId: items.some((i) => i.id === sel) ? sel : null, items });
  }

  static fromEntity(e: ApiEnvironments): EnvironmentsDto {
    return new EnvironmentsDto({ version: 1, selectedId: e.selectedId, items: e.items.map((i) => i.props) });
  }

  toEntity(): ApiEnvironments {
    return ApiEnvironments.of(
      this.json.items.map((i) => ApiEnvironment.create(i)),
      this.json.selectedId,
    );
  }

  toJSON(): EnvironmentsJson {
    return this.json;
  }

  /** 화면에 보낼 모양(비밀 값 없음) */
  static view(e: ApiEnvironments): EnvironmentsView {
    return { selectedId: e.selectedId, items: e.items.map((i) => i.view()) };
  }
}

export interface HistoryJson {
  readonly version: 1;
  readonly entries: readonly HistoryEntry[];
}

export class HistoryDto {
  private constructor(readonly json: HistoryJson) {}

  static from(value: unknown): HistoryDto {
    const entries: HistoryEntry[] = [];
    if (isObj(value) && Array.isArray(value['entries'])) {
      for (const e of value['entries'].slice(0, 100)) {
        try {
          assertPlain(e);
          const o = obj(e, 'entry');
          const num = (k: string): number => (typeof o[k] === 'number' && Number.isFinite(o[k]) ? (o[k] as number) : 0);
          const r = o['response'];
          let response: ResponseSummaryProps | null = null;
          if (isObj(r)) {
            const hs = Array.isArray(r['headers']) ? r['headers'] : [];
            response = {
              status: typeof r['status'] === 'number' ? r['status'] : 0,
              statusText: text(r['statusText'], 'statusText', 200, ''),
              ms: typeof r['ms'] === 'number' ? r['ms'] : 0,
              size: typeof r['size'] === 'number' ? r['size'] : 0,
              headers: hs.slice(0, 200).flatMap((h): [string, string][] => (Array.isArray(h) && typeof h[0] === 'string' && typeof h[1] === 'string' ? [[h[0].slice(0, 200), h[1].slice(0, 4000)]] : [])),
              body: text(r['body'], 'body', DTO_LIMITS.text, ''),
              truncated: r['truncated'] === true,
              contentType: text(r['contentType'], 'contentType', 200, ''),
              redirects: Array.isArray(r['redirects']) ? r['redirects'].filter((x): x is string => typeof x === 'string').slice(0, 20) : [],
              binary: r['binary'] === true,
            };
          }
          entries.push({
            id: idOf(o['id']),
            at: text(o['at'], 'at', 40),
            request: ApiRequestDto.from(o['request']).json,
            status: typeof o['status'] === 'number' ? o['status'] : null,
            ms: num('ms'),
            size: num('size'),
            error: typeof o['error'] === 'string' ? o['error'].slice(0, 500) : null,
            response,
          });
        } catch {
          /* 깨진 줄은 건너뛴다 */
        }
      }
    }
    return new HistoryDto({ version: 1, entries });
  }

  static fromEntity(h: ApiHistory): HistoryDto {
    return new HistoryDto({ version: 1, entries: h.entries });
  }

  toEntity(): ApiHistory {
    return ApiHistory.of(this.json.entries);
  }

  toJSON(): HistoryJson {
    return this.json;
  }
}

// ── 화면이 보내는 요청 ──

export type CollectionOp =
  | { readonly kind: 'add-folder'; readonly name: string; readonly parentId: string | null }
  | { readonly kind: 'add-request'; readonly parentId: string | null; readonly request: ApiRequestProps | null }
  | { readonly kind: 'update-request'; readonly request: ApiRequestProps }
  | { readonly kind: 'rename'; readonly id: string; readonly name: string }
  | { readonly kind: 'duplicate'; readonly id: string }
  | { readonly kind: 'remove'; readonly id: string }
  | { readonly kind: 'move'; readonly id: string; readonly parentId: string | null };

const parentOf = (v: unknown): string | null => (v === null || v === undefined ? null : idOf(v, 'parentId'));

export const CollectionOpDto = {
  from(value: unknown): CollectionOp {
    assertPlain(value);
    const o = obj(value, 'operation');
    switch (o['kind']) {
      case 'add-folder':
        return { kind: 'add-folder', name: text(o['name'], 'name', DTO_LIMITS.name), parentId: parentOf(o['parentId']) };
      case 'add-request':
        return { kind: 'add-request', parentId: parentOf(o['parentId']), request: o['request'] === null || o['request'] === undefined ? null : ApiRequestDto.from(o['request']).json };
      case 'update-request':
        return { kind: 'update-request', request: ApiRequestDto.from(o['request']).json };
      case 'rename':
        return { kind: 'rename', id: idOf(o['id']), name: text(o['name'], 'name', DTO_LIMITS.name) };
      case 'duplicate':
      case 'remove':
        return { kind: o['kind'], id: idOf(o['id']) };
      case 'move':
        return { kind: 'move', id: idOf(o['id']), parentId: parentOf(o['parentId']) };
      default:
        throw new ApiError('Unknown collection operation.');
    }
  },
};

export type EnvOp =
  | { readonly kind: 'add'; readonly name: string }
  | { readonly kind: 'save'; readonly id: string; readonly name: string; readonly vars: readonly EnvVarEdit[] }
  | { readonly kind: 'remove'; readonly id: string }
  | { readonly kind: 'select'; readonly id: string | null };

export const EnvOpDto = {
  from(value: unknown): EnvOp {
    assertPlain(value);
    const o = obj(value, 'operation');
    switch (o['kind']) {
      case 'add':
        return { kind: 'add', name: text(o['name'], 'name', DTO_LIMITS.name) };
      case 'save': {
        if (!Array.isArray(o['vars'])) throw new ApiError('vars must be a list.');
        if (o['vars'].length > ENV_LIMITS.variables) throw new ApiError('Too many variables.');
        const vars = o['vars'].map((x): EnvVarEdit => {
          const v = obj(x, 'variable');
          const val = v['value'] === null ? null : text(v['value'], 'value', ENV_LIMITS.value, '');
          return { name: text(v['name'], 'name', ENV_LIMITS.name), value: val, secret: flag(v['secret'], 'secret', false) };
        });
        return { kind: 'save', id: idOf(o['id']), name: text(o['name'], 'name', DTO_LIMITS.name), vars };
      }
      case 'remove':
        return { kind: 'remove', id: idOf(o['id']) };
      case 'select':
        return { kind: 'select', id: o['id'] === null ? null : idOf(o['id']) };
      default:
        throw new ApiError('Unknown environment operation.');
    }
  },
};

export interface SendRequestJson {
  /** 같은 키의 전송이 끝나기 전에는 다시 보내지 않는다(Send 두 번 누름 방지). 보통 요청 id */
  readonly key: string;
  readonly request: ApiRequestProps;
}

export const SendRequestDto = {
  from(value: unknown): SendRequestJson {
    assertPlain(value);
    const o = obj(value, 'send');
    return { key: idOf(o['key'], 'key'), request: ApiRequestDto.from(o['request']).json };
  },
};

export type ImportFormat = 'curl' | 'http' | 'openapi';

export interface ImportRequestJson {
  readonly format: ImportFormat;
  readonly text: string;
  readonly parentId: string | null;
}

export const ImportRequestDto = {
  from(value: unknown): ImportRequestJson {
    assertPlain(value);
    const o = obj(value, 'import');
    if (o['format'] !== 'curl' && o['format'] !== 'http' && o['format'] !== 'openapi') throw new ApiError('Import format must be curl, http or openapi.');
    return { format: o['format'], text: text(o['text'], 'text', DTO_LIMITS.import), parentId: parentOf(o['parentId']) };
  },
};

export interface ExportRequestJson {
  readonly format: 'curl' | 'http';
  /** 요청 또는 폴더의 id */
  readonly id: string;
}

export const ExportRequestDto = {
  from(value: unknown): ExportRequestJson {
    assertPlain(value);
    const o = obj(value, 'export');
    if (o['format'] !== 'curl' && o['format'] !== 'http') throw new ApiError('Export format must be curl or http.');
    return { format: o['format'], id: idOf(o['id']) };
  },
};
