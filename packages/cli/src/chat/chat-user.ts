import { oneAtATime, type DesignUserPort, type PermissionAsker, type UserPort } from '@rauha/core';
import { FACT_ANSWERED, FACT_OPTIONS, PERMISSION_ANSWERED, PERMISSION_OPTIONS, toFactAnswer, toPermissionAnswer } from '../ask.js';
import type { MascotView } from '../mascot.js';
import { NOTIFY_AFTER_MS, notifyWhile, type Notifier } from '../notify.js';
import type { ChatStore } from './chat-store.js';

/**
 * 팀원이 사용자에게 묻는 일(허락·사실 확인·지난 작업 고르기·설계 대화·저장소 고르기)을 대화 화면의 메뉴와 입력으로 잇는다.
 * 사용자가 바로 답하지 않으면 운영체제 알림으로도 알린다(바로 답하면 알림은 뜨지 않는다).
 */
export function createChatUser(p: { store: ChatStore; view: MascotView | null; notifier: Notifier | null; badge: string; columns: () => number }) {
  const { store, view, notifier, badge, columns } = p;

  const askPermission: PermissionAsker = async (request) => {
    const screen = view?.permission(request, columns()) ?? `⚠ 위험 동작 허락? ${request.reason}\n  ${request.detail}`;
    const compactScreen = view?.permission(request, columns(), true);
    const index = (await store.ask({ kind: 'menu', screen, compactScreen, options: PERMISSION_OPTIONS })) as number;
    const note = index === 3 ? ((await store.ask({ kind: 'text', label: '팀원에게 전할 이유' })) as string) : null;
    store.print(`  → ${PERMISSION_ANSWERED[index < 0 ? 2 : index]}`);
    return toPermissionAnswer(index, note);
  };

  const asker: UserPort = {
    interactive: true,
    choose: async (assumption) => {
      const options = [`${assumption.chosen}  (추천)`, ...assumption.alternatives];
      const index = (await store.ask({ kind: 'menu', screen: `? ${assumption.question}`, options })) as number;
      return index < 0 ? 0 : index;
    },
    confirmFact: async (claim) => {
      const screen = view?.factCheck(claim.text, columns()) ?? `? 근거를 확인하지 못했어요. 맞나요?\n  ${claim.text}`;
      const compactScreen = view?.factCheck(claim.text, columns(), true);
      const index = (await store.ask({ kind: 'menu', screen, compactScreen, options: FACT_OPTIONS })) as number;
      const correction = index === 1 ? ((await store.ask({ kind: 'text', label: '바로잡을 내용' })) as string) : null;
      store.print(`  → ${FACT_ANSWERED[index < 0 ? 2 : index]}`);
      return toFactAnswer(index, correction);
    },
    pickPast: async (candidates) => {
      const screen = view?.pastPick(columns()) ?? '? 혹시 이 작업을 말씀하시는 건가요?';
      const options = [...candidates.map((c) => `${c.title}  (${c.at.slice(0, 16).replace('T', ' ')})`), '아니요, 새 작업이에요'];
      const compactScreen = view?.pastPick(columns(), true);
      const index = (await store.ask({ kind: 'menu', screen, compactScreen, options })) as number;
      return index >= 0 && index < candidates.length ? candidates[index]!.id : null;
    },
  };

  // 여러 저장소가 함께 일하면 묻는 화면이 동시에 올 수 있다. 하나씩 차례로 보여 준다.
  const inTurn = oneAtATime((task: () => Promise<unknown>) => task());
  const asking = <T>(body: string, task: () => Promise<T>) => inTurn(() => notifyWhile(notifier, NOTIFY_AFTER_MS, `${badge} 선택이 필요해요`, body, task)) as Promise<T>;

  const ask: PermissionAsker = (request) => asking(`${request.tool} 실행 허락: ${request.detail}`, () => askPermission(request));
  const user: UserPort = {
    interactive: true,
    choose: (assumption) => asking(`요청의 해석을 정해 주세요: ${assumption.question}`, () => asker.choose(assumption)),
    confirmFact: (claim) => asking(`근거를 못 찾은 사실이 맞는지 알려 주세요: ${claim.text}`, () => asker.confirmFact(claim)),
    pickPast: (candidates) => asking('이 작업이 맞는지 알려 주세요', () => asker.pickPast(candidates)),
    discuss: (q) =>
      asking(`설계 질문에 답해 주세요: ${q.question}`, async () => {
        store.printLines(['', `  ? 설계 질문 ${q.round}: ${q.question}`]);
        if (q.suggestion !== null) store.print(`    추천: ${q.suggestion}`);
        store.print('    (Enter 또는 "알아서 해" = 추천대로, /cancel = 설계 그만두기)');
        const text = ((await store.ask({ kind: 'text', label: '답' })) as string).trim();
        return text.toLowerCase() === '/cancel' ? null : text;
      }),
    approve: (plan) =>
      asking(`설계를 보고 승인해 주세요: ${plan.title}`, async () => {
        store.printLines(['', ...plan.summary, `  설계 문서: ${plan.path} (직접 고쳐도 돼요)`, '']);
        const index = (await store.ask({ kind: 'menu', screen: '? 이 설계로 진행할까요?', options: ['승인하고 시작', '고칠 점 말하기', '그만두기'] })) as number;
        if (index === 0) return { kind: 'approve' } as const;
        if (index !== 1) return { kind: 'cancel' } as const;
        const note = ((await store.ask({ kind: 'text', label: '고칠 점' })) as string).trim();
        return note === '' ? ({ kind: 'cancel' } as const) : ({ kind: 'revise', note } as const);
      }),
    pickRepo: (candidates) =>
      asking('어느 저장소 일인지 골라 주세요', async () => {
        const index = (await store.ask({ kind: 'menu', screen: '? 어느 저장소 일인가요?', options: candidates.map((c) => c.name) })) as number;
        return index >= 0 && index < candidates.length ? candidates[index]!.name : null;
      }),
  };

  /** 설계 서비스가 쓰는 사용자 쪽(위 user의 설계 대화 부분) */
  const designUser: DesignUserPort = { discuss: (q) => user.discuss!(q), approve: (plan) => user.approve!(plan) };

  return { ask, user, designUser };
}
