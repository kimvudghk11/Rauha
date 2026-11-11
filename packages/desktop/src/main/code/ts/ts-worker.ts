import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, relative } from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import * as ts from 'typescript';
import { offsetToLineCol, type NavDiagnostic, type NavLocation } from '../../../shared/ts-nav.js';
import { MAX_TS_DIAGNOSTICS, MAX_TS_PROJECT_FILES, MAX_TS_REFERENCES, type TsRequest, type TsResponse, type TsWorkerData, type TsWorkerIn, type TsWorkerOut } from './ts-protocol.js';

/**
 * TypeScript 언어 도구 worker. typescript 패키지의 LanguageService 를 그대로 쓴다(별도 언어 서버 프로세스 없음).
 * 읽는 파일은 작업 폴더 안(.git·비밀 이름 제외), typescript 의 lib 폴더, 그리고 node_modules 의 타입/패키지 파일뿐이다.
 * 돌려주는 위치는 작업 폴더 안 파일만이다(lib·바깥 node_modules 는 버린다).
 */

const data = workerData as TsWorkerData;
const fold = process.platform !== 'linux';
const slash = (p: string): string => p.split('\\').join('/');
const key = (p: string): string => (fold ? p.toLowerCase() : p);
const ROOT = slash(data.root).replace(/\/+$/, '');
const LIB = slash(data.libDir).replace(/\/+$/, '');
const inside = (base: string, p: string): boolean => key(p) === key(base) || key(p).startsWith(`${key(base)}/`);

const SECRET_NAME = /^(\.env(\..*)?|\.npmrc|\.netrc|\.pgpass|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|credentials(\.json)?|.*\.(pem|key|p12|pfx|keystore|jks))$/i;
const PACKAGE_FILE = /\.(d\.[cm]?ts|[cm]?[jt]sx?|json)$/i;

/** 읽어도 되는 파일인지. 화면에는 읽은 내용이 아니라 위치만 나가지만, 비밀 파일은 애초에 열지 않는다. */
function canRead(abs: string): boolean {
  const p = slash(abs);
  if (p.includes('\0')) return false;
  if (inside(LIB, p)) return true;
  if (basename(p) !== '' && SECRET_NAME.test(basename(p))) return false;
  if (inside(ROOT, p)) return !`/${p}/`.includes('/.git/');
  return p.includes('/node_modules/') && PACKAGE_FILE.test(p) && !p.includes('/.git/');
}

const readText = (abs: string): string | undefined => {
  if (!canRead(abs)) return undefined;
  try {
    if (statSync(abs).size > 5 * 1024 * 1024) return undefined;
    return readFileSync(abs, 'utf8');
  } catch {
    return undefined;
  }
};

const overlay = new Map<string, { text: string; version: number }>();
let tick = 0;
const stamp = new Map<string, { tick: number; v: string }>();
function diskVersion(abs: string): string {
  const hit = stamp.get(abs);
  if (hit !== undefined && hit.tick === tick) return hit.v;
  let v = '0';
  try {
    const s = statSync(abs);
    v = `${Math.round(s.mtimeMs)}:${s.size}`;
  } catch {
    v = 'missing';
  }
  stamp.set(abs, { tick, v });
  return v;
}

const registry = ts.createDocumentRegistry(!fold, ROOT);

interface Project {
  readonly options: ts.CompilerOptions;
  readonly fileNames: readonly string[];
  readonly extra: Set<string>;
  readonly service: ts.LanguageService;
}
const projects = new Map<string, Project>();
const MAX_PROJECTS = 5;
const MAX_EXTRA_ROOTS = 60;

const sysHost: ts.ParseConfigFileHost = {
  useCaseSensitiveFileNames: !fold,
  readDirectory: (path, ext, exclude, include, depth) => ts.sys.readDirectory(path, ext, exclude, include, depth).filter((f) => canRead(f)),
  fileExists: (f) => canRead(f) && ts.sys.fileExists(f),
  readFile: (f) => readText(f),
  getCurrentDirectory: () => ROOT,
  onUnRecoverableConfigFileDiagnostic: () => undefined,
};

