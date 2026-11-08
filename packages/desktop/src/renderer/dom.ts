export const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (cls !== undefined) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** 24×24 SVG path를 아이콘으로 */
export function icon(path: string): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  for (const d of path.split(' M').map((p, i) => (i === 0 ? p : `M${p}`))) {
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  return svg;
}

/**
 * Enter 키로 "확정"하는 입력칸용. 한글·일본어·중국어 입력기(IME)는 글자를 조합하는 중에도 Enter 키 이벤트를 두 번(조합 확정 + 실제 Enter) 보낸다.
 * 조합 중(isComposing, 또는 일부 브라우저의 keyCode 229)의 Enter는 무시해서 마지막 글자가 따로 카드·명령으로 새는 것을 막는다.
 */
export function isEnterKey(e: KeyboardEvent): boolean {
  return e.key === 'Enter' && !e.isComposing && e.keyCode !== 229;
}
