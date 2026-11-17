import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { benchCopyDir, benchTable, freshSandbox, intakeTokensIn, type BenchRow } from './bench.js';

const row = (over: Partial<BenchRow>): BenchRow => ({
  id: 'discount',
  variant: 'ladder',
  result: '완료',
  attempts: 1,
  escalated: false,
  finalTier: 'sonnet',
  seconds: 70,
  sonnetTokens: 100_000,
  opusTokens: 25_000,
  costUsd: 0.03,
  firstTry: true,
  logDir: null,
  intakeTokens: 22_000,
  surveyTokens: 0,
  ...over,
});
const at = new Date('2026-10-25T06:00:00Z');

describe('bench 표', () => {
  it('비교 표는 요청마다 사다리와 opus 고정을 나란히 놓고 변형별 합계를 낸다', () => {
    const text = benchTable([row({}), row({ variant: 'opus', finalTier: 'opus', costUsd: 0.08 })], 'abc', at);
    expect(text).toContain('사다리');
    expect(text).toContain('opus 고정');
    const summaries = text.split('\n').filter((l) => /^(사다리|opus 고정):/.test(l));
    expect(summaries).toHaveLength(2);
    expect(summaries[1]).toContain('$0.080');
  });

  it('한 변형이 오류여도 표를 만든다', () => {
    const text = benchTable([row({}), row({ variant: 'opus', result: '오류', costUsd: 0, attempts: 0, firstTry: false })], 'abc', at);
    expect(text).toContain('오류');
    expect(text).toContain('$0.000');
  });

  it('승격된 실행은 표에 승격을 표시한다', () => {
    const text = benchTable([row({ escalated: true, attempts: 3, finalTier: 'opus' })], 'abc', at);
    expect(text.split('\n').find((l) => l.startsWith('discount'))).toContain('승격');
  });

  it('접수 토큰과 저장소 조사 토큰을 요청마다 보여 준다(저장소 지식 효과를 재려고)', () => {
    const text = benchTable([row({ intakeTokens: 12_000, surveyTokens: 30_000 })], 'abc', at);
    const lines = text.split('\n');
    expect(lines[1]).toContain('접수 토큰');
    expect(lines[1]).toContain('조사 토큰');
    expect(lines.find((l) => l.startsWith('discount'))).toMatch(/12k\s+30k/);
  });

  it('비교가 아니면 변형 열 없이 지금 모양을 쓴다', () => {
    const text = benchTable([row({})], 'abc', at);
    expect(text).not.toContain('opus 고정');
    expect(text).toContain('첫 시도 성공 1/1');
  });
});

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('실행 기록에서 접수 토큰 읽기', () => {
  it('접수 팀장 호출들의 입력·캐시·출력 토큰을 더하고, 기록이 없으면 0', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rauha-benchlog-'));
    dirs.push(dir);
    mkdirSync(join(dir, 'calls'));
    const usage = (input: number, cache: number, output: number) => JSON.stringify({ usage: { inputTokens: input, cacheReadTokens: cache, outputTokens: output } });
    writeFileSync(join(dir, 'calls', '01-intake-1.json'), usage(1000, 9000, 500));
    writeFileSync(join(dir, 'calls', '02-tester-1.json'), usage(5, 5, 5));
    writeFileSync(join(dir, 'calls', '03-intake-2.json'), usage(100, 0, 0));
    expect(await intakeTokensIn(dir)).toBe(10_600);
    expect(await intakeTokensIn(join(dir, 'none'))).toBe(0);
  });
});

describe('bench 연습용 복사본', () => {
  it('복사본은 rauha 저장소 밖(임시 폴더)에 둔다 — rauha의 CLAUDE.md를 물려받지 않게', () => {
    const dir = benchCopyDir('20261025-140000', 'discount').replace(/\\/g, '/');
    expect(dir.startsWith(tmpdir().replace(/\\/g, '/'))).toBe(true);
    expect(dir).toMatch(/rauha-bench\/20261025-140000\/discount$/);
  });

  it('새 복사본은 깨끗한 git 출발점이고 rauha의 node_modules를 연결해 쓴다', async () => {
    const work = mkdtempSync(join(tmpdir(), 'rauha-bench-spec-'));
    dirs.push(work);
    const source = join(work, 'src-project');
    const modules = join(work, 'modules');
    mkdirSync(source);
    mkdirSync(join(modules, 'fake-lib'), { recursive: true });
    writeFileSync(join(source, 'a.ts'), 'a');
    writeFileSync(join(source, '.gitignore'), 'node_modules/\n');
    writeFileSync(join(modules, 'fake-lib', 'index.js'), '');

    const target = join(work, 'copy');
    await freshSandbox(source, target, modules);

    expect(existsSync(join(target, 'node_modules', 'fake-lib', 'index.js'))).toBe(true);
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: target }).toString()).toBe('');
  });
});
