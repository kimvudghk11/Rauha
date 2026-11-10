import { iconFor } from '../shared/file-icon.js';
import { allIconKeys, isKnownIcon, symbolFor } from './file-icons-art.js';

/** 파일·폴더 아이콘을 문서에 한 번만 심고(스프라이트) 각 줄은 <use>로 가리킨다. 그림은 file-icons-art.ts. */
const NS = 'http://www.w3.org/2000/svg';

export { allIconKeys };

let spriteReady = false;
const templates = new Map<string, SVGSVGElement>();

function ensureSprite(): void {
  if (spriteReady) return;
  spriteReady = true;
  const sprite = document.createElementNS(NS, 'svg');
  sprite.setAttribute('width', '0');
  sprite.setAttribute('height', '0');
  sprite.setAttribute('aria-hidden', 'true');
  sprite.setAttribute('class', 'fi-sprite');
  const symbols = allIconKeys().map((k) => `<symbol id="fi-${k}" viewBox="0 0 16 16">${symbolFor(k).body}</symbol>`).join('');
  const doc = new DOMParser().parseFromString(`<svg xmlns="${NS}">${symbols}</svg>`, 'image/svg+xml');
  for (const s of Array.from(doc.documentElement.children)) sprite.append(document.importNode(s, true));
  document.body.prepend(sprite);
}

/** 키로 아이콘 하나를 만든다(없는 키는 기본 문서) */
export function iconElement(key: string): SVGSVGElement {
  ensureSprite();
  let tpl = templates.get(key);
  if (tpl === undefined) {
    const known = isKnownIcon(key) ? key : 'file';
    tpl = document.createElementNS(NS, 'svg');
    tpl.setAttribute('class', `fi fi-${symbolFor(known).tone}`);
    tpl.setAttribute('viewBox', '0 0 16 16');
    tpl.setAttribute('width', '16');
    tpl.setAttribute('height', '16');
    tpl.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(NS, 'use');
    use.setAttribute('href', `#fi-${known}`);
    tpl.append(use);
    templates.set(key, tpl);
  }
  return tpl.cloneNode(true) as SVGSVGElement;
}

/** 이름으로 바로 아이콘을 만든다 */
export function iconByName(name: string, isDir: boolean, open = false): SVGSVGElement {
  return iconElement(iconFor(name, isDir, open));
}
