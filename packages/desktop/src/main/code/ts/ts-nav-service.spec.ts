import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CodeFiles } from '../code-files.js';
import { WorkerTsRunner } from './ts-runner.js';
import { TsNavService } from './ts-nav-service.js';

const here = dirname(fileURLToPath(import.meta.url));
let dir = '';
let workerFile = '';
let libDir = '';
let service: TsNavService;
let runner: WorkerTsRunner;

const put = (rel: string, text: string): void => {
  const abs = join(dir, ...rel.split('/'));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
};
const at = (text: string, needle: string, nth = 0): { line: number; column: number } => {
  let idx = -1;
  for (let i = 0; i <= nth; i++) idx = text.indexOf(needle, idx + 1);
  const before = text.slice(0, idx);
  return { line: before.split('\n').length, column: idx - before.lastIndexOf('\n') };
};

const LIB = "export function greet(name: string): string {\n  return `hi ${name}`;\n}\nexport const SECRET_VALUE = 1;\n";
const MAIN = "import { greet } from './lib';\nimport { hidden } from './secret/data';\n\nconst a = greet('x');\nconst b = greet('y');\nconsole.log(a, b, hidden);\n";

beforeAll(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'rauha-tsnav-')));
  const built = buildSync({ entryPoints: [join(here, 'ts-worker.ts')], bundle: true, platform: 'node', format: 'cjs', minify: true, write: false, logLevel: 'silent' });
  const outDir = mkdtempSync(join(tmpdir(), 'rauha-tsworker-'));
  workerFile = join(outDir, 'ts-worker.cjs');
  writeFileSync(workerFile, built.outputFiles[0]?.text ?? '');
  libDir = dirname(createRequire(import.meta.url).resolve('typescript'));
  put('tsconfig.json', JSON.stringify({ compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', noEmit: true }, include: ['src/**/*', 'secret/**/*'] }));
  put('src/lib.ts', LIB);
  put('src/main.ts', MAIN.replace("'./secret/data'", "'../secret/data'").replace("'./lib'", "'./lib'"));
  put('secret/data.ts', 'export const hidden = 42;\n');
  put('notes.py', 'x = 1\n');
  put('.env', 'TOKEN=abc\n');
  runner = new WorkerTsRunner({ workerFile: () => workerFile, libDir: () => libDir });
  const files = new CodeFiles({ root: () => dir, isSecret: (rel) => rel.startsWith('secret/') || rel === '.env' });
  service = new TsNavService({ files, runner });
}, 60_000);
afterAll(() => {
  runner.stop();
  rmSync(dir, { recursive: true, force: true });
});

const MAIN_TEXT = "import { greet } from './lib';\nimport { hidden } from '../secret/data';\n\nconst a = greet('x');\nconst b = greet('y');\nconsole.log(a, b, hidden);\n";

describe('TypeScript 정의로 이동·참조·진단 (실제 worker)', () => {
  it('함수 이름의 정의 위치(다른 파일)를 돌려준다', async () => {
    const pos = at(MAIN_TEXT, 'greet', 2);
    const r = await service.definition({ path: 'src/main.ts', text: MAIN_TEXT, ...pos });
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.locations).toHaveLength(1);
    expect(r.locations[0]).toMatchObject({ path: 'src/lib.ts', line: 1 });
    expect(r.locations[0]?.preview).toContain('export function greet');
  }, 60_000);

  it('저장 전 글(디스크와 다른 글)의 위치도 맞게 본다', async () => {
    const edited = `// 한 줄 더\n${MAIN_TEXT}`;
    const pos = at(edited, 'greet', 2);
    const r = await service.definition({ path: 'src/main.ts', text: edited, ...pos });
    expect(r.ok && r.locations[0]?.path).toBe('src/lib.ts');
  }, 30_000);

  it('참조를 파일별로 묶어 돌려준다', async () => {
    const pos = at(MAIN_TEXT, 'greet', 2);
    const r = await service.references({ path: 'src/main.ts', text: MAIN_TEXT, ...pos });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const byPath = Object.fromEntries(r.files.map((f) => [f.path, f.hits.length]));
    expect(byPath['src/main.ts']).toBeGreaterThanOrEqual(3);
    expect(byPath['src/lib.ts']).toBe(1);
  }, 30_000);

  it('비밀 폴더 안 파일의 정의는 화면에 보내지 않는다', async () => {
    const pos = at(MAIN_TEXT, 'hidden', 1);
    const r = await service.definition({ path: 'src/main.ts', text: MAIN_TEXT, ...pos });
    expect(r).toEqual({ ok: true, locations: [] });
  }, 30_000);

  it('문법 오류와 타입 오류를 줄·칸과 함께 돌려준다', async () => {
    const bad = "const n: number = 'x';\nfoo(\n";
    const r = await service.diagnostics({ path: 'src/main.ts', text: bad, line: 1, column: 1 });
    expect(r).toMatchObject({ ok: true, semantic: true });
    if (!r.ok) return;
    const codes = r.items.map((i) => i.code);
    expect(codes).toContain(2322);
    expect(codes).toContain(1005);
    expect(r.items.every((i) => i.severity === 'error')).toBe(true);
    expect(r.items.find((i) => i.code === 2322)).toMatchObject({ line: 1, column: 7 });
  }, 30_000);

  it('깨끗한 파일은 진단이 비어 있다', async () => {
    const r = await service.diagnostics({ path: 'src/lib.ts', text: LIB, line: 1, column: 1 });
    expect(r).toMatchObject({ ok: true, items: [] });
  }, 30_000);

  it('TS/JS 가 아닌 파일은 unsupported 로 거절해 화면이 이름 검색으로 대신하게 한다', async () => {
    expect(await service.definition({ path: 'notes.py', text: 'x', line: 1, column: 1 })).toEqual({ ok: false, reason: 'unsupported' });
  });

  it('요청을 믿지 않는다: 경로 이탈·비밀 파일·잘못된 위치·너무 큰 글', async () => {
    expect(await service.definition({ path: '../x.ts', text: '', line: 1, column: 1 })).toEqual({ ok: false, reason: 'bad-path' });
    expect(await service.definition({ path: '/etc/x.ts', text: '', line: 1, column: 1 })).toEqual({ ok: false, reason: 'bad-path' });
    expect(await service.definition({ path: 'secret/data.ts', text: 'x', line: 1, column: 1 })).toEqual({ ok: false, reason: 'secret' });
    expect(await service.definition({ path: 'src/none.ts', text: 'x', line: 1, column: 1 })).toEqual({ ok: false, reason: 'missing' });
    expect(await service.definition({ path: 'src/lib.ts', text: 'x', line: 9, column: 1 })).toEqual({ ok: false, reason: 'bad-position' });
    expect(await service.definition({ path: 'src/lib.ts', text: 'x', line: 1.5, column: 1 })).toEqual({ ok: false, reason: 'bad-position' });
    expect(await service.diagnostics({ path: 'src/lib.ts', text: 'x'.repeat(1_100_000), line: 1, column: 1 })).toEqual({ ok: false, reason: 'too-big' });
    expect(await service.references(null)).toEqual({ ok: false, reason: 'bad-path' });
  });

  it('worker 파일이 없으면 unavailable 이다', async () => {
    const files = new CodeFiles({ root: () => dir, isSecret: () => false });
    const none = new TsNavService({ files, runner: new WorkerTsRunner({ workerFile: () => null, libDir: () => null }) });
    expect(await none.diagnostics({ path: 'src/lib.ts', text: LIB, line: 1, column: 1 })).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('시간이 넘으면 worker 를 끊고 timeout 을 알린 뒤 다음 요청에서 다시 띄운다', async () => {
    const quick = new WorkerTsRunner({ workerFile: () => workerFile, libDir: () => libDir }, { timeoutMs: 1, idleMs: 60_000 });
    const files = new CodeFiles({ root: () => dir, isSecret: () => false });
    const svc = new TsNavService({ files, runner: quick });
    expect(await svc.diagnostics({ path: 'src/lib.ts', text: LIB, line: 1, column: 1 })).toEqual({ ok: false, reason: 'timeout' });
    quick.stop();
  }, 30_000);
});
