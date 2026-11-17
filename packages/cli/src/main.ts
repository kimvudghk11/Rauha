#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DomainError, loadProfileConfig, type MemberRole } from '@rauha/core';
import { parseArgs } from './args.js';
import { terminalAsker, terminalUser } from './ask.js';
import { createNotifier } from './notify.js';
import { runBench } from './bench.js';
import { runChat } from './chat/run-chat.js';
import { LiveLine } from './live-line.js';
import { mascotView } from './mascot.js';
import { rememberRun, runOnce } from './run.js';
import { runSetup } from './setup.js';
import { isRauhaRepo, nodeExec, relaunch, repoRoot, runUpdate } from './update.js';

const VERSION = '0.0.0';

const HELP = `rauha — 터미널에서 팀장과 대화하는 클로드 팀

사용법
  rauha                       대화 모드: 요청과 질문을 이어서 주고받음 (/help로 명령 보기)
  rauha --continue            지난 대화를 이어서 열기 (-c)
  rauha -p "<요청>"            한 번 실행: 접수 → 테스트 → 구현 → 검증 → 리뷰·사실 점검 → 읽기 안내서
  rauha -p "<요청>" --quick    리뷰·사실 점검 없이 검증 통과로 끝냄 (bench에도 쓸 수 있음)
  rauha whoami                현재 프로필과 Claude Code 설정 폴더 확인
  rauha login                 이 프로필의 Claude Code 로그인 (브라우저 인증)
  rauha setup                 어느 폴더에서든 rauha로 부를 수 있게 설치 (처음 한 번, 저장소에서 yarn rauha setup)
  rauha update                최신 버전으로 갱신(새 커밋 내려받기·설치·빌드)하고 바로 다시 실행
                              (대화 중에는 /update)
  rauha bench [--only <id>] [--compare]
                              연습용 프로젝트(rauha 저장소의 examples/)에서 고정 요청 묶음 실행
                              --compare: 요청마다 사다리(sonnet부터)와 구현 opus 고정을 비교
                              --same-repo: 요청을 한 저장소에서 이어서 돌려 저장소 지식 효과를 잼
  rauha --profile <이름> ...   프로필 직접 지정 (기본: 폴더 규칙 → personal)

환경 변수
  RAUHA_CONFIG                설정 파일 경로 (기본 ~/.rauha/config.toml)
  RAUHA_PROMPTS_DIR           팀원 프롬프트 폴더 (기본: 저장소의 prompts/)
  RAUHA_ROLE_<ROLE>           역할별 모델·effort, 예: RAUHA_ROLE_IMPLEMENTER=sonnet:high
`;

/** `yarn rauha`는 패키지 폴더에서 실행되므로, 사용자가 명령을 친 폴더(INIT_CWD)를 쓴다. */
const workDir = process.env['INIT_CWD'] ?? process.cwd();
const log = (line: string) => process.stderr.write(`${line}\n`);

