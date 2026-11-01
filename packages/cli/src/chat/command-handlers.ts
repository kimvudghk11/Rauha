import type { ChatSession } from '@rauha/core';
import { copyToClipboard } from '../clipboard.js';
import type { MascotView } from '../mascot.js';
import { runShell } from '../shell-run.js';
import { isRauhaRepo, nodeExec, repoRoot, runUpdate } from '../update.js';
import { queueLines, shellLines } from './command-lines.js';
import { companyLines } from './company-lines.js';
import { HELP_TEXT, type ChatCommand } from './commands.js';
import { describeTurn } from './describe-turn.js';
import { learningLines } from './learning-lines.js';
import { routineCommand, type RoutineStorePort } from './routine-command.js';
import { teamLines } from './team-lines.js';
import type { ChatStore, Printable } from './chat-store.js';
import type { RoleSettingsDto } from '@rauha/core';

const NO_CURRENT = '  어느 저장소인지 먼저 정해 주세요. /repo <이름>으로 고를 수 있어요.';
/** !명령이 이 시간을 넘기면 멈춘다 */
export const SHELL_TIMEOUT_MS = 120_000;

/** 화면이 닫힌 뒤에도 이어지는 대화 상태. /guide·/copy·/retry·/update가 읽고 쓴다. */
export interface ChatState {
  /** 마지막 작업의 읽기 안내서 */
  lastGuide: string | null;
  /** 마지막 답 글 */
  lastAnswer: string | null;
  /** 마지막으로 보낸 요청 글 */
  lastRequest: string | null;
  /** /update로 갱신을 마쳐 화면을 닫은 뒤 다시 띄워야 하는지 */
  restartAfterExit: boolean;
}

/** 지금 저장소에 딸린 것 중 명령이 쓰는 부분 */
export interface RepoHandle {
  readonly chat: ChatSession;
  readonly team: { resume(): void };
}

/** 명령 처리기가 쓰는 바깥 세계. run-chat이 실제 화면·작업 공간으로 채운다. */
export interface CommandContext {
  readonly store: ChatStore;
  readonly view: MascotView | null;
  readonly state: ChatState;
  readonly roles: RoleSettingsDto;
  /** 지금 저장소(처음이면 연다). 정해지지 않았으면 null */
  current(): RepoHandle | null;
  /** 저장소가 여럿일 때 앞에 붙이는 "[이름] ". 하나면 빈 글 */
  repoLabel(): string;
  clearAll(): void;
  /** 입력 하나를 마친 대화를 파일에 남긴다 */
  remember(repo: RepoHandle): void;
  showUsage(): Promise<void>;
  repoCommand(command: Extract<ChatCommand, { kind: 'repo' }>): Promise<void>;
  userTurn(text: string): Printable[];
  finishWorking(): void;
  runTurn(shown: string, request: string, force?: 'design'): Promise<void>;
  unmount(): void;
  /** !명령을 돌릴 폴더 */
  shellDir(): string;
  routines: { store(): RoutineStorePort; today(): string; startLater(request: string, id: string): void };
}

/** /queue: 쌓아 둔 입력을 보거나 비운다. 줄 서지 않고 바로 처리한다. */
export function queueCommand(store: ChatStore, action: 'show' | 'clear'): void {
  if (action === 'clear') {
    const dropped = store.clearQueue();
    store.print(dropped > 0 ? `  기다리던 입력 ${dropped}개를 지웠어요.` : '  기다리는 입력이 없어요.');
    return;
  }
  store.printLines(queueLines(store.queue));
}

type Handler<K extends ChatCommand['kind']> = (ctx: CommandContext, command: Extract<ChatCommand, { kind: K }>, text: string) => Promise<void> | void;
type Handlers = { readonly [K in ChatCommand['kind']]: Handler<K> };

