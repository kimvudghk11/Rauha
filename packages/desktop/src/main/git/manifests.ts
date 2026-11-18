import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Manifest, WorkspaceRepo } from '@rauha/core';
import { runGit } from './git-run.js';

type Dep = Manifest['deps'][number];

/** 저장소 하나에서 읽는 의존성 파일 수 상한(모노레포 패키지까지) */
const MAX_FILES = 30;
const MAX_BYTES = 512 * 1024;
const NAMES = /(^|\/)(package\.json|go\.mod|requirements[\w.-]*\.txt|build\.gradle(\.kts)?|pom\.xml)$/;

/** package.json: dependencies·peerDependencies·optionalDependencies 는 런타임, devDependencies 는 개발용 */
export function parsePackageJson(text: string): Dep[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return [];
  }
  if (typeof json !== 'object' || json === null) return [];
  const o = json as Record<string, unknown>;
  const pick = (key: string, dev: boolean): Dep[] => {
    const v = o[key];
    if (typeof v !== 'object' || v === null) return [];
    return Object.entries(v as Record<string, unknown>).flatMap(([name, version]) => (typeof version === 'string' ? [{ name, version, dev }] : []));
  };
  return [...pick('dependencies', false), ...pick('peerDependencies', false), ...pick('optionalDependencies', false), ...pick('devDependencies', true)];
}

/** go.mod 의 require(한 줄·묶음 모두). // indirect 도 남긴다 */
export function parseGoMod(text: string): Dep[] {
  const deps: Dep[] = [];
  let inBlock = false;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\/\/(?!\s*indirect).*$/, '').trim();
    if (/^require\s*\($/.test(line)) inBlock = true;
    else if (inBlock && line === ')') inBlock = false;
    else {
      const m = (inBlock ? /^(\S+)\s+(\S+)/ : /^require\s+(\S+)\s+(\S+)/).exec(line);
      if (m !== null) deps.push({ name: m[1]!, version: m[2]!, dev: false });
    }
  }
  return deps;
}

/** requirements.txt: 이름과 버전 조건(==, >=, ~= …). 주석·옵션 줄은 뺀다 */
export function parseRequirements(text: string, dev: boolean): Dep[] {
  return text.split('\n').flatMap((raw) => {
    const line = raw.replace(/#.*$/, '').trim();
    if (line === '' || line.startsWith('-')) return [];
    const m = /^([A-Za-z0-9_.\-[\]]+)\s*(.*)$/.exec(line);
    return m === null ? [] : [{ name: m[1]!, version: m[2]!.trim() || '(버전 없음)', dev }];
  });
}

/** build.gradle(.kts): implementation·api·testImplementation … 'group:name:version' 꼴만 */
export function parseGradle(text: string): Dep[] {
  const deps: Dep[] = [];
  const re = /\b(\w+)\s*\(?\s*["']([\w.\-]+):([\w.\-]+):([^"']+)["']/g;
  for (const m of text.matchAll(re)) {
    const conf = m[1]!;
    if (!/implementation|api|compile|runtime|kapt|annotationProcessor/i.test(conf)) continue;
    deps.push({ name: `${m[2]}:${m[3]}`, version: m[4]!, dev: /^test/i.test(conf) });
  }
  return deps;
}

/** pom.xml 의 <dependency> 묶음(groupId·artifactId·version·scope test 면 개발용) */
export function parsePom(text: string): Dep[] {
  const deps: Dep[] = [];
  for (const m of text.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
    const body = m[1]!;
    const tag = (t: string): string | null => new RegExp(`<${t}>\\s*([^<]+?)\\s*</${t}>`).exec(body)?.[1] ?? null;
    const group = tag('groupId');
    const artifact = tag('artifactId');
    if (group === null || artifact === null) continue;
    deps.push({ name: `${group}:${artifact}`, version: tag('version') ?? '(버전 관리 위임)', dev: tag('scope') === 'test' });
  }
  return deps;
}

function parse(path: string, text: string): { kind: string; deps: Dep[] } | null {
  const base = path.split('/').pop() ?? path;
  if (base === 'package.json') return { kind: 'npm', deps: parsePackageJson(text) };
  if (base === 'go.mod') return { kind: 'go', deps: parseGoMod(text) };
  if (base.startsWith('requirements')) return { kind: 'pip', deps: parseRequirements(text, /dev|test/i.test(base)) };
  if (base.startsWith('build.gradle')) return { kind: 'gradle', deps: parseGradle(text) };
  if (base === 'pom.xml') return { kind: 'maven', deps: parsePom(text) };
  return null;
}

/** 저장소마다 git 이 추적하는 의존성 파일을 찾아 읽는다(node_modules 같은 추적 안 하는 곳은 자연히 빠진다). 읽기만 한다. */
export async function dependencyManifests(repos: readonly WorkspaceRepo[]): Promise<Manifest[]> {
  const per = await Promise.all(
    repos.map(async (repo): Promise<Manifest[]> => {
      const listed = await runGit(repo.root, ['ls-files', '-z']).catch(() => null);
      if (listed === null || listed.code !== 0) return [];
      const files = listed.stdout.split('\0').filter((f) => NAMES.test(f)).sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b)).slice(0, MAX_FILES);
      const read = await Promise.all(
        files.map(async (path): Promise<Manifest | null> => {
          const text = await readFile(join(repo.root, path), 'utf8').catch(() => null);
          if (text === null || text.length > MAX_BYTES) return null;
          const got = parse(path, text);
          return got === null || got.deps.length === 0 ? null : { repo: repo.name, path, ...got };
        }),
      );
      return read.filter((m): m is Manifest => m !== null);
    }),
  );
  return per.flat();
}