const DEFAULT_OPTIONS: ts.CompilerOptions = {
  allowJs: true,
  checkJs: false,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.Preserve,
  esModuleInterop: true,
  skipLibCheck: true,
  noEmit: true,
  types: [],
};

function createProject(options: ts.CompilerOptions, fileNames: readonly string[]): Project {
  const extra = new Set<string>();
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => options,
    getScriptFileNames: () => [...fileNames, ...extra],
    getScriptVersion: (f) => {
      const o = overlay.get(slash(f));
      return o !== undefined ? `o${o.version}` : diskVersion(f);
    },
    getScriptSnapshot: (f) => {
      const o = overlay.get(slash(f));
      const text = o !== undefined ? o.text : readText(f);
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
    },
    getCurrentDirectory: () => ROOT,
    getDefaultLibFileName: (o) => `${LIB}/${ts.getDefaultLibFileName(o)}`,
    fileExists: (f) => overlay.has(slash(f)) || (canRead(f) && ts.sys.fileExists(f)),
    readFile: (f) => overlay.get(slash(f))?.text ?? readText(f),
    readDirectory: (path, ext, exclude, include, depth) => [...sysHost.readDirectory(path, ext ?? [], exclude, include ?? [], depth)],
    directoryExists: (d) => (inside(ROOT, slash(d)) || inside(LIB, slash(d)) || slash(d).includes('/node_modules')) && ts.sys.directoryExists(d),
    getDirectories: (d) => (inside(ROOT, slash(d)) || slash(d).includes('/node_modules') ? ts.sys.getDirectories(d) : []),
    useCaseSensitiveFileNames: () => !fold,
    realpath: (p) => p,
  };
  return { options, fileNames, extra, service: ts.createLanguageService(host, registry) };
}

/** 이 파일이 속한 프로젝트: 가까운 tsconfig/jsconfig 중 이 파일을 담은 것, 없으면 가장 가까운 설정의 옵션 + 이 파일만 */
function projectFor(abs: string): Project {
  const candidates: string[] = [];
  for (let dir = slash(dirname(abs)); inside(ROOT, dir); dir = slash(dirname(dir))) {
    for (const name of ['tsconfig.json', 'jsconfig.json']) {
      const c = `${dir}/${name}`;
      if (canRead(c) && existsSync(c)) candidates.push(c);
    }
    if (key(dir) === key(ROOT)) break;
  }
  let fallbackOptions: ts.CompilerOptions | null = null;
  for (const cfg of candidates) {
    const cached = projects.get(cfg);
    if (cached !== undefined && cached.fileNames.some((f) => key(slash(f)) === key(abs))) return touch(cfg, cached);
    if (cached !== undefined) {
      fallbackOptions ??= cached.options;
      continue;
    }
    const parsed = ts.getParsedCommandLineOfConfigFile(cfg, { noEmit: true }, { ...sysHost, useCaseSensitiveFileNames: !fold });
    if (parsed === undefined) continue;
    const names = parsed.fileNames.length > MAX_TS_PROJECT_FILES ? [] : parsed.fileNames.map(slash);
    const project = createProject({ ...parsed.options, noEmit: true }, names);
    remember(cfg, project);
    if (names.some((f) => key(f) === key(abs))) return project;
    fallbackOptions ??= parsed.options;
  }
  const implicitKey = `implicit:${candidates[0] ?? ''}`;
  let implicit = projects.get(implicitKey);
  if (implicit === undefined) {
    implicit = createProject({ ...(fallbackOptions ?? DEFAULT_OPTIONS), allowJs: true, noEmit: true }, []);
    remember(implicitKey, implicit);
  }
  if (implicit.extra.size >= MAX_EXTRA_ROOTS) implicit.extra.clear();
  implicit.extra.add(abs);
  return touch(implicitKey, implicit);
}

function touch(k: string, p: Project): Project {
  projects.delete(k);
  projects.set(k, p);
  return p;
}
function remember(k: string, p: Project): void {
  projects.set(k, p);
  while (projects.size > MAX_PROJECTS) {
    const oldest = projects.keys().next();
    if (oldest.done === true) break;
    projects.get(oldest.value)?.service.dispose();
    projects.delete(oldest.value);
  }
}

