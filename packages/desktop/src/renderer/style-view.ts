import type { StyleView } from '../shared/ipc.js';
import { el } from './dom.js';

export interface StyleApi {
  list(): Promise<readonly StyleView[]>;
  forget(id: string): Promise<readonly StyleView[]>;
}

/**
 * Settings 의 "Your style" 구역: rauha 가 내 말에서 배운 답변 취향 목록과 근거(내가 한 말). 지우면 팀원 프롬프트와
 * 계정 CLAUDE.md 의 rauha 구역에서도 빠진다. 새로 배우는 건 채팅에서 "앞으로는 …", "… 말고" 처럼 말할 때뿐이다.
 */
export function buildStyle(api: StyleApi): { readonly parts: readonly HTMLElement[]; refresh(): void } {
  const list = el('div', 'style-list');
  const hint = el(
    'div',
    'hint pad',
    'Learned from what you say in chat ("from now on…", "don\'t…", "answer in Korean"). Every teammate follows these, and they are also written to a rauha section in your Claude account CLAUDE.md (and the answer language to settings.json if you have not set one). Delete one to stop using it.',
  );
  const paint = (items: readonly StyleView[]): void => {
    list.replaceChildren();
    if (items.length === 0) {
      list.appendChild(el('div', 'dim pad', 'Nothing yet. Tell the team how you like answers, and it will show up here.'));
      return;
    }
    for (const item of items) {
      const row = el('div', 'srow style-row');
      const text = el('div', 'grow');
      text.append(el('div', undefined, item.text), el('div', 'hint', `You said: "${item.quote}"${item.weight > 1 ? ` · heard ${item.weight} times` : ''}`));
      const drop = el('button', 'btn sm', 'Delete');
      drop.setAttribute('aria-label', `Delete style: ${item.text}`);
      drop.addEventListener('click', () => {
        drop.disabled = true;
        void api.forget(item.id).then(paint);
      });
      row.append(text, drop);
      list.appendChild(row);
    }
  };
  const refresh = (): void => void api.list().then(paint);
  refresh();
  return { parts: [hint, list], refresh };
}
