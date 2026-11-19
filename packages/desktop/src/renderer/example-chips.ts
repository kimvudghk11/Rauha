import { el } from './dom.js';

/** 예시 요청 줄: "Try:" 뒤에 예시를 버튼으로 둔다. 누르면 채팅 탭의 입력칸에 채운다(보내지는 않는다). 채울 곳이 없으면 글로만 보인다. */
export function exampleRow(examples: readonly string[], toChat?: (text: string) => void): HTMLElement {
  // 누를 수 있는 칩이면 줄바꿈되는 칩 줄로 두고 사이 점은 뺀다(점이 줄 끝에 홀로 걸려 어색했다)
  const row = el('div', toChat === undefined ? 'hint pad' : 'hint pad ex-row');
  if (examples.length === 0) return row;
  row.appendChild(el('span', 'dim', 'Try: '));
  examples.forEach((text, i) => {
    if (i > 0 && toChat === undefined) row.appendChild(el('span', 'dim', ' · '));
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
