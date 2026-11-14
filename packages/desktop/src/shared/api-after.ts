import { checkVarName } from './api-env.js';

/**
 * 응답 뒤 규칙(APIdog 후처리·Postman 테스트에 해당): 응답 값을 환경 변수로 저장(capture)하고, 응답을 검증(check)한다.
 * 스크립트를 돌리지 않고 정해진 모양의 규칙만 쓴다(안전하고 .http 로도 설명할 수 있게).
 */

export type CaptureSource = 'json' | 'header' | 'status' | 'body';
export const CAPTURE_SOURCES: readonly CaptureSource[] = ['json', 'header', 'status', 'body'];

export interface Capture {
  /** 저장할 환경 변수 이름 */
  readonly name: string;
  readonly from: CaptureSource;
  /** json: JSON 경로($.data.token), header: 헤더 이름, status·body: 쓰지 않음 */
  readonly path: string;
  readonly enabled: boolean;
}

export type CheckTarget = 'status' | 'json' | 'header' | 'time' | 'body';
export const CHECK_TARGETS: readonly CheckTarget[] = ['status', 'json', 'header', 'time', 'body'];
export type CheckOp = 'eq' | 'neq' | 'contains' | 'exists' | 'lt' | 'gt' | 'matches';
export const CHECK_OPS: readonly CheckOp[] = ['eq', 'neq', 'contains', 'exists', 'lt', 'gt', 'matches'];

export interface Check {
  readonly target: CheckTarget;
  /** json: JSON 경로, header: 헤더 이름 */
  readonly path: string;
  readonly op: CheckOp;
  /** 기대 값(exists 는 쓰지 않음) */
  readonly value: string;
  readonly enabled: boolean;
}

export interface ApiAfter {
  readonly captures: readonly Capture[];
  readonly checks: readonly Check[];
}

export const NO_AFTER: ApiAfter = { captures: [], checks: [] };

export interface CheckResult {
  readonly label: string;
  readonly pass: boolean;
  /** 실제 값(짧게) */
  readonly actual: string;
}

export interface CapturedValue {
  readonly name: string;
  readonly value: string;
  readonly found: boolean;
}

export interface AfterResult {
  readonly captured: readonly CapturedValue[];
  readonly checks: readonly CheckResult[];
}

/** 규칙이 읽는 응답 모양 */
export interface AfterInput {
  readonly status: number;
  readonly headers: readonly (readonly [string, string])[];
  readonly body: string;
  readonly ms: number;
}

const OP_TEXT: Readonly<Record<CheckOp, string>> = { eq: '=', neq: '≠', contains: 'contains', exists: 'exists', lt: '<', gt: '>', matches: 'matches' };
const TARGET_TEXT: Readonly<Record<CheckTarget, string>> = { status: 'Status', json: '', header: 'Header', time: 'Response time', body: 'Body' };
const VALUE_MAX = 8192;

/** `$.a.b[0]`, `a.b.0`, `$["key"]` 같은 경로를 조각으로 */
function pathParts(path: string): string[] | null {
  let p = path.trim();
  if (p === '' || p === '$') return [];
  if (p.startsWith('$')) p = p.slice(1);
  const parts: string[] = [];
  const re = /\.?([^.[\]]+)|\[\s*(?:(\d+)|"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')\s*\]/gy;
  let at = 0;
  while (at < p.length) {
    re.lastIndex = at;
    const m = re.exec(p);
    if (m === null) return null;
    parts.push((m[1] ?? m[2] ?? m[3] ?? m[4] ?? '').trim());
    at = re.lastIndex;
  }
  return parts;
}

/** JSON 값에서 경로를 따라간다 */
export function jsonAt(value: unknown, path: string): { readonly found: boolean; readonly value?: unknown } {
  const parts = pathParts(path);
  if (parts === null) return { found: false };
  let cur: unknown = value;
  for (const k of parts) {
    if (Array.isArray(cur) && /^\d+$/.test(k)) {
      const i = Number(k);
      if (i >= cur.length) return { found: false };
      cur = cur[i];
    } else if (typeof cur === 'object' && cur !== null && Object.prototype.hasOwnProperty.call(cur, k)) {
      cur = (cur as Record<string, unknown>)[k];
    } else return { found: false };
  }
  return { found: true, value: cur };
}

const asText = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v) ?? '');
const short = (s: string): string => (s.length > 120 ? `${s.slice(0, 117)}…` : s);

