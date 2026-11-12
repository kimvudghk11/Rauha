import type { ApiMethod } from './api-request.js';
import { ExampleValue, indexEnums, parseRules, type EnumIndex, type FieldRule } from './api-sample.js';

/**
 * 코드에서 API 엔드포인트를 읽는 정적 분석(모델 호출 없음). 정규식과 괄호 맞추기만 쓰므로
 * 완벽한 파서는 아니다: 흔한 모양(NestJS 데코레이터, Spring 매핑 애너테이션, Express 라우터, Next.js 라우트 파일)만 읽는다.
 */

export type ApiSource = 'openapi' | 'nest' | 'spring' | 'express' | 'next';

export interface SourceFile {
  /** 프로젝트 루트 기준 상대 경로(/ 구분) */
  readonly path: string;
  readonly text: string;
}

export interface ApiEndpoint {
  readonly method: ApiMethod;
  /** `/api/v1/users/:id` 처럼 경로 변수는 `:이름` */
  readonly path: string;
  readonly name: string;
  readonly query: readonly string[];
  /** JSON 본문 뼈대(없으면 null) */
  readonly body: unknown;
  readonly bearer: boolean;
  /** 경로 변수·쿼리 이름 → 예시 값(글자) */
  readonly examples?: Readonly<Record<string, string>>;
  /** 코드의 핸들러(메서드) 이름 */
  readonly handler?: string;
  /** 엔드포인트가 적힌 파일(프로젝트 상대 경로)과 줄(1부터) */
  readonly file?: string;
  readonly line?: number;
}

export interface EndpointGroup {
  /** 다시 읽어도 같은 값(컨트롤러 클래스 이름, 파일 경로 등) */
  readonly key: string;
  readonly name: string;
  readonly endpoints: readonly ApiEndpoint[];
}

export interface ExtractedApi {
  readonly source: ApiSource;
  readonly groups: readonly EndpointGroup[];
  readonly port: number | null;
}

const SAMPLE_DEPTH = 3;
const MAX_FIELDS = 40;

// ── 글자 다루기 ──

/** 주석을 지운다. 문자열('…' "…" `…`) 안은 건드리지 않는다. */
export function stripComments(text: string): string {
  const parts: string[] = [];
  let from = 0;
  const re = /["'`]|\/\/|\/\*/g;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    const at = m.index;
    if (m[0].length === 1) {
      re.lastIndex = stringEnd(text, at);
      continue;
    }
    parts.push(text.slice(from, at));
    if (m[0] === '//') {
      const nl = text.indexOf('\n', at);
      from = nl === -1 ? text.length : nl;
    } else {
      const end = text.indexOf('*/', at + 2);
      from = end === -1 ? text.length : end + 2;
    }
    re.lastIndex = from;
  }
  parts.push(text.slice(from));
  return parts.join('');
}

/** 따옴표로 시작하는 문자열의 끝(닫는 따옴표 다음 자리) */
function stringEnd(text: string, start: number): number {
  const q = text[start];
  let i = start + 1;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') i += 2;
    else if (c === q) return i + 1;
    else if (c === '\n' && q !== '`') return i;
    else i++;
  }
  return text.length;
}

/** 여는 괄호 자리에서 짝이 맞는 닫는 괄호 자리. 못 찾으면 글 끝 */
function closeOf(text: string, open: number): number {
  const pairs: Record<string, string> = { '(': ')', '{': '}', '[': ']' };
  const stack: string[] = [];
  let i = open;
  while (i < text.length) {
    const c = text[i] as string;
    if (c === '"' || c === "'" || c === '`') {
      i = stringEnd(text, i);
      continue;
    }
    if (pairs[c] !== undefined) stack.push(pairs[c] as string);
    else if (c === ')' || c === '}' || c === ']') {
      stack.pop();
      if (stack.length === 0) return i;
    }
    i++;
  }
  return text.length;
}

/** 최상위 쉼표로 나눈다 */
function splitTop(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (c === '"' || c === "'" || c === '`') {
      i = stringEnd(text, i) - 1;
      continue;
    }
    if (c === '(' || c === '{' || c === '[' || c === '<') depth++;
    else if (c === ')' || c === '}' || c === ']' || c === '>') depth--;
    else if (c === ',' && depth === 0) {
      out.push(text.slice(from, i));
      from = i + 1;
    }
  }
  out.push(text.slice(from));
  return out.map((s) => s.trim()).filter((s) => s !== '');
}

