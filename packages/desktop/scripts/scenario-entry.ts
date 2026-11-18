/**
 * 실제 모델 시나리오: 앱과 같은 세션 구성(composeSession)으로 사용자가 실제로 했던 요청을 돌리고,
 * 결과 종류·쓴 도구·"안 본 곳"이 보였는지·걸린 시간을 표로 남긴다. 파일을 쓰는 요청은 넣지 않는다.
 * 쓰는 법: node packages/desktop/scripts/scenario.mjs [작업 공간 폴더] [시나리오 id …]
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { discoverRepos, PromptLibrary, type TurnOutcome } from '@rauha/core';
import { composeSession, profileResolver } from '../src/main/team/compose.js';

interface Scenario {
  readonly id: string;
  readonly text: string;
  /** 기대하는 결과 종류(answer·work·analysis…) */
  readonly expect: string;
}

/** 사용자가 실제로 했던 말(코드·파일을 바꾸지 않는 것만) */
const SCENARIOS: readonly Scenario[] = [
  { id: 'all-repos-changes', text: '모든 레포 체인지로그랑 커밋 다 봐줘', expect: 'answer' },
  { id: 'unpushed', text: '어느 레포에 push 안 한 거 있어?', expect: 'answer' },
  { id: 'search', text: '모든 레포에서 TODO 주석 어디 있는지 찾아줘', expect: 'answer' },
  { id: 'deps', text: '레포들 중에 vitest 쓰는 곳이랑 버전 알려줘', expect: 'answer' },
  { id: 'pm', text: '다음 2주 로드맵 우선순위 정해줘', expect: 'answer' },
  { id: 'finops', text: 'AWS 인프라 비용 얼마 나오는지 계산해줘', expect: 'answer' },
  { id: 'standup', text: '스탠드업 정리해줘', expect: 'answer' },
];

const now = () => Date.now();

async function main(): Promise<void> {
  const [, , folderArg, ...only] = process.argv;
  const workspace = folderArg ?? process.cwd();
  const home = homedir();
  const repos = discoverRepos(workspace).map((root) => ({ name: basename(root), root }));
  // 세션의 기준 레포는 임시 레포로: 시나리오 답이 실제 레포의 rauha 기억·지식에 섞이지 않게(팀원은 도구로 작업 공간 전체를 읽는다)
  const keyRoot = mkdtempSync(join(tmpdir(), 'rauha-scenario-'));
  execFileSync('git', ['init', '-q'], { cwd: keyRoot });
  const prompts = await PromptLibrary.load(join(__dirname, '..', '..', '..', 'prompts'));
  const profileFor = await profileResolver(home, null);
  const picked = only.length > 0 ? SCENARIOS.filter((s) => only.includes(s.id)) : SCENARIOS;
  const rows: string[] = [];
  const out = join(tmpdir(), 'rauha-scenarios', new Date().toISOString().replace(/[:.]/g, '-'));
  mkdirSync(out, { recursive: true });
  for (const s of picked) {
    const steps: string[] = [];
    const controller = new AbortController();
    const session = composeSession(
      { home, prompts, profileFor, plan: () => null },
      keyRoot,
      {
        progress: { step: (line: string) => void steps.push(line) } as never,
        ask: async () => ({ kind: 'deny', note: 'scenario: 묻는 동작은 하지 않는다' }),
        user: { interactive: false, choose: async () => 0, confirmFact: async () => ({ kind: 'unsure' }), pickPast: async () => null } as never,
        signal: controller.signal,
      },
      keyRoot,
      { workspaceRoot: workspace, repos, also: [] },
    );
    const started = now();
    let outcome: TurnOutcome | null = null;
    let error = '';
    try {
      outcome = await session.handle(s.text);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const seconds = Math.round((now() - started) / 1000);
    const answer = outcome === null ? error : outcome.kind === 'answer' ? outcome.answer : outcome.kind === 'notice' ? outcome.message : JSON.stringify(outcome).slice(0, 4000);
    const tools = outcome !== null && 'tools' in outcome && Array.isArray((outcome as { tools?: unknown }).tools) ? ((outcome as { tools: { name: string; count: number }[] }).tools.map((t) => `${t.name}×${t.count}`).join(' ')) : '';
    const unseen = /■ 안 본 곳/.test(answer);
    const ok = outcome?.kind === s.expect && !unseen;
    rows.push(`| ${ok ? 'OK' : 'XX'} | ${s.id} | ${outcome?.kind ?? 'error'} | ${seconds}s | ${unseen ? '있음' : '없음'} | ${tools.replace(/\|/g, '/')} |`);
    writeFileSync(join(out, `${s.id}.md`), `# ${s.text}\n\n결과: ${outcome?.kind ?? 'error'} · ${seconds}s · 도구: ${tools}\n\n## 진행\n${steps.map((l) => `- ${l}`).join('\n')}\n\n## 답\n${answer}\n`);
    console.log(rows.at(-1));
  }
  const table = ['| 결과 | 시나리오 | 종류 | 시간 | 안 본 곳 | 도구 |', '| --- | --- | --- | --- | --- | --- |', ...rows].join('\n');
  writeFileSync(join(out, 'README.md'), `# 실제 모델 시나리오 (${basename(workspace)}, 레포 ${repos.length}개)\n\n${table}\n`);
  console.log(`\n${table}\n\n기록: ${out}`);
}

void main().then(
  () => process.exit(0),
  (e: unknown) => {
    console.error(e);
    process.exit(1);
  },
);