const HANDLERS: Handlers = {
  clear: (ctx) => {
    ctx.clearAll();
    // 터미널의 clear처럼 화면과 스크롤까지 지우고 배너부터 새로 그린다.
    ctx.store.clearScreen();
  },

  status: (ctx) => {
    const repo = ctx.current();
    if (repo === null) return ctx.store.print(NO_CURRENT);
    const s = repo.chat.status();
    ctx.store.print(`  ${ctx.repoLabel()}대화 ${s.turns}번 · 이어 일할 파일 ${s.carriedFiles}개 · 마지막 작업: ${s.lastTitle ?? '없음'}`);
  },

  usage: (ctx) => ctx.showUsage(),

  update: async (ctx) => {
    const { store } = ctx;
    if (!isRauhaRepo()) return store.print('  rauha가 저장소에서 실행 중이 아니라 갱신할 수 없어요. 저장소에서 yarn rauha update를 실행해 주세요.');
    store.setBusy(true);
    store.print('\n  새 버전이 있는지 확인해요…');
    const result = await runUpdate(repoRoot(), nodeExec(), (line) => store.print(line));
    store.setBusy(false);
    if (!result.ok || !result.built) return;
    // 방금 빌드한 코드로 뜨도록, 이 화면을 닫고 같은 터미널에서 새 프로세스로 다시 띄운다(지난 작업 기억은 파일에 있어 남는다).
    store.print('  다시 띄울게요.');
    ctx.state.restartAfterExit = true;
    ctx.unmount();
  },

  guide: (ctx) => ctx.store.print(ctx.state.lastGuide !== null ? `\n${ctx.state.lastGuide}\n` : '  아직 끝난 작업이 없어요.'),

  repo: (ctx, command) => ctx.repoCommand(command),

  review: async (ctx, command, text) => {
    const { store, view } = ctx;
    const repo = ctx.current();
    if (repo === null) return store.print(NO_CURRENT);
    store.printLines(ctx.userTurn(text));
    repo.team.resume();
    store.setBusy(true);
    try {
      const turn = await repo.chat.review(command.target);
      ctx.finishWorking();
      store.printLines(describeTurn(turn, view));
    } catch (error) {
      ctx.finishWorking();
      store.print(`rauha: ${(error as Error).message}`);
    } finally {
      store.setBusy(false);
      ctx.remember(repo);
    }
  },

  design: (ctx, command, text) => {
    if (command.request === null) return ctx.store.print('  /design <요청>으로 설계부터 시작해요. 예: /design 쿠폰 기능 만들어줘');
    return ctx.runTurn(text, command.request, 'design');
  },

  queue: (ctx, command) => queueCommand(ctx.store, command.action),

  routine: async (ctx, command) => {
    const effect = await routineCommand(command, ctx.routines.store(), ctx.routines.today(), () => crypto.randomUUID());
    ctx.store.printLines(effect.lines);
    for (const r of effect.start) ctx.routines.startLater(r.request, r.id);
  },

  learn: async (ctx) => {
    const repo = ctx.current();
    if (repo === null) return ctx.store.print(NO_CURRENT);
    ctx.store.printLines(learningLines(await repo.chat.learningNotes()));
  },

  company: async (ctx) => {
    const repo = ctx.current();
    if (repo === null) return ctx.store.print(NO_CURRENT);
    ctx.store.printLines(companyLines(await repo.chat.companyEntries()));
  },

  team: (ctx) => ctx.store.printLines(teamLines(ctx.roles)),

  shell: async (ctx, command, text) => {
    if (command.command === null) return ctx.store.print('  !<명령>으로 바로 실행해요. 예: !aws s3 ls');
    ctx.store.printLines(ctx.userTurn(text));
    ctx.store.setBusy(true);
    try {
      const result = await runShell(command.command, ctx.shellDir(), SHELL_TIMEOUT_MS);
      ctx.store.printLines(shellLines(result, SHELL_TIMEOUT_MS));
    } finally {
      ctx.store.setBusy(false);
    }
  },

  copy: async (ctx) => {
    const answer = ctx.state.lastAnswer ?? ctx.state.lastGuide;
    if (answer === null) return ctx.store.print('  복사할 답이 아직 없어요.');
    ctx.store.print((await copyToClipboard(answer)) ? '  마지막 답을 클립보드에 복사했어요.' : '  클립보드에 복사하지 못했어요. (Windows는 PowerShell, macOS는 pbcopy, Linux는 xclip이 필요해요)');
  },

  retry: (ctx) => {
    const last = ctx.state.lastRequest;
    if (last === null) return ctx.store.print('  다시 보낼 요청이 아직 없어요.');
    return ctx.runTurn(last, last);
  },

  help: (ctx) => ctx.store.print(HELP_TEXT),

  exit: (ctx) => ctx.unmount(),

  unknown: (ctx, command) => ctx.store.print(`  ${command.name}는 없는 명령이에요. /help로 명령을 볼 수 있어요.`),
};

/** 슬래시·! 명령 하나를 처리한다. 명령마다 처리기가 하나씩이라 종류를 빠뜨리면 컴파일이 막는다. */
export async function runCommand(ctx: CommandContext, command: ChatCommand, text: string): Promise<void> {
  const handler = HANDLERS[command.kind] as Handler<typeof command.kind>;
  await handler(ctx, command as never, text);
}
