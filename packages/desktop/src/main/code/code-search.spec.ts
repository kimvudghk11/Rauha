import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSync } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SearchResult } from '../../shared/code-api.js';
import { InlineSearchRunner, WorkerSearchRunner, type SearchRunner } from './search-runner.js';
import { MAX_HITS_PER_FILE, MAX_TOTAL_HITS, searchWorkspace } from './code-search.js';

let root = '';
let workerSource = '';

const base = { query: 'needle', caseSensitive: false, regex: false };
const put = (rel: string, text: string | Buffer): void => {
  const abs = join(root, ...rel.split('/'));
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, text);
};
const isSecret = (rel: string): boolean => /(^|\/)\.env/.test(rel) || rel.endsWith('.pem');
const ok = (r: SearchResult): Extract<SearchResult, { ok: true }> => {
  if (!r.ok) throw new Error(`failed: ${r.reason}`);
  return r;
};
const paths = (r: SearchResult): string[] => ok(r).files.map((f) => f.path);

const roots: string[] = [];
const freshRoot = (): void => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'rauha-search-')));
  roots.push(root);
};

beforeAll(() => {
  freshRoot();
  // 실제 앱 빌드와 같은 방식으로 worker 코드를 묶는다
  const built = buildSync({ entryPoints: [join(__dirname, 'search-worker.ts')], bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' });
  workerSource = built.outputFiles[0]?.text ?? '';
});
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

const runners: [string, () => SearchRunner][] = [
  ['worker', () => new WorkerSearchRunner(() => workerSource)],
  ['inline', () => new InlineSearchRunner()],
];

describe.each(runners)('프로젝트 전체 검색 (%s)', (_name, make) => {
  beforeAll(freshRoot);

  it('파일별로 묶어 줄 번호와 미리보기를 돌려준다', async () => {
    put('a/one.ts', 'x\nconst Needle = 1;\n');
    put('b/two.md', 'a needle here\n');
    const r = ok(await searchWorkspace(root, base, isSecret, make()));
    expect(r.files.map((f) => f.path)).toEqual(['a/one.ts', 'b/two.md']);
    expect(r.files[0]?.hits[0]).toMatchObject({ line: 2 });
    expect(r.stopped).toBeNull();
  });

  it('비밀 파일·node_modules·.git·생성물·압축본은 찾지 않는다', async () => {
    put('.env', 'needle=1');
    put('keys/a.pem', 'needle');
    put('node_modules/pkg/i.js', 'needle');
    put('.git/config', 'needle');
    put('dist/out.js', 'needle');
    put('web/app.min.js', 'needle');
    put('package-lock.json', 'needle');
    const found = paths(await searchWorkspace(root, base, isSecret, make()));
    expect(found).toEqual(['a/one.ts', 'b/two.md']);
  });

  it('바로가기는 따라가지 않는다', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'rauha-outside-'));
    writeFileSync(join(outside, 'x.txt'), 'needle outside');
    try {
      symlinkSync(outside, join(root, 'linkdir'), 'junction');
      symlinkSync(join(outside, 'x.txt'), join(root, 'link.txt'), 'file');
    } catch {
      // 바로가기를 못 만드는 환경(권한 없는 윈도우)이면 이 시험은 의미가 없다
      rmSync(outside, { recursive: true, force: true });
      return;
    }
    const found = paths(await searchWorkspace(root, base, isSecret, make()));
    expect(found.some((p) => p.startsWith('linkdir') || p === 'link.txt')).toBe(false);
    rmSync(join(root, 'linkdir'), { force: true, recursive: true });
    rmSync(join(root, 'link.txt'), { force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it('포함 글롭으로 좁히고 제외 글롭으로 뺀다', async () => {
    expect(paths(await searchWorkspace(root, { ...base, include: '*.md' }, isSecret, make()))).toEqual(['b/two.md']);
    expect(paths(await searchWorkspace(root, { ...base, exclude: 'b' }, isSecret, make()))).toEqual(['a/one.ts']);
    expect(paths(await searchWorkspace(root, { ...base, include: 'a/**, b/**', exclude: '*.md' }, isSecret, make()))).toEqual(['a/one.ts']);
  });

  it('잘못된 글롭·정규식·빈 검색어는 까닭을 돌려준다', async () => {
    expect(await searchWorkspace(root, { ...base, include: '../x' }, isSecret, make())).toEqual({ ok: false, reason: 'bad-glob' });
    expect(await searchWorkspace(root, { ...base, query: '(', regex: true }, isSecret, make())).toEqual({ ok: false, reason: 'bad-regex' });
    expect(await searchWorkspace(root, { ...base, query: '' }, isSecret, make())).toEqual({ ok: false, reason: 'empty' });
    expect(await searchWorkspace(root, { query: 1 }, isSecret, make())).toEqual({ ok: false, reason: 'bad-path' });
  });

  it('단어 단위를 켜면 단어의 일부는 건너뛴다', async () => {
    put('w/word.txt', 'needles\nneedle_x\nthe needle.\n');
    const r = ok(await searchWorkspace(root, { ...base, wholeWord: true, include: 'w' }, isSecret, make()));
    expect(r.files[0]?.hits.map((h) => h.line)).toEqual([3]);
  });

  it('큰 파일·바이너리는 건너뛰고 건너뛴 수를 센다', async () => {
    put('big/huge.txt', `needle\n${'x'.repeat(1_100_000)}`);
    put('big/bin.dat', Buffer.from([0x6e, 0x65, 0x65, 0x64, 0x6c, 0x65, 0, 0, 1, 2]));
    const r = ok(await searchWorkspace(root, { ...base, include: 'big' }, isSecret, make()));
    expect(r.files).toEqual([]);
    expect(r.skipped).toBe(2);
  });

  it('파일당 상한을 넘기면 잘렸다고 알린다', async () => {
    put('many/lots.txt', 'needle\n'.repeat(MAX_HITS_PER_FILE + 50));
    const r = ok(await searchWorkspace(root, { ...base, include: 'many' }, isSecret, make()));
    expect(r.files[0]?.hits).toHaveLength(MAX_HITS_PER_FILE);
    expect(r.truncated).toBe(true);
    expect(r.stopped).toBe('limit');
  });

  it('전체 상한(2000건)과 파일당 상한(200건)이다', () => {
    expect(MAX_TOTAL_HITS).toBe(2000);
    expect(MAX_HITS_PER_FILE).toBe(200);
  });
});

describe('전체 검색의 시간·취소 보호 (worker)', () => {
  beforeAll(freshRoot);

  it('끝나지 않는 정규식(ReDoS)은 worker 째 끊고 그때까지의 결과를 돌려준다', async () => {
    put('redos/a.txt', `${'a'.repeat(40)}!\n`);
    const runner = new WorkerSearchRunner(() => workerSource, { deadlineMs: 6000, stallMs: 600 });
    const started = Date.now();
    const r = ok(await searchWorkspace(root, { query: '(a+)+$', caseSensitive: false, regex: true, include: 'redos' }, isSecret, runner));
    expect(Date.now() - started).toBeLessThan(5000);
    expect(r.stopped).toBe('stalled');
    expect(r.truncated).toBe(true);
  }, 15_000);

  it('id 로 취소하면 멈추고 cancelled 로 알린다', async () => {
    put('slow/a.txt', `${'a'.repeat(40)}!\n`);
    const runner = new WorkerSearchRunner(() => workerSource, { deadlineMs: 8000, stallMs: 8000 });
    const pending = searchWorkspace(root, { query: '(a+)+$', caseSensitive: false, regex: true, include: 'slow', id: 'job-1' }, isSecret, runner);
    await new Promise((r) => setTimeout(r, 300));
    expect(runner.cancel('job-1')).toBe(true);
    const r = ok(await pending);
    expect(r.stopped).toBe('cancelled');
    expect(runner.cancel('job-1')).toBe(false);
  }, 15_000);
});
