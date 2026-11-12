import type { SourceFile } from './api-extract.js';

/**
 * AI API 시험에서 모델에게 보여 줄 코드 고르기(파일을 읽지 않고 이미 읽은 글에서 고른다).
 * 컨트롤러 파일 → 그 파일이 가져오는 것(서비스·DTO·가드…) → 서비스가 가져오는 엔티티·저장소 → 전역 설정(검증 파이프·예외 처리).
 * 모델 호출 한 번에 필요한 근거를 다 담으려고 도구 없이 글로 넘긴다.
 */

export const CONTEXT_LIMIT = 14;

const DEEP_RE = /(service|entity|repository|model|schema|exception|error|guard|policy|pipe|validator|dto|request)/i;
const GLOBAL_RE = /NestFactory\.create|useGlobalPipes|useGlobalFilters|useGlobalGuards|APP_GUARD|APP_PIPE|APP_FILTER|@Catch\s*\(|@(Rest)?ControllerAdvice\b|SecurityFilterChain|app\.use\(\s*(?:errorHandler|\w*[Ee]rror\w*)/;

const dirOf = (p: string): string => p.slice(0, p.lastIndexOf('/') + 1);

function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

/** TS·JS 상대 import 를 실제 파일로 */
function relativeImports(file: SourceFile, byPath: ReadonlyMap<string, SourceFile>): SourceFile[] {
  const out: SourceFile[] = [];
  for (const m of file.text.matchAll(/(?:from\s*|require\(\s*|import\(\s*)(['"])(\.{1,2}\/[^'"]+)\1/g)) {
    const base = normalize(dirOf(file.path) + (m[2] as string)).replace(/\.(js|mjs|cjs)$/, '');
    for (const cand of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.mjs`, `${base}.cjs`, `${base}/index.ts`, `${base}/index.js`]) {
      const hit = byPath.get(cand);
      if (hit !== undefined) {
        out.push(hit);
        break;
      }
    }
  }
  return out;
}

/** Java·Kotlin: 글에 나오는 클래스 이름과 같은 이름의 파일(+ 인터페이스의 Impl) */
function referencedClasses(file: SourceFile, byClass: ReadonlyMap<string, SourceFile>): SourceFile[] {
  const out: SourceFile[] = [];
  for (const name of new Set([...file.text.matchAll(/\b([A-Z]\w+)\b/g)].map((m) => m[1] as string))) {
    for (const n of [name, `${name}Impl`]) {
      const hit = byClass.get(n);
      if (hit !== undefined && hit !== file) out.push(hit);
    }
  }
  return out;
}

export function pickContextFiles(controllerPath: string, files: readonly SourceFile[]): SourceFile[] {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const start = byPath.get(controllerPath);
  if (start === undefined) return [];
  const jvm = /\.(java|kt)$/.test(controllerPath);
  const byClass = new Map(files.filter((f) => /\.(java|kt)$/.test(f.path)).map((f) => [(f.path.split('/').pop() ?? '').replace(/\.(java|kt)$/, ''), f]));
  const next = (f: SourceFile): SourceFile[] => (jvm ? referencedClasses(f, byClass) : relativeImports(f, byPath));
  const picked: SourceFile[] = [start];
  const add = (f: SourceFile): void => {
    if (!picked.includes(f) && picked.length < CONTEXT_LIMIT) picked.push(f);
  };
  const first = next(start).filter((f) => !/controller/i.test(f.path) || f === start);
  for (const f of first) add(f);
  for (const f of first) if (DEEP_RE.test(f.path)) for (const g of next(f)) if (DEEP_RE.test(g.path) && !/controller/i.test(g.path)) add(g);
  for (const f of files) if (GLOBAL_RE.test(f.text) && !/controller/i.test(f.path.split('/').pop() ?? '')) add(f);
  return picked;
}
