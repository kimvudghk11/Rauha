import { RoleSettingsDto, Routine, RoutineBook } from '@rauha/core';
import { describe, expect, it } from 'vitest';
import { ChatStore } from './chat-store.js';
import { queueCommand, runCommand, type ChatState, type CommandContext } from './command-handlers.js';
import { parseCommand } from './commands.js';

function setup(overrides: Partial<CommandContext> = {}, state: Partial<ChatState> = {}) {
  const store = new ChatStore();
  const turns: { shown: string; request: string; force?: 'design' | undefined }[] = [];
  const full: ChatState = { lastGuide: null, lastAnswer: null, lastRequest: null, restartAfterExit: false, ...state };
  let unmounted = false;
  const queued: [string, string][] = [];
  const ctx: CommandContext = {
    store,
    view: null,
    state: full,
    roles: RoleSettingsDto.defaults(),
    current: () => null,
    repoLabel: () => '',
    clearAll: () => undefined,
    remember: () => undefined,
    showUsage: async () => undefined,
    repoCommand: async () => undefined,
    userTurn: (text) => [`> ${text}`],
    finishWorking: () => undefined,
    runTurn: async (shown, request, force) => {
      turns.push({ shown, request, force });
    },
    unmount: () => {
      unmounted = true;
    },
    shellDir: () => '.',
    routines: { store: () => ({ load: async () => { throw new Error('쓰지 않음'); }, save: async () => undefined }), today: () => '2026-11-01', startLater: (request, id) => queued.push([request, id]) },
    ...overrides,
  };
  const run = async (text: string) => runCommand(ctx, parseCommand(text)!, text);
  const printed = () => store.lines.map((l) => (typeof l === 'string' ? l : '')).join('\n');
  return { ctx, store, run, turns, printed, state: full, unmounted: () => unmounted, queued };
}

describe('명령 처리기', () => {
  it('/guide: 끝난 작업이 없으면 그렇게 알리고, 있으면 안내서를 보여 준다', async () => {
    const empty = setup();
    await empty.run('/guide');
    expect(empty.printed()).toContain('아직 끝난 작업이 없어요');
    const some = setup({}, { lastGuide: '읽는 순서 1' });
    await some.run('/guide');
    expect(some.printed()).toContain('읽는 순서 1');
  });

  it('/copy: 복사할 답이 없으면 그렇게 알린다', async () => {
    const t = setup();
    await t.run('/copy');
    expect(t.printed()).toContain('복사할 답이 아직 없어요');
  });

  it('/retry: 마지막 요청을 같은 글로 다시 보내고, 없으면 알린다', async () => {
    const none = setup();
    await none.run('/retry');
    expect(none.turns).toEqual([]);
    expect(none.printed()).toContain('다시 보낼 요청이 아직 없어요');
    const some = setup({}, { lastRequest: '쿠폰 넣어줘' });
    await some.run('/retry');
    expect(some.turns).toEqual([{ shown: '쿠폰 넣어줘', request: '쿠폰 넣어줘', force: undefined }]);
  });

  it('/design: 요청이 있으면 라우터를 건너뛰고 설계로 보내고, 없으면 쓰는 법을 알린다', async () => {
    const t = setup();
    await t.run('/design');
    expect(t.turns).toEqual([]);
    expect(t.printed()).toContain('/design <요청>');
    await t.run('/design 쿠폰 기능');
    expect(t.turns).toEqual([{ shown: '/design 쿠폰 기능', request: '쿠폰 기능', force: 'design' }]);
  });

  it('저장소가 정해지지 않았으면 /status·/learn·/company는 먼저 고르라고 알린다', async () => {
    for (const command of ['/status', '/learn', '/company']) {
      const t = setup();
      await t.run(command);
      expect(t.printed()).toContain('/repo <이름>');
    }
  });

  it('/team은 저장소와 상관없이 회사 구성을 보여 준다', async () => {
    const t = setup();
    await t.run('/team');
    expect(t.printed()).toContain('개발부');
  });

  it('/exit는 화면을 닫고, 모르는 명령은 알린다', async () => {
    const t = setup();
    await t.run('/exit');
    expect(t.unmounted()).toBe(true);
    await t.run('/nothing');
    expect(t.printed()).toContain('없는 명령이에요');
  });

  it('/clear는 모든 저장소 대화를 비운다', async () => {
    let cleared = 0;
    const t = setup({ clearAll: () => (cleared += 1) });
    await t.run('/clear');
    expect(cleared).toBe(1);
  });

  it('/routine run: 때가 된 업무를 나중에 시작할 목록으로 넘긴다', async () => {
    const book = RoutineBook.empty().add(Routine.create({ id: 'a', request: '지표 점검', cadence: { kind: 'daily' }, today: '2026-10-01' }));
    const t = setup({ routines: { store: () => ({ load: async () => book, save: async () => undefined }), today: () => '2026-11-01', startLater: (request, id) => t.queued.push([request, id]) } });
    await t.run('/routine run');
    expect(t.queued).toEqual([['지표 점검', 'a']]);
  });
});

describe('queueCommand', () => {
  it('비우면 몇 개를 지웠는지 알린다', () => {
    const store = new ChatStore();
    store.enqueue('하나');
    store.enqueue('둘');
    queueCommand(store, 'clear');
    expect(store.queue).toEqual([]);
    expect(store.lines.join('\n')).toContain('2개를 지웠어요');
  });
});
