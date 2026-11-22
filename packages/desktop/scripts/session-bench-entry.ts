/**
 * 실제 모델로 "요청 하나에 세션을 몇 % 쓰나"를 잰다. 앱과 같은 세션 구성(composeSession)으로,
 * 한 대화 안에서 차례로 묻고(앱처럼 차례마다 저장된 대화로 세션을 되살린다) 차례마다 앞뒤 세션 사용률을 읽는다.
 * 기준 레포는 주어진 레포를 임시 폴더에 복제한 것(진짜 레포의 기억·지식·대화에 섞이지 않게). 파일을 쓰는 요청은 넣지 않는다.
 * 쓰는 법: node packages/desktop/scripts/session-bench.mjs <레포 폴더> [차례 id …]
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { PromptLibrary, readPlanUsage, type TurnOutcome } from '@rauha/core';
import { composeSession, profileResolver } from '../src/main/team/compose.js';

interface Turn {
  readonly id: string;
  readonly text: string;
  readonly depth?: 'deep';
}

/** 사용자가 세션을 많이 쓴다고 했던 종류들(같은 대화 안에서 차례로) */
const TURNS: readonly Turn[] = [
  { id: 'hello', text: 'ㅎㅇ' },
  { id: 'light', text: 'REST랑 GraphQL 차이가 뭐야?' },
  { id: 'deep', text: 'ChatSession 클래스는 어디서 만들어지고 누가 handle 을 불러?' },
  { id: 'follow', text: '그럼 그 클래스 테스트 파일은 어디 있고 몇 개 정도야?' },
  { id: 'deeper', text: '그럼 그 클래스 테스트 파일은 어디 있고 몇 개 정도야?', depth: 'deep' },
  { id: 'arch', text: '이 레포 패키지들(core·cli·desktop)을 모노레포로 계속 갈지, 레포를 나눌지 어떻게 구성하는 게 좋을까?' },
];

const usageEnv = (): Record<string, string> => Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && e[0] !== 'ELECTRON_RUN_AS_NODE' && !e[0].startsWith('CLAUDECODE')));

async function percent(): Promise<number | null> {
  // 막 끝난 호출이 한도에 반영되도록 잠깐 기다렸다 읽는다
  await new Promise((r) => setTimeout(r, 4000));
  return (await readPlanUsage(usageEnv()).catch(() => null))?.session?.percent ?? null;
}

async function main(): Promise<void> {
  const [, , repoArg, ...only] = process.argv;
  if (repoArg === undefined) throw new Error('레포 폴더를 주세요');
  const home = homedir();
  const keyRoot = join(mkdtempSync(join(tmpdir(), 'rauha-bench-')), basename(repoArg));
  execFileSync('git', ['clone', '-q', '--depth', '50', repoArg, keyRoot]);
  const prompts = await PromptLibrary.load(join(__dirname, '..', '..', '..', 'prompts'));
  const profileFor = await profileResolver(home, null);
  const picked = only.length > 0 ? TURNS.filter((t) => only.includes(t.id)) : TURNS;
  const rows: string[] = [];
  const out = join(tmpdir(), 'rauha-bench', new Date().toISOString().replace(/[:.]/g, '-'));
  mkdirSync(out, { recursive: true });
  const steps: string[] = [];
  // 앱처럼 차례(일)마다 팀 세션을 새로 만든다: 끝나면 기억 DB 를 닫고, 앞 대화는 저장된 대화 파일로 이어진다
  const fresh = () =>
    composeSession(
      { home, prompts, profileFor, plan: () => null },
      keyRoot,
      {
        progress: { step: (line: string) => void steps.push(line) } as never,
        ask: async () => ({ kind: 'deny', note: 'bench: 묻는 동작은 하지 않는다' }),
        user: { interactive: false, choose: async () => 0, confirmFact: async () => ({ kind: 'unsure' }), pickPast: async () => null } as never,
        signal: new AbortController().signal,
      },
      keyRoot,
    );
  let before = await percent();
  for (const t of picked) {
    steps.length = 0;
    const session = fresh();
    const started = Date.now();
    let outcome: TurnOutcome | null = null;
    let error = '';
    try {
      outcome = await session.handle(t.text, t.depth);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const seconds = Math.round((Date.now() - started) / 1000);
    const after = await percent();
    const spent = before === null || after === null ? '모름' : `${Math.max(0, after - before)}%`;
    const answer = outcome === null ? error : outcome.kind === 'answer' ? outcome.answer : outcome.kind === 'notice' ? outcome.message : JSON.stringify(outcome).slice(0, 3000);
    const tools = outcome !== null && 'tools' in outcome && Array.isArray((outcome as { tools?: unknown }).tools) ? (outcome as { tools: { name: string; count: number }[] }).tools.map((x) => `${x.name}×${x.count}`).join(' ') : '';
    const calls = steps.filter((s) => s.includes('작업 중')).length;
    rows.push(`| ${t.id} | ${spent} | ${seconds}s | ${outcome?.kind ?? 'error'} | ${calls} | ${tools} |`);
    writeFileSync(join(out, `${t.id}.md`), `# ${t.text}\n\n세션 ${spent} · ${seconds}s · ${outcome?.kind ?? 'error'} · 도구 ${tools}\n\n## 진행\n${steps.map((l) => `- ${l}`).join('\n')}\n\n## 답\n${answer}\n`);
    console.log(rows.at(-1));
    before = after;
  }
  const table = ['| 차례 | 세션 | 시간 | 종류 | 팀원 호출 | 도구 |', '| --- | --- | --- | --- | --- | --- |', ...rows].join('\n');
  writeFileSync(join(out, 'README.md'), `# 세션 사용 재기 (${basename(repoArg)})\n\n${table}\n`);
  console.log(`\n${table}\n\n기록: ${out}`);
}

void main().then(
  () => process.exit(0),
  (e: unknown) => {
    console.error(e);
    process.exit(1);
  },
);
