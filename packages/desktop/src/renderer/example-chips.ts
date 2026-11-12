import { el } from './dom.js';

/** 예시 요청 줄: "Try:" 뒤에 예시를 버튼으로 둔다. 누르면 채팅 탭의 입력칸에 채운다(보내지는 않는다). 채울 곳이 없으면 글로만 보인다. */
export function exampleRow(examples: readonly string[], toChat?: (text: string) => void): HTMLElement {
  const row = el('div', 'hint pad');
  if (examples.length === 0) return row;
  row.appendChild(el('span', 'dim', 'Try: '));
  examples.forEach((text, i) => {
    if (i > 0) row.appendChild(el('span', 'dim', ' · '));
    if (toChat === undefined) {
      row.appendChild(el('span', undefined, `"${text}"`));
      return;
    }
    const chip = el('button', 'btn', text);
    chip.type = 'button';
    chip.title = 'Put this in the chat box';
    chip.addEventListener('click', () => toChat(text));
    row.appendChild(chip);
  });
  return row;
}