function locationOf(program: ts.Program, fileName: string, start: number, length: number): NavLocation | null {
  const abs = slash(fileName);
  if (!inside(ROOT, abs)) return null;
  const sf = program.getSourceFile(fileName) ?? program.getSourceFile(abs);
  if (sf === undefined) return null;
  const text = sf.text;
  const { line, column } = offsetToLineCol(text, start);
  const lineStart = start - (column - 1);
  const nl = text.indexOf('\n', lineStart);
  const raw = text.slice(lineStart, nl === -1 ? text.length : nl).replace(/\r$/, '');
  const lead = raw.length - raw.trimStart().length;
  const preview = raw.trim().slice(0, 200);
  const from = Math.max(0, column - 1 - lead);
  return { path: relative(ROOT, abs).split('\\').join('/'), line, column, preview, start: Math.min(from, preview.length), end: Math.min(from + Math.max(length, 1), preview.length) };
}

function handle(req: TsRequest): TsResponse {
  tick++;
  const abs = `${ROOT}/${req.file}`;
  const prev = overlay.get(abs);
  if (prev === undefined) overlay.set(abs, { text: req.text, version: 1 });
  else if (prev.text !== req.text) overlay.set(abs, { text: req.text, version: prev.version + 1 });
  if (overlay.size > 40) {
    const oldest = overlay.keys().next();
    if (oldest.done !== true && oldest.value !== abs) overlay.delete(oldest.value);
  }
  const project = projectFor(abs);
  const service = project.service;
  if (req.op === 'diagnostics') {
    const semantic = existsSync(`${LIB}/lib.d.ts`);
    const all = [...service.getSyntacticDiagnostics(abs), ...(semantic ? service.getSemanticDiagnostics(abs) : [])].filter((d) => d.category === ts.DiagnosticCategory.Error || d.category === ts.DiagnosticCategory.Warning);
    const items: NavDiagnostic[] = [];
    for (const d of all.slice(0, MAX_TS_DIAGNOSTICS)) {
      const start = d.start ?? 0;
      const a = offsetToLineCol(req.text, start);
      const b = offsetToLineCol(req.text, start + (d.length ?? 0));
      items.push({ line: a.line, column: a.column, endLine: b.line, endColumn: b.column, severity: d.category === ts.DiagnosticCategory.Error ? 'error' : 'warning', code: d.code, message: ts.flattenDiagnosticMessageText(d.messageText, '\n').slice(0, 500) });
    }
    return { op: 'diagnostics', items, truncated: all.length > MAX_TS_DIAGNOSTICS, semantic };
  }
  const program = service.getProgram();
  if (program === undefined) return req.op === 'definition' ? { op: 'definition', locations: [] } : { op: 'references', locations: [], truncated: false };
  if (req.op === 'definition') {
    const defs = service.getDefinitionAndBoundSpan(abs, req.offset)?.definitions ?? [];
    const locations = defs.map((d) => locationOf(program, d.fileName, d.textSpan.start, d.textSpan.length)).filter((l): l is NavLocation => l !== null);
    return { op: 'definition', locations };
  }
  const refs = (service.findReferences(abs, req.offset) ?? []).flatMap((s) => s.references);
  const locations: NavLocation[] = [];
  for (const r of refs) {
    if (locations.length >= MAX_TS_REFERENCES) break;
    const loc = locationOf(program, r.fileName, r.textSpan.start, r.textSpan.length);
    if (loc !== null) locations.push(loc);
  }
  return { op: 'references', locations, truncated: refs.length > MAX_TS_REFERENCES };
}

if (parentPort !== null) {
  const port = parentPort;
  const send = (m: TsWorkerOut): void => port.postMessage(m);
  port.on('message', (m: TsWorkerIn) => {
    try {
      send({ id: m.id, res: handle(m.req) });
    } catch (e) {
      send({ id: m.id, error: e instanceof Error ? e.message : String(e) });
    }
  });
  send({ ready: true });
}

