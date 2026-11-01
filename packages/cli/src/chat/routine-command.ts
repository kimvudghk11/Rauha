import { Routine, type RoutineBook } from '@rauha/core';
import type { ChatCommand } from './commands.js';
import { ROUTINE_USAGE, routineLines } from './routine-lines.js';

export interface RoutineStorePort {
  load(): Promise<RoutineBook>;
  save(book: RoutineBook): Promise<void>;
}

/** 명령의 결과: 화면에 낼 줄과, 차례로 실행할 정기 업무(run일 때만) */
export interface RoutineEffect {
  readonly lines: string[];
  readonly start: readonly { readonly id: string; readonly request: string }[];
}

/**
 * /routine 한 번을 처리한다. run은 때가 된 업무를 돌릴 목록으로 돌려줄 뿐 "했음"으로 표시하지 않는다.
 * 표시는 그 업무가 실제로 시작될 때 markStarted로 한다(대기열이 비워져 안 돈 업무가 오늘 한 것으로 남지 않게).
 */
export async function routineCommand(command: Extract<ChatCommand, { kind: 'routine' }>, store: RoutineStorePort, today: string, newId: () => string): Promise<RoutineEffect> {
  if (command.action === 'usage') return { lines: ['', ...ROUTINE_USAGE, ''], start: [] };
  const book = await store.load();
  if (command.action === 'list') return { lines: routineLines(book, today), start: [] };
  if (command.action === 'run') {
    const due = book.due(today);
    if (due.length === 0) return { lines: ['  때가 된 정기 업무가 없어요.'], start: [] };
    return { lines: [`  정기 업무 ${due.length}개를 차례로 실행해요.`], start: due.map((r) => ({ id: r.id, request: r.request })) };
  }
  try {
    if (command.action === 'add') {
      await store.save(book.add(Routine.create({ id: newId(), request: command.request, cadence: command.cadence, today })));
      return { lines: [`  정기 업무를 등록했어요: ${command.request}  (${command.cadence.kind === 'daily' ? '매일' : '매주'}, 때가 되면 알려 드려요)`], start: [] };
    }
    if (command.action === 'remove') {
      await store.save(book.remove(command.number));
      return { lines: [`  ${command.number}번 정기 업무를 지웠어요.`], start: [] };
    }
    return { lines: [], start: [] };
  } catch (error) {
    return { lines: [`  ${(error as Error).message}`], start: [] };
  }
}

/** 정기 업무가 실제로 시작될 때 오늘 했다고 표시한다. 저장에 실패해도 업무는 그대로 돈다. */
export async function markStarted(store: RoutineStorePort, id: string, today: string): Promise<void> {
  try {
    await store.save((await store.load()).markRun([id], today));
  } catch {
    // 표시를 못 남기면 다음에 한 번 더 알릴 뿐이다.
  }
}