const firstString = (text: string): string | null => {
  const m = /(['"`])((?:\\.|(?!\1).)*)\1/.exec(text);
  return m === null ? null : (m[2] as string);
};

const namedString = (text: string, name: string): string | null => {
  const m = new RegExp(`\\b${name}\\s*[:=]\\s*(\\[|\\{)?\\s*(['"\`])((?:\\\\.|(?!\\2).)*)\\2`).exec(text);
  return m === null ? null : (m[3] as string);
};

/** 경로 조각들을 이어 `/a/b` 모양으로. 빈 경로는 `/` */
export function joinPath(...parts: readonly string[]): string {
  const p = parts
    .flatMap((x) => x.split('/'))
    .map((x) => x.trim())
    .filter((x) => x !== '')
    .join('/');
  return `/${p}`;
}

const HTTP: Record<string, ApiMethod> = { Get: 'GET', Post: 'POST', Put: 'PUT', Patch: 'PATCH', Delete: 'DELETE', Head: 'HEAD', Options: 'OPTIONS', All: 'GET' };

// ── 클래스 필드 → JSON 뼈대 ──

interface Field {
  readonly name: string;
  readonly type: string;
  /** 필드에 붙은 검증 규칙(class-validator 데코레이터, Bean Validation 애너테이션) */
  readonly rules: readonly FieldRule[];
  readonly optional: boolean;
}
type ClassIndex = Map<string, readonly Field[]>;

/** 클래스 필드와 enum 값(예시 값을 고를 때 둘 다 본다) */
interface Shapes {
  readonly classes: ClassIndex;
  readonly enums: EnumIndex;
}

const ARRAY_RULES = /^(Size|ArrayMinSize|ArrayMaxSize|IsArray|NotEmpty|ArrayNotEmpty)$/;

/** 타입 이름 하나에서 보기 좋은 예시 값. 필드를 주면 이름·검증 규칙까지 본다 */
function sampleOf(type: string, shapes: Shapes, depth: number, field?: Field): unknown {
  const t = type.trim().replace(/\s*\|\s*(null|undefined)\b/g, '').replace(/\?$/, '');
  const arr = /^(?:Array|List|Set|Collection|Iterable)<(.+)>$/.exec(t) ?? /^(.+)\[\]$/.exec(t);
  if (arr !== null) {
    const inner = arr[1] as string;
    return [sampleOf(inner, shapes, depth + 1, field === undefined ? undefined : { ...field, type: inner, rules: field.rules.filter((r) => !ARRAY_RULES.test(r.name)) })];
  }
  const simple = (t.split(/[<|&]/)[0]?.trim() ?? '').replace(/^.*\./, '');
  const fields = shapes.classes.get(simple);
  if (fields !== undefined && !shapes.enums.has(simple)) {
    if (depth >= SAMPLE_DEPTH) return null;
    const out: Record<string, unknown> = {};
    for (const f of fields.slice(0, MAX_FIELDS)) if (f.name !== '__proto__') out[f.name] = sampleOf(f.type, shapes, depth + 1, f);
    return out;
  }
  if (field === undefined && /^(unknown|any|object|Object)?$/.test(simple)) return null;
  const v = ExampleValue.forField(field ?? { name: '', type: t, rules: [], optional: false }, shapes.enums);
  return v === undefined ? null : v;
}

/** 필드 선언 바로 앞의 데코레이터·애너테이션들(`@IsInt() @Min(1)\n age: number` 의 앞부분) */
function rulesOf(rawBody: string, name: string, between: string): FieldRule[] {
  const re = new RegExp(`((?:@(?:\\w+:)?\\w+(?:\\s*\\((?:[^()]|\\((?:[^()]|\\([^()]*\\))*\\))*\\))?\\s*)+)${between}\\b${name}\\b`);
  const m = re.exec(rawBody);
  return m === null ? [] : parseRules(m[1] as string);
}

/** 핸들러 이름이 적힌 줄(1부터). 클래스 선언 뒤에서 처음 나오는 `이름(` 자리 */
function lineOf(text: string, handler: string, className: string): number | undefined {
  const at = text.search(new RegExp(`\\bclass\\s+${className}\\b`));
  const from = Math.max(0, at);
  const m = new RegExp(`\\b${handler}\\s*(?:<[^>()]*>)?\\s*\\(`).exec(text.slice(from));
  return m === null ? undefined : text.slice(0, from + m.index).split('\n').length;
}

/** 경로의 `:이름` 중 예시가 없는 것은 이름으로 짐작해 채운다 */
function withPathExamples(path: string, examples: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = { ...examples };
  for (const m of path.matchAll(/:(\w+)/g)) if (out[m[1] as string] === undefined) out[m[1] as string] = ExampleValue.forParam(m[1] as string, '');
  return out;
}

/** TS 클래스들의 필드(extends와 PartialType(X) 같은 매핑 타입은 부모 필드를 앞에 붙인다) */
function indexTsClasses(files: readonly SourceFile[]): ClassIndex {
  const raw = new Map<string, { fields: Field[]; parents: string[] }>();
  for (const f of files) {
    const re = /\bclass\s+(\w+)(?:\s*<[^>{]*>)?(?:\s+extends\s+([^{]+?))?(?:\s+implements\s+[^{]+)?\s*\{/g;
    for (let m = re.exec(f.text); m !== null; m = re.exec(f.text)) {
      const open = m.index + m[0].length - 1;
      const close = closeOf(f.text, open);
      const classBody = f.text.slice(open + 1, close);
      const body = topLevel(classBody).replace(/@[\w.]+\s*(\(\))?/g, '');
      const fields: Field[] = [];
      for (const p of body.matchAll(/^[ \t]*(?:(?:public|private|protected|readonly|declare)\s+)*(\w+)\s*([?!])?\s*:\s*([^;=\n]+)/gm)) {
        const name = p[1] as string;
        if (name === 'constructor' || fields.some((x) => x.name === name)) continue;
        const rules = rulesOf(classBody, name, '(?:(?:public|private|protected|readonly|declare)\\s+)*');
        fields.push({ name, type: (p[3] as string).trim(), rules, optional: p[2] === '?' || rules.some((r) => r.name === 'IsOptional' || r.name === 'ApiPropertyOptional') });
      }
      const parents = m[2] === undefined ? [] : [...m[2].matchAll(/\b([A-Z]\w*)\b/g)].map((x) => x[1] as string).filter((x) => !/^(PartialType|PickType|OmitType|IntersectionType)$/.test(x));
      if (!raw.has(m[1] as string)) raw.set(m[1] as string, { fields, parents });
    }
  }
  return resolveParents(raw);
}

function resolveParents(raw: Map<string, { fields: Field[]; parents: string[] }>): ClassIndex {
  const out: ClassIndex = new Map();
  const resolve = (name: string, seen: Set<string>): readonly Field[] => {
    const done = out.get(name);
    if (done !== undefined) return done;
    const r = raw.get(name);
    if (r === undefined || seen.has(name)) return [];
    seen.add(name);
    const merged: Field[] = [];
    for (const p of r.parents) for (const f of resolve(p, seen)) if (!merged.some((x) => x.name === f.name)) merged.push(f);
    for (const f of r.fields) if (!merged.some((x) => x.name === f.name)) merged.push(f);
    out.set(name, merged);
    return merged;
  };
  for (const k of raw.keys()) resolve(k, new Set());
  return out;
}

/** 중괄호 안쪽(한 겹 더 깊은 곳)을 지운 글: 클래스 몸통에서 필드 줄만 남기려고 */
function topLevel(body: string): string {
  const parts: string[] = [];
  let from = 0;
  const re = /["'`{(]/g;
  for (let m = re.exec(body); m !== null; m = re.exec(body)) {
    const c = m[0];
    if (c === '"' || c === "'" || c === '`') {
      re.lastIndex = stringEnd(body, m.index);
      continue;
    }
    parts.push(body.slice(from, m.index), c === '{' ? '{}' : '()');
    from = closeOf(body, m.index) + 1;
    re.lastIndex = from;
  }
  parts.push(body.slice(from));
  return parts.join('');
}

// ── NestJS ──

interface Decorator {
  readonly name: string;
  readonly args: string;
}

const DECORATOR_RE = /@([\w.]+)\s*/y;

/** 클래스 몸통을 멤버 단위로 걷는다: 데코레이터 묶음과 그 뒤 메서드 이름·인자 */
function walkMembers(body: string, visit: (decorators: readonly Decorator[], name: string, params: string) => void): void {
  let i = 0;
  let pending: Decorator[] = [];
  while (i < body.length) {
    while (i < body.length && /[\s;,]/.test(body[i] as string)) i++;
    if (i >= body.length) break;
    if (body[i] === '@') {
      DECORATOR_RE.lastIndex = i;
      const m = DECORATOR_RE.exec(body);
      if (m === null) {
        i++;
        continue;
      }
      i += m[0].length;
      let args = '';
      if (body[i] === '(') {
        const end = closeOf(body, i);
        args = body.slice(i + 1, end);
        i = end + 1;
      }
      pending.push({ name: m[1] as string, args });
      continue;
    }
    const sig = /^(?:(?:public|private|protected|static|async|readonly|override)\s+)*(\w+)\s*(?:<[^>()]*>)?\s*\(/.exec(body.slice(i, i + 400));
    if (sig !== null && sig[1] !== 'constructor') {
      const open = i + sig[0].length - 1;
      const end = closeOf(body, open);
      visit(pending, sig[1] as string, body.slice(open + 1, end));
      i = end + 1;
    }
    pending = [];
    i = skipMember(body, i);
  }
}

/** 멤버 하나를 건너뛴다(최상위 `;` 또는 `{…}` 블록까지) */
function skipMember(text: string, from: number): number {
  let depth = 0;
  let i = from;
  while (i < text.length) {
    const c = text[i] as string;
    if (c === '"' || c === "'" || c === '`') {
      i = stringEnd(text, i);
      continue;
    }
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === '{' && depth <= 0) return closeOf(text, i) + 1;
    else if (c === ';' && depth <= 0) return i + 1;
    else if (c === '@' && depth <= 0 && i > from) return i;
    i++;
  }
  return text.length;
}

const decoratorString = (decorators: readonly Decorator[], name: string): string | null => {
  const d = decorators.find((x) => x.name === name);
  return d === undefined ? null : firstString(d.args);
};

export function extractNest(files: readonly SourceFile[]): ExtractedApi {
  const clean = files.map((f) => ({ path: f.path, text: stripComments(f.text) }));
  const all = clean.map((f) => f.text).join('\n');
  const prefix = /\.setGlobalPrefix\(\s*(['"`])([^'"`]*)\1/.exec(all)?.[2] ?? '';
  const versioning = /\.enableVersioning\(([^;]*)\)/.exec(all);
  const uriVersion = versioning !== null && !/VersioningType\.(HEADER|MEDIA_TYPE|CUSTOM)/.test(versioning[1] as string);
  const versionPrefix = versioning === null ? 'v' : /prefix\s*:\s*false/.test(versioning[1] as string) ? '' : (namedString(versioning[1] as string, 'prefix') ?? 'v');
  const defaultVersion = versioning === null ? null : namedString(versioning[1] as string, 'defaultVersion');
  const listen = /\.listen\(([^;]*)\)/.exec(all);
  const port = listen === null ? null : portIn(listen[1] as string);
  const shapes: Shapes = { classes: indexTsClasses(clean), enums: indexEnums(clean.map((f) => f.text)) };
  const original = new Map(files.map((f) => [f.path, f.text]));

  const groups: EndpointGroup[] = [];
  for (const f of clean) {
    const re = /@Controller\s*\(/g;
    for (let m = re.exec(f.text); m !== null; m = re.exec(f.text)) {
      const argOpen = m.index + m[0].length - 1;
      const argEnd = closeOf(f.text, argOpen);
      const arg = f.text.slice(argOpen + 1, argEnd).trim();
      const cls = /\bclass\s+(\w+)[^{]*\{/.exec(f.text.slice(argEnd));
      if (cls === null) continue;
      // 클래스 앞 데코레이터들: 앞 블록이 끝난 곳(`}`)부터 class 키워드까지
      const pre = f.text.slice(Math.max(0, m.index - 600), m.index);
      const before = pre.slice(pre.lastIndexOf('}') + 1) + f.text.slice(m.index, argEnd + cls.index);
      const bodyOpen = argEnd + cls.index + cls[0].length - 1;
      const body = f.text.slice(bodyOpen + 1, closeOf(f.text, bodyOpen));
      const ctrlPath = arg === '' ? '' : arg.startsWith('{') ? (namedString(arg, 'path') ?? '') : (firstString(arg) ?? '');
      const ctrlVersion = arg.startsWith('{') ? namedString(arg, 'version') : null;
      const className = cls[1] as string;
      const tag = /@ApiTags\(\s*(['"`])([^'"`]+)\1/.exec(before)?.[2];
      const classBearer = /@ApiBearerAuth\b/.test(before);
      const endpoints: ApiEndpoint[] = [];
      walkMembers(body, (decorators, name, params) => {
        const http = decorators.find((d) => HTTP[d.name] !== undefined);
        if (http === undefined) return;
        const version = decoratorString(decorators, 'Version') ?? ctrlVersion ?? defaultVersion;
        const vSeg = uriVersion && version !== null && version !== '' ? `${versionPrefix}${version}` : '';
        const summary = decorators.find((d) => d.name === 'ApiOperation');
        const { query, body: bodySample, examples } = nestParams(params, shapes);
        const path = joinPath(prefix, vSeg, ctrlPath, firstString(http.args) ?? '');
        const line = lineOf(original.get(f.path) ?? '', name, className);
        endpoints.push({
          method: HTTP[http.name] as ApiMethod,
          path,
          name: (summary === undefined ? null : namedString(summary.args, 'summary')) ?? name,
          query,
          body: bodySample,
          bearer: classBearer || decorators.some((d) => d.name === 'ApiBearerAuth'),
          examples: withPathExamples(path, examples),
          handler: name,
          file: f.path,
          ...(line !== undefined ? { line } : {}),
        });
      });
      if (endpoints.length > 0) groups.push({ key: className, name: tag ?? (className.replace(/Controller$/, '') || className), endpoints });
    }
  }
  return { source: 'nest', groups, port };
}

const PARAM_ARGS = /\(((?:[^()]|\((?:[^()]|\([^()]*\))*\))*)\)/;
const pipesIn = (args: string): string[] => [...args.matchAll(/\b(Parse\w*Pipe)\b/g)].map((m) => m[1] as string);
const scalarText = (v: unknown): string => (v === null || typeof v === 'object' ? 'sample' : String(v));

function nestParams(params: string, shapes: Shapes): { query: string[]; body: unknown; examples: Record<string, string> } {
  const query: string[] = [];
  const examples: Record<string, string> = {};
  let body: unknown = null;
  for (const p of splitTop(params)) {
    const typeOf = (): string => /\)\s*\w+\s*[?!]?\s*:\s*([\w.<>[\]]+)/.exec(p)?.[1] ?? '';
    const q = new RegExp(`@Query\\s*${PARAM_ARGS.source}`).exec(p);
    if (q !== null) {
      const args = q[1] as string;
      const named = firstString(args);
      if (named !== null) {
        query.push(named);
        examples[named] = ExampleValue.forParam(named, typeOf(), pipesIn(args), /new\s+DefaultValuePipe\(\s*['"]?([^'")]+)/.exec(args)?.[1]);
      } else
        for (const f of shapes.classes.get(typeOf()) ?? []) {
          query.push(f.name);
          examples[f.name] = scalarText(sampleOf(f.type, shapes, 1, f));
        }
      continue;
    }
    const pa = new RegExp(`@Param\\s*${PARAM_ARGS.source}`).exec(p);
    if (pa !== null) {
      const named = firstString(pa[1] as string);
      if (named !== null) examples[named] = ExampleValue.forParam(named, typeOf(), pipesIn(pa[1] as string));
      continue;
    }
    const b = /@Body\s*\(\s*([^)]*)\)/.exec(p);
    if (b !== null) {
      const named = firstString(b[1] as string);
      const type = typeOf() || 'unknown';
      const sample = sampleOf(type, shapes, 0, named === null ? undefined : { name: named, type, rules: [], optional: false });
      if (named !== null) body = { ...(typeof body === 'object' && body !== null ? body : {}), [named]: sample ?? '' };
      else body = sample ?? {};
    }
  }
  return { query: [...new Set(query)], body, examples };
}

function portIn(text: string): number | null {
  const nums = [...text.matchAll(/\b(\d{2,5})\b/g)].map((m) => Number(m[1])).filter((n) => n >= 80 && n <= 65535);
  return nums[nums.length - 1] ?? null;
}

// ── Spring ──

const SPRING_MAPPING: Record<string, ApiMethod | null> = { GetMapping: 'GET', PostMapping: 'POST', PutMapping: 'PUT', PatchMapping: 'PATCH', DeleteMapping: 'DELETE', RequestMapping: null };

/** Bean Validation 은 @NotNull·@NotBlank·@NotEmpty 가 없으면 비워도 되는 값이다 */
const jvmField = (name: string, type: string, rules: readonly FieldRule[]): Field => ({ name, type, rules, optional: !rules.some((r) => /^(NotNull|NotBlank|NotEmpty)$/.test(r.name)) || /\?$/.test(type) });

/** Java·Kotlin 클래스 필드(필드, record 구성 요소, data class 생성자 프로퍼티) */
function indexJvmClasses(files: readonly SourceFile[]): ClassIndex {
  const raw = new Map<string, { fields: Field[]; parents: string[] }>();
  for (const f of files) {
    for (const m of f.text.matchAll(/\brecord\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)/g)) {
      const fields = splitTop(m[2] as string).flatMap((c): Field[] => {
        const x = /([\w.<>[\], ]+?)\s+(\w+)$/.exec(c.replace(/@\w+(\([^)]*\))?\s*/g, '').trim());
        return x === null ? [] : [jvmField(x[2] as string, (x[1] as string).trim(), parseRules(c))];
      });
      raw.set(m[1] as string, { fields, parents: [] });
    }
    const re = /\bclass\s+(\w+)\s*(?:<[^>]*>)?\s*(\()?/g;
    for (let m = re.exec(f.text); m !== null; m = re.exec(f.text)) {
      const name = m[1] as string;
      const fields: Field[] = [];
      let after = m.index + m[0].length;
      if (m[2] === '(') {
        const end = closeOf(f.text, after - 1);
        const ctorText = f.text.slice(after, end);
        for (const p of ctorText.matchAll(/\b(?:val|var)\s+(\w+)\s*:\s*([\w.<>?]+)/g)) fields.push(jvmField(p[1] as string, p[2] as string, rulesOf(ctorText, p[1] as string, '(?:(?:private|protected|public)\\s+)*(?:val|var)\\s+')));
        after = end + 1;
      }
      const ext = /^\s*(?:(?:extends|:)\s*([\w.]+))?[^{;]*\{/.exec(f.text.slice(after));
      if (ext !== null) {
        const open = after + ext[0].length - 1;
        const rawBody = f.text.slice(open + 1, closeOf(f.text, open));
        const body = topLevel(rawBody);
        for (const p of body.matchAll(/(?:private|protected|public)\s+(?:final\s+)?([\w.<>[\], ?]+?)\s+(\w+)\s*(?:=[^;]*)?;/g)) {
          if (!/\bstatic\b/.test(p[0])) fields.push(jvmField(p[2] as string, (p[1] as string).trim(), rulesOf(rawBody, p[2] as string, '(?:private|protected|public)\\s+(?:final\\s+)?[\\w.<>\\[\\], ?]+?\\s+')));
        }
        for (const p of body.matchAll(/^\s*(?:(?:private|protected|public|lateinit)\s+)*(?:val|var)\s+(\w+)\s*:\s*([\w.<>?]+)/gm)) fields.push(jvmField(p[1] as string, p[2] as string, rulesOf(rawBody, p[1] as string, '(?:(?:private|protected|public|lateinit)\\s+)*(?:val|var)\\s+')));
      }
      if (!raw.has(name)) raw.set(name, { fields, parents: ext?.[1] === undefined ? [] : [(ext[1] as string).replace(/^.*\./, '')] });
    }
  }
  return resolveParents(raw);
}

function springMappingPath(args: string): string {
  if (args.trim() === '') return '';
  return namedString(args, 'value') ?? namedString(args, 'path') ?? (/^\s*(\{|\[)?\s*['"]/.test(args) ? (firstString(args) ?? '') : '');
}

export function extractSpring(files: readonly SourceFile[]): ExtractedApi {
  const clean = files.map((f) => ({ path: f.path, text: stripComments(f.text) }));
  const props = clean.filter((f) => /application[\w-]*\.(properties|ya?ml)$/.test(f.path));
  const code = clean.filter((f) => /\.(java|kt)$/.test(f.path));
  const conf = props.map((p) => p.text).join('\n');
  const contextPath = /server\.servlet\.context-path\s*[=:]\s*(\S+)/.exec(conf)?.[1] ?? /^\s*context-path\s*:\s*['"]?([^\s'"]+)/m.exec(conf)?.[1] ?? '';
  const portText = /server\.port\s*[=:]\s*(\d+)/.exec(conf)?.[1] ?? /^\s*port\s*:\s*(\d+)/m.exec(conf)?.[1];
  const shapes: Shapes = { classes: indexJvmClasses(code), enums: indexEnums(code.map((f) => f.text)) };
  const original = new Map(files.map((f) => [f.path, f.text]));

  const groups: EndpointGroup[] = [];
  for (const f of code) {
    const re = /@(RestController|Controller)\b(?!Advice)(\s*\([^)]*\))?/g;
    for (let m = re.exec(f.text); m !== null; m = re.exec(f.text)) {
      const cls = /\bclass\s+(\w+)/.exec(f.text.slice(m.index));
      if (cls === null) continue;
      const head = f.text.slice(m.index, m.index + cls.index);
      const before = f.text.slice(Math.max(0, m.index - 600), m.index) + head;
      const classMap = /@RequestMapping\s*\(([^)]*)\)/.exec(head);
      const base = classMap === null ? '' : springMappingPath(classMap[1] as string);
      const tag = /@Tag\s*\([^)]*name\s*=\s*"([^"]+)"/.exec(before)?.[1] ?? /@Api\s*\([^)]*tags\s*=\s*\{?\s*"([^"]+)"/.exec(before)?.[1];
      const afterName = m.index + cls.index + cls[0].length;
      let open = afterName;
      const rest = f.text.slice(afterName);
      const ctor = /^\s*(?:<[^>]*>)?\s*\(/.exec(rest);
      if (ctor !== null) open = closeOf(f.text, afterName + ctor[0].length - 1) + 1;
      open = f.text.indexOf('{', open);
      if (open === -1) continue;
      const body = f.text.slice(open + 1, closeOf(f.text, open));
      const className = cls[1] as string;
      const endpoints: ApiEndpoint[] = [];
      let windowStart = 0;
      const mre = /@(GetMapping|PostMapping|PutMapping|PatchMapping|DeleteMapping|RequestMapping)\b\s*(\()?/g;
      for (let a = mre.exec(body); a !== null; a = mre.exec(body)) {
        let i = a.index + a[0].length;
        let args = '';
        if (a[2] === '(') {
          const end = closeOf(body, i - 1);
          args = body.slice(i, end);
          i = end + 1;
        }
        // 다른 애너테이션을 건너뛰고 메서드 이름과 인자
        for (;;) {
          while (i < body.length && /\s/.test(body[i] as string)) i++;
          DECORATOR_RE.lastIndex = i;
          const ann = DECORATOR_RE.exec(body);
          if (ann === null) break;
          i += ann[0].length;
          if (body[i] === '(') i = closeOf(body, i) + 1;
        }
        const sig = /^[^;{}()@=]*?\b(\w+)\s*\(/.exec(body.slice(i, i + 400));
        if (sig === null) continue;
        const pOpen = i + sig[0].length - 1;
        const pEnd = closeOf(body, pOpen);
        const window = body.slice(windowStart, i);
        windowStart = pEnd + 1;
        mre.lastIndex = pEnd + 1;
        let method = SPRING_MAPPING[a[1] as string] ?? null;
        if (method === null) method = (/RequestMethod\.(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)/.exec(args)?.[1] as ApiMethod | undefined) ?? 'GET';
        const summary = /@Operation\s*\([^)]*summary\s*=\s*"([^"]*)"/.exec(window)?.[1] ?? /@ApiOperation\s*\(\s*(?:value\s*=\s*)?"([^"]*)"/.exec(window)?.[1];
        const { query, body: bodySample, examples } = springParams(body.slice(pOpen + 1, pEnd), shapes);
        const path = joinPath(contextPath, base, springMappingPath(args)).replace(/\{(\w+)(?::[^}]*)?\}/g, ':$1');
        const handler = sig[1] as string;
        const line = lineOf(original.get(f.path) ?? '', handler, className);
        endpoints.push({
          method,
          path,
          name: summary ?? handler,
          query,
          body: bodySample,
          bearer: false,
          examples: withPathExamples(path, examples),
          handler,
          file: f.path,
          ...(line !== undefined ? { line } : {}),
        });
      }
      if (endpoints.length > 0) groups.push({ key: className, name: tag ?? (className.replace(/Controller$/, '') || className), endpoints });
    }
  }
  return { source: 'spring', groups, port: portText === undefined ? 8080 : Number(portText) };
}

/** `Long id`, `id: Long` 에서 타입 */
const jvmParamType = (rest: string): string => /^\w+\s*:\s*([\w.<>?]+)/.exec(rest)?.[1] ?? /^([\w.<>[\], ]+?)\s+\w+$/.exec(rest)?.[1] ?? '';

function springParams(params: string, shapes: Shapes): { query: string[]; body: unknown; examples: Record<string, string> } {
  const query: string[] = [];
  const examples: Record<string, string> = {};
  let body: unknown = null;
  for (const p of splitTop(params)) {
    const rp = /@(RequestParam|PathVariable)\b\s*(\(([^)]*)\))?/.exec(p);
    if (rp !== null) {
      const args = rp[3] ?? '';
      const named = namedString(args, 'value') ?? namedString(args, 'name') ?? (/^\s*"/.test(args) ? firstString(args) : null);
      const rest = p.slice(rp.index + rp[0].length).replace(/@\w+(\([^)]*\))?/g, '').replace(/\bfinal\s+/, '').trim();
      const varName = /^(\w+)\s*:/.exec(rest)?.[1] ?? /(\w+)\s*$/.exec(rest)?.[1];
      const name = named ?? varName;
      if (name === undefined) continue;
      examples[name] = ExampleValue.forParam(name, jvmParamType(rest), [], namedString(args, 'defaultValue') ?? undefined);
      if (rp[1] === 'RequestParam') query.push(name);
      continue;
    }
    if (/@RequestBody\b/.test(p)) {
      const rest = p.replace(/@\w+(\([^)]*\))?/g, '').replace(/\bfinal\s+/, '').trim();
      body = sampleOf(jvmParamType(rest), shapes, 0) ?? {};
    }
  }
  return { query: [...new Set(query)], body, examples };
}

/** 원래 글에서 그 조각이 처음 나오는 줄(1부터) */
const lineAt = (text: string, piece: string): number | undefined => {
  const at = text.indexOf(piece);
  return at === -1 ? undefined : text.slice(0, at).split('\n').length;
};

// ── Express·Fastify·Koa ──

const ROUTER_RE = /\b(app|server|router|routes|fastify|\w+Router|\w+Routes)\.(get|post|put|patch|delete)\s*\(\s*(['"`])(\/[^'"`]*)\3/g;

export function extractExpress(files: readonly SourceFile[]): ExtractedApi {
  const groups: EndpointGroup[] = [];
  for (const f of files) {
    const text = stripComments(f.text);
    const endpoints: ApiEndpoint[] = [];
    for (const m of text.matchAll(ROUTER_RE)) {
      const method = (m[2] as string).toUpperCase() as ApiMethod;
      const path = joinPath(m[4] as string);
      const line = lineAt(f.text, m[0]);
      endpoints.push({ method, path, name: `${method} ${path}`, query: [], body: method === 'POST' || method === 'PUT' || method === 'PATCH' ? {} : null, bearer: false, examples: withPathExamples(path, {}), file: f.path, ...(line !== undefined ? { line } : {}) });
    }
    if (endpoints.length > 0) groups.push({ key: f.path, name: (f.path.split('/').pop() ?? f.path).replace(/\.(routes?|router|controller)?\.?[cm]?[jt]s$/, '').replace(/\.$/, '') || f.path, endpoints });
  }
  return { source: 'express', groups, port: null };
}

// ── Next.js app/api · pages/api ──

const nextSegment = (s: string): string | null => {
  if (/^\(.*\)$/.test(s) || s.startsWith('@')) return null;
  const dyn = /^\[{1,2}(?:\.\.\.)?(\w+)\]{1,2}$/.exec(s);
  return dyn === null ? s : `:${dyn[1]}`;
};

export function extractNext(files: readonly SourceFile[]): ExtractedApi {
  const byGroup = new Map<string, ApiEndpoint[]>();
  const add = (segs: readonly string[], method: ApiMethod, name: string, file: string): void => {
    const path = joinPath(...segs);
    const group = segs[1] ?? 'api';
    byGroup.set(group, [...(byGroup.get(group) ?? []), { method, path, name: name === '' ? `${method} ${path}` : name, query: [], body: method === 'POST' || method === 'PUT' || method === 'PATCH' ? {} : null, bearer: false, examples: withPathExamples(path, {}), file }]);
  };
  for (const f of files) {
    const text = stripComments(f.text);
    const parts = f.path.split('/');
    const appAt = parts.indexOf('app');
    const isRoute = /^route\.[cm]?[jt]s$/.test(parts[parts.length - 1] ?? '');
    if (appAt !== -1 && isRoute) {
      const segs = parts.slice(appAt + 1, -1).map(nextSegment).filter((s): s is string => s !== null);
      if (segs[0] !== 'api') continue;
      const methods = [...text.matchAll(/export\s+(?:async\s+)?(?:function|const|let)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)].map((m) => m[1] as ApiMethod);
      for (const m of new Set(methods)) add(segs, m, '', f.path);
      continue;
    }
    const pagesAt = parts.lastIndexOf('pages');
    if (pagesAt !== -1 && parts[pagesAt + 1] === 'api') {
      const segs = parts.slice(pagesAt + 1).map((s, i, a) => (i === a.length - 1 ? s.replace(/\.[cm]?[jt]sx?$/, '') : s));
      if (segs[segs.length - 1] === 'index') segs.pop();
      const clean = segs.map(nextSegment).filter((s): s is string => s !== null);
      const methods = [...text.matchAll(/method\s*===?\s*['"](GET|POST|PUT|PATCH|DELETE)['"]/g)].map((m) => m[1] as ApiMethod);
      for (const m of methods.length === 0 ? (['GET'] as ApiMethod[]) : [...new Set(methods)]) add(clean, m, '', f.path);
    }
  }
  return { source: 'next', groups: [...byGroup].map(([key, endpoints]) => ({ key, name: key, endpoints })), port: 3000 };
}