function gitRemote(cwd: string): string | null {
  try {
    return execFileSync('git', ['remote', 'get-url', 'origin'], { cwd, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

/** 폴더 → 프로필. 작업 공간에서는 저장소마다 이 규칙으로 계정을 고른다. */
async function profileResolver(flag: string | null) {
  const configPath = process.env['RAUHA_CONFIG'] ?? join(homedir(), '.rauha', 'config.toml');
  const book = (await loadProfileConfig(configPath)).toEntity();
  return (cwd: string) => book.resolve({ cwd, home: homedir(), gitRemote: gitRemote(cwd), flag, env: process.env['RAUHA_PROFILE'] ?? null });
}

async function resolveProfile(flag: string | null) {
  return (await profileResolver(flag))(workDir);
}

async function login(flag: string | null): Promise<number> {
  const { profile } = await resolveProfile(flag);
  const dir = profile.claudeConfigDir(homedir());
  mkdirSync(dir, { recursive: true });
  log(`${profile.badge()} Claude Code 로그인을 시작합니다. 설정 폴더: ${dir}`);
  return new Promise((resolve) => {
    const options = { env: { ...process.env, ...profile.agentEnv(homedir()) }, stdio: 'inherit' } as const;
    // Windows의 claude는 .cmd·.ps1이라 셸을 거친다. 셸에는 한 줄로 넘긴다(인자 배열이면 Node 24가 DEP0190 경고를 띄운다).
    const child = process.platform === 'win32' ? spawn('claude auth login', { ...options, shell: true }) : spawn('claude', ['auth', 'login'], options);
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', (error) => {
      log(`claude 실행 실패: ${error.message}. Claude Code가 설치돼 있는지 확인하세요.`);
      resolve(1);
    });
  });
}

async function run(argv: readonly string[]): Promise<number> {
  const command = parseArgs(argv);
  switch (command.kind) {
    case 'help':
      process.stdout.write(HELP);
      return 0;
    case 'version':
      process.stdout.write(`rauha ${VERSION}\n`);
      return 0;
    case 'whoami': {
      const { profile, source } = await resolveProfile(command.profile);
      process.stdout.write(
        `${profile.badge()} ${workDir}\n` +
          `  선택 근거: ${source}\n` +
          `  Claude Code 설정 폴더: ${profile.claudeConfigDir(homedir())}\n` +
          `  실행 기록: ${profile.runsDir(homedir())}\n` +
          `  기록 동기화: ${profile.canSync() ? '허용' : '안 함'}\n`,
      );
      return 0;
    }
    case 'login':
      return login(command.profile);
    case 'setup':
      log('어느 폴더에서든 rauha를 부를 수 있게 할게요.');
      return runSetup({ entry: fileURLToPath(import.meta.url), home: homedir(), log });
    case 'update': {
      if (!isRauhaRepo()) {
        log('rauha가 저장소에서 실행 중이 아니라 갱신할 수 없어요. 저장소에서 yarn rauha update를 실행해 주세요.');
        return 1;
      }
      log('새 버전이 있는지 확인해요…');
      const result = await runUpdate(repoRoot(), nodeExec(), log);
      if (!result.ok) return 1;
      if (!result.built) return 0;
      log('다시 실행할게요.\n');
      // 방금 빌드한 코드로 뜨도록 새 프로세스로 띄운다. 'update'만 빼고 나머지 인자는 그대로 넘긴다.
      const rest = argv.filter((arg, i) => !(arg === 'update' && argv.indexOf('update') === i));
      return relaunch(spawn, process.execPath, process.execArgv, process.argv[1]!, rest);
    }
    case 'bench': {
      const { profile } = await resolveProfile(command.profile);
      // 연습용 프로젝트는 rauha 저장소 안에 있다. 어느 폴더에서 불러도 저장소를 쓴다.
      const report = await runBench({ repoRoot: repoRoot(), profile, home: homedir(), only: command.only, compare: command.compare, quick: command.quick, sameRepo: command.sameRepo, log });
      process.stdout.write(`${report}\n`);
      return 0;
    }
    case 'chat': {
      const resolveAt = await profileResolver(command.profile);
      const { profile } = resolveAt(workDir);
      if (command.prompt === null || command.prompt.trim() === '') {
        return runChat({ workDir, profile, home: homedir(), version: VERSION, threePass: !command.quick, resume: command.resume, profileFor: (root) => resolveAt(root).profile });
      }
      const view = process.stderr.isTTY ? mascotView(process.stderr.getColorDepth(), `v${VERSION}`, profile.badge()) : null;
      log(view ? view.banner(workDir, process.stderr.columns ?? 80) : `${profile.badge()} ${workDir}`);
      // 팀원이 일하는 동안 맨 아래 줄에 스피너와 경과 시간을 보여 준다. role이 붙은 알림 = 그 팀원이 일을 시작함.
      let working: MemberRole = 'intake';
      const live = view
        ? new LiveLine({
            write: (text) => process.stderr.write(text),
            now: Date.now,
            working: (frame, text, elapsed) => view.working(frame, text, working, elapsed),
            done: (text, elapsed) => view.done(text, working, elapsed),
          })
        : null;
      const say = (line: string) => (live ? live.print(line) : log(line));
      const notifier = createNotifier();
      const step = (message: string, role?: MemberRole) => {
        if (view === null || live === null) return log(`${profile.badge()} ${message}`);
        live.stop();
        if (role === undefined) return say(view.step(message));
        working = role;
        live.start(message);
      };
      const { outcome } = await runOnce(command.prompt, {
        root: workDir,
        profile,
        home: homedir(),
        ask: terminalAsker({ view, live, log: say, notifier, name: profile.badge() }),
        user: terminalUser({ view, live, notifier, name: profile.badge() }),
        progress: { step },
        requireClean: true,
        threePass: !command.quick,
      }).finally(() => live?.stop());
      await rememberRun(outcome, command.prompt, { root: workDir, profile, home: homedir() }, log);
      if (view) log(`\n${view.finale(outcome.status)}`);
      process.stdout.write(`\n${process.stdout.isTTY ? outcome.guide.toTerminal(workDir) : outcome.guide.toMarkdown()}\n`);
      return outcome.status === 'complete' ? 0 : 2;
    }
  }
}

run(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    if (error instanceof DomainError) {
      log(`rauha: ${error.message}`);
      process.exitCode = 1;
    } else {
      throw error;
    }
  },
);
