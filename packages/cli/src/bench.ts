import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DomainError, type Profile, type RunOutcome } from '@rauha/core';
import { noUser, refuseAll } from './ask.js';
import { runOnce } from './run.js';

interface BenchRequest {
  readonly id: string;
  readonly request: string;
}

/** ladder = 기본(sonnet부터 사다리), opus = 구현 팀원을 opus로 고정한 비교 실행 */
export type BenchVariant = 'ladder' | 'opus';

const VARIANT_LABEL: Readonly<Record<BenchVariant, string>> = { ladder: '사다리', opus: 'opus 고정' };
const VARIANT_ENV: Readonly<Record<BenchVariant, Readonly<Record<string, string>>>> = {
  ladder: {},
  opus: { RAUHA_ROLE_IMPLEMENTER: 'opus' },
};

export interface BenchRow {
  readonly id: string;
  readonly variant: BenchVariant;
  readonly result: string;
  readonly attempts: number;
  readonly escalated: boolean;
  readonly finalTier: string;
  readonly seconds: number;
  readonly sonnetTokens: number;
  readonly opusTokens: number;
  readonly costUsd: number;
  readonly firstTry: boolean;
  readonly logDir: string | null;
  /** 접수 팀장 호출들의 토큰(입력·캐시·출력). 저장소 지식이 접수를 얼마나 줄이는지 본다. */
  readonly intakeTokens: number;
  /** 저장소 지식 조사 팀원 토큰 */
  readonly surveyTokens: number;
  /** 근거가 확인되지 않은 채 남은 주장(구현 보고의 추측 + 근거 없는 리뷰 지적). 프롬프트가 추측을 줄이는지 본다. */
  readonly guesses: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

function stamp(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${pad(Math.round(seconds % 60))}`;
}

function tokens(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

/** 실행 기록(calls/*-intake-*.json)에서 접수 팀장 토큰을 더한다. 기록이 없으면 0. */
export async function intakeTokensIn(logDir: string): Promise<number> {
  let names: string[] = [];
  try {
    names = await readdir(join(logDir, 'calls'));
  } catch {
    return 0;
  }
  let total = 0;
  for (const name of names.filter((n) => /-intake-\d+\.json$/.test(n))) {
    const usage = (JSON.parse(await readFile(join(logDir, 'calls', name), 'utf8')) as { usage?: Record<string, number> }).usage ?? {};
    total += (usage['inputTokens'] ?? 0) + (usage['cacheReadTokens'] ?? 0) + (usage['outputTokens'] ?? 0);
  }
  return total;
}

function toRow(id: string, variant: BenchVariant, outcome: RunOutcome, intakeTokens: number, surveyTokens: number): BenchRow {
  return {
    id,
    variant,
    result: outcome.status === 'complete' ? '완료' : `멈춤(${outcome.stopReason})`,
    attempts: outcome.implementerAttempts,
    escalated: outcome.escalated,
    finalTier: outcome.finalTier ?? '-',
    seconds: outcome.durationMs / 1000,
    sonnetTokens: outcome.usage.sonnet.tokens,
    opusTokens: outcome.usage.opus.tokens,
    costUsd: outcome.costUsd,
    firstTry: outcome.status === 'complete' && outcome.implementerAttempts === 1,
    logDir: outcome.logDir,
    intakeTokens,
    surveyTokens,
    guesses: outcome.facts.checked.filter((c) => c.isGuess).length + outcome.facts.reviewerGuesses.length,
  };
}

/**
 * 복사본 위치. rauha 저장소 안에 두면 팀원이 상위 폴더의 rauha CLAUDE.md(rauha 자체 개발 규칙)를
 * 물려받아 "기존 구조를 따르는가" 측정이 흐려지므로, 저장소 밖 임시 폴더에 둔다.
 */
export function benchCopyDir(stamp: string, id: string): string {
  return join(tmpdir(), 'rauha-bench', stamp, id);
}

/**
 * 연습용 프로젝트를 새로 복사해 git 출발점을 만든다. rauha가 커밋하는 유일한 곳(임시 복사본)이다.
 * 의존성(vitest, typescript)은 rauha의 node_modules를 junction으로 연결해 쓴다.
 */
export async function freshSandbox(source: string, target: string, nodeModules: string): Promise<void> {
  await cp(source, target, { recursive: true, filter: (src) => !src.includes('node_modules') });
  await symlink(nodeModules, join(target, 'node_modules'), 'junction');
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=rauha-bench', '-c', 'user.email=bench@rauha.local', ...args], { cwd: target, stdio: 'ignore' });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-qm', 'bench start');
}

/** --same-repo: 다음 요청이 깨끗한 작업 트리에서 시작하도록 bench 복사본에 커밋한다. */
function commitAll(copy: string, id: string): void {
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=rauha-bench', '-c', 'user.email=bench@rauha.local', ...args], { cwd: copy, stdio: 'ignore' });
  git('add', '-A');
  try {
    git('commit', '-qm', `bench: ${id}`);
  } catch {
    // 바뀐 게 없으면 커밋할 것도 없다.
  }
}

function summary(rows: readonly BenchRow[]): string {
  const done = rows.filter((r) => r.result === '완료');
  const avg = rows.length > 0 ? rows.reduce((n, r) => n + r.seconds, 0) / rows.length : 0;
  const total = rows.reduce((n, r) => n + r.costUsd, 0);
  const escalated = rows.filter((r) => r.escalated).length;
  const guesses = rows.reduce((n, r) => n + r.guesses, 0);
  return `첫 시도 성공 ${rows.filter((r) => r.firstTry).length}/${rows.length} · 완료 ${done.length}/${rows.length} · 승격 ${escalated} · 추측 ${guesses} · 평균 ${clock(avg)} · 합계 $${total.toFixed(3)}`;
}

/** 결과 표. opus 고정 행이 있으면 비교 표로 그리고, 변형별 합계 줄을 따로 낸다. */
export function benchTable(rows: readonly BenchRow[], promptHash: string, startedAt: Date): string {
  const compare = rows.some((r) => r.variant === 'opus');
  const head = ['요청', ...(compare ? ['변형'] : []), '결과', '시도', '승격', '추측', '시간', 'sonnet 토큰', 'opus 토큰', '접수 토큰', '조사 토큰', '추정 비용'];
  const body = rows.map((r) => [
    r.id,
    ...(compare ? [VARIANT_LABEL[r.variant]] : []),
    r.result,
    String(r.attempts),
    r.escalated ? '승격' : '-',
    String(r.guesses),
    clock(r.seconds),
    tokens(r.sonnetTokens),
    tokens(r.opusTokens),
    tokens(r.intakeTokens),
    tokens(r.surveyTokens),
    `$${r.costUsd.toFixed(3)}`,
  ]);
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((b) => (b[i] as string).length)));
  const line = (cells: readonly string[]) => cells.map((c, i) => c.padEnd(widths[i] as number)).join('  ');
  const totals = compare
    ? (['ladder', 'opus'] as const).map((v) => `${VARIANT_LABEL[v]}: ${summary(rows.filter((r) => r.variant === v))}`)
    : [summary(rows)];
  return [`프롬프트 ${promptHash} · ${startedAt.toISOString().slice(0, 16).replace('T', ' ')}`, line(head), ...body.map(line), ...totals].join('\n');
}

/** 고정 요청 묶음을 매번 새 복사본에서 돌려 프롬프트 버전끼리 비교한다. */
export async function runBench(props: {
  repoRoot: string;
  profile: Profile;
  home: string;
  only: string | null;
  /** 요청마다 사다리와 opus 고정을 한 번씩 돌려 비교한다 */
  compare: boolean;
  /** 리뷰·사실 점검 없이 돌린다(1단계 숫자와 비교용) */
  quick: boolean;
  /** 요청을 연습 저장소 하나에서 이어서 돌린다. 요청 사이에 bench가 커밋한다(bench 복사본은 rauha가 커밋하는 유일한 곳). */
  sameRepo: boolean;
  log: (line: string) => void;
}): Promise<string> {
  const sandbox = join(props.repoRoot, 'examples', 'sandbox');
  const requestsFile = join(props.repoRoot, 'examples', 'bench', 'requests.json');
  if (!existsSync(sandbox) || !existsSync(requestsFile)) {
    throw new DomainError('NO_BENCH', 'examples/sandbox 와 examples/bench/requests.json 이 있는 rauha 저장소 루트에서 실행하세요.');
  }
  const all = JSON.parse(await readFile(requestsFile, 'utf8')) as BenchRequest[];
  const requests = props.only === null ? all : all.filter((r) => r.id === props.only);
  if (requests.length === 0) throw new DomainError('NO_BENCH', `요청 id를 찾지 못했습니다: ${props.only}`);

  const startedAt = new Date();
  const benchDir = join(props.repoRoot, '.rauha', 'bench', stamp(startedAt));
  await mkdir(benchDir, { recursive: true });
  const rows: BenchRow[] = [];
  let promptHash = '';

  const variants: readonly BenchVariant[] = props.compare ? ['ladder', 'opus'] : ['ladder'];
  let limited = false;
  for (const req of requests) {
    for (const variant of variants) {
      // 구독 한도에 걸린 뒤의 실행은 전부 같은 오류라 측정이 되지 않는다.
      if (limited) continue;
      const copy = props.sameRepo ? benchCopyDir(stamp(startedAt), 'same-repo') : benchCopyDir(stamp(startedAt), props.compare ? `${req.id}-${variant}` : req.id);
      if (!props.sameRepo || !existsSync(copy)) await freshSandbox(sandbox, copy, join(props.repoRoot, 'node_modules'));
      props.log(`── ${req.id}${props.compare ? ` [${VARIANT_LABEL[variant]}]` : ''}: ${req.request}`);
      try {
        const { outcome, promptHash: hash, knowledgeTokens } = await runOnce(req.request, {
          root: copy,
          profile: props.profile,
          home: props.home,
          ask: refuseAll(props.log),
          user: noUser,
          progress: { step: (m) => props.log(`   ${m}`) },
          requireClean: true,
          roleEnv: VARIANT_ENV[variant],
          threePass: !props.quick,
        });
        promptHash = hash;
        rows.push(toRow(req.id, variant, outcome, await intakeTokensIn(outcome.logDir), knowledgeTokens));
        if (props.sameRepo) commitAll(copy, req.id);
        props.log(`   → ${outcome.status === 'complete' ? '완료' : `멈춤(${outcome.stopReason})`} · ${outcome.logDir}`);
        if (outcome.stopReason === 'usage-limit' || outcome.stopReason === 'login-required') {
          limited = true;
          props.log(`   → ${outcome.stopReason === 'usage-limit' ? '구독 사용 한도에 걸려' : '로그인이 필요해서'} 남은 요청은 돌리지 않습니다.`);
        }
      } catch (error) {
        props.log(`   → 오류: ${(error as Error).message}`);
        rows.push({
          id: req.id,
          variant,
          result: '오류',
          attempts: 0,
          escalated: false,
          finalTier: '-',
          seconds: 0,
          sonnetTokens: 0,
          opusTokens: 0,
          costUsd: 0,
          firstTry: false,
          logDir: null,
          intakeTokens: 0,
          surveyTokens: 0,
          guesses: 0,
        });
      }
    }
  }

  const report = benchTable(rows, promptHash, startedAt);
  await writeFile(join(benchDir, 'bench.md'), `\`\`\`\n${report}\n\`\`\`\n`, 'utf8');
  await writeFile(join(benchDir, 'bench.json'), `${JSON.stringify({ promptHash, rows }, null, 2)}\n`, 'utf8');
  return `${report}\n\n저장: ${benchDir}`;
}