export class AfterRules {
  private constructor(readonly props: ApiAfter) {}

  static of(after: ApiAfter): AfterRules {
    for (const c of after.captures) if (c.enabled || c.name.trim() !== '') checkVarName(c.name);
    return new AfterRules({ captures: after.captures.map((c) => ({ ...c, name: c.name.trim(), path: c.path.trim() })), checks: after.checks.map((c) => ({ ...c, path: c.path.trim() })) });
  }

  isEmpty(): boolean {
    return !this.props.captures.some((c) => c.enabled) && !this.props.checks.some((c) => c.enabled);
  }

  run(res: AfterInput): AfterResult {
    let parsed: { ok: boolean; value?: unknown } | null = null;
    const json = (): { ok: boolean; value?: unknown } => {
      if (parsed === null) {
        try {
          parsed = { ok: true, value: JSON.parse(res.body) };
        } catch {
          parsed = { ok: false };
        }
      }
      return parsed;
    };
    const header = (name: string): string | undefined => res.headers.filter(([k]) => k.toLowerCase() === name.toLowerCase()).map(([, v]) => v).join(', ') || undefined;
    /** 대상에서 실제 값 읽기(없으면 undefined) */
    const read = (target: CheckTarget | CaptureSource, path: string): { found: boolean; raw?: unknown } => {
      if (target === 'status') return { found: true, raw: res.status };
      if (target === 'time') return { found: true, raw: res.ms };
      if (target === 'body') return { found: true, raw: res.body };
      if (target === 'header') {
        const h = header(path);
        return h === undefined ? { found: false } : { found: true, raw: h };
      }
      const j = json();
      if (!j.ok) return { found: false };
      const at = jsonAt(j.value, path);
      return at.found ? { found: true, raw: at.value } : { found: false };
    };

    const captured = this.props.captures
      .filter((c) => c.enabled && c.name !== '')
      .map((c): CapturedValue => {
        const r = read(c.from, c.path);
        return r.found ? { name: c.name, value: asText(r.raw).slice(0, VALUE_MAX), found: true } : { name: c.name, value: '', found: false };
      });

    const checks = this.props.checks
      .filter((c) => c.enabled)
      .map((c): CheckResult => {
        const what = c.target === 'json' ? c.path || '$' : c.target === 'header' ? `${TARGET_TEXT.header} ${c.path}` : TARGET_TEXT[c.target];
        const label = `${what} ${OP_TEXT[c.op]}${c.op === 'exists' ? '' : ` ${c.value}`}${c.target === 'time' ? ' ms' : ''}`;
        const r = read(c.target, c.path);
        if (!r.found) return { label, pass: c.op === 'neq', actual: '(not found)' };
        const actual = asText(r.raw);
        let pass: boolean;
        switch (c.op) {
          case 'exists':
            pass = true;
            break;
          case 'eq':
            pass = actual === c.value || (typeof r.raw === 'number' && Number(c.value) === r.raw);
            break;
          case 'neq':
            pass = !(actual === c.value || (typeof r.raw === 'number' && Number(c.value) === r.raw));
            break;
          case 'contains':
            pass = Array.isArray(r.raw) ? r.raw.some((x) => asText(x) === c.value) || actual.includes(c.value) : actual.includes(c.value);
            break;
          case 'lt':
          case 'gt': {
            const a = Number(actual);
            const b = Number(c.value);
            pass = !Number.isNaN(a) && !Number.isNaN(b) && (c.op === 'lt' ? a < b : a > b);
            break;
          }
          case 'matches':
            try {
              pass = new RegExp(c.value).test(actual);
            } catch {
              return { label, pass: false, actual: `Invalid pattern: ${short(c.value)}` };
            }
            break;
        }
        return { label, pass, actual: short(actual) };
      });
    return { captured, checks };
  }
}
