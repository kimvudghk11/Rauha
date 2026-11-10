import type { ImageResult } from '../shared/code-api.js';
import type { Block, Inline, ListItem } from '../shared/markdown.js';
import { workImagePath } from '../shared/preview-kind.js';
import { el } from './dom.js';

/**
 * 마크다운 구조(shared/markdown.ts)를 화면 부품으로 그린다. 글은 전부 textNode/textContent로만 넣고
 * innerHTML·style 속성을 쓰지 않는다. 링크는 구조 단계에서 http·https만 남고(기본 브라우저로 열린다),
 * 이미지는 같은 작업 폴더 안의 그림 파일만 main에서 읽어 data: URL로 그린다.
 */
export interface MarkdownContext {
  /** 이 마크다운 파일의 작업 폴더 기준 경로(이미지의 상대 주소를 푸는 기준) */
  readonly path: string;
  /** 그림 하나를 읽는다(main). 같은 그림은 호출하는 쪽이 캐시한다. */
  readonly loadImage: (path: string) => Promise<ImageResult>;
}

const ALIGN_CLASS = { left: 'md-al-left', right: 'md-al-right', center: 'md-al-center' } as const;

export function renderMarkdown(blocks: readonly Block[], ctx: MarkdownContext): HTMLElement {
  const root = el('div', 'md');
  for (const b of blocks) root.append(block(b, ctx));
  if (blocks.length === 0) root.append(el('p', 'md-empty', 'No content.'));
  return root;
}

function block(b: Block, ctx: MarkdownContext): HTMLElement {
  switch (b.t) {
    case 'h': {
      const h = el(`h${b.level}` as 'h1');
      inlines(h, b.c, ctx);
      return h;
    }
    case 'p': {
      const p = el('p');
      inlines(p, b.c, ctx);
      return p;
    }
    case 'code': {
      const pre = el('pre', 'md-pre');
      const code = el('code', undefined, b.text);
      if (b.lang !== '') pre.dataset['lang'] = b.lang;
      pre.append(code);
      return pre;
    }
    case 'hr':
      return el('hr');
    case 'quote': {
      const q = el('blockquote');
      for (const c of b.c) q.append(block(c, ctx));
      return q;
    }
    case 'ul':
    case 'ol': {
      const list = el(b.t);
      if (b.t === 'ol' && b.start !== 1) (list as HTMLOListElement).start = b.start;
      for (const item of b.items) list.append(listItem(item, ctx));
      return list;
    }
    case 'table': {
      const table = el('table');
      const head = el('thead');
      const tr = el('tr');
      b.head.forEach((cell, k) => tr.append(tableCell('th', cell, b.align[k] ?? null, ctx)));
      head.append(tr);
      const body = el('tbody');
      for (const row of b.rows) {
        const r = el('tr');
        row.forEach((cell, k) => r.append(tableCell('td', cell, b.align[k] ?? null, ctx)));
        body.append(r);
      }
      table.append(head, body);
      const wrap = el('div', 'md-table');
      wrap.append(table);
      return wrap;
    }
  }
}

function tableCell(tag: 'th' | 'td', cell: readonly Inline[], align: keyof typeof ALIGN_CLASS | null, ctx: MarkdownContext): HTMLElement {
  const c = el(tag, align === null ? undefined : ALIGN_CLASS[align]);
  inlines(c, cell, ctx);
  return c;
}

function listItem(item: ListItem, ctx: MarkdownContext): HTMLElement {
  const li = el('li');
  if (item.checked !== null) {
    li.className = 'md-task';
    const box = el('input');
    box.type = 'checkbox';
    box.disabled = true;
    box.checked = item.checked;
    box.setAttribute('aria-label', item.checked ? 'Done' : 'Not done');
    li.append(box);
  }
  for (const b of item.c) li.append(block(b, ctx));
  return li;
}

function inlines(parent: HTMLElement, nodes: readonly Inline[], ctx: MarkdownContext): void {
  for (const n of nodes) {
    switch (n.t) {
      case 'text':
        parent.append(document.createTextNode(n.v));
        break;
      case 'code':
        parent.append(el('code', 'md-code', n.v));
        break;
      case 'strong': {
        const s = el('strong');
        inlines(s, n.c, ctx);
        parent.append(s);
        break;
      }
      case 'em': {
        const s = el('em');
        inlines(s, n.c, ctx);
        parent.append(s);
        break;
      }
      case 'del': {
        const s = el('del');
        inlines(s, n.c, ctx);
        parent.append(s);
        break;
      }
      case 'br':
        parent.append(el('br'));
        break;
      case 'link': {
        const a = el('a');
        a.href = n.href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.title = n.href;
        inlines(a, n.c, ctx);
        parent.append(a);
        break;
      }
      case 'image':
        parent.append(image(n.src, n.alt, ctx));
        break;
    }
  }
}

/** 이미지: 같은 작업 폴더 안 그림이면 읽어서 보이고, 아니면(주소·밖의 경로·못 읽음) 대체 글만 보인다 */
function image(src: string, alt: string, ctx: MarkdownContext): HTMLElement {
  const rel = workImagePath(ctx.path, src);
  const off = (why: string): HTMLElement => {
    const s = el('span', 'md-img-off', `[Image${alt === '' ? '' : `: ${alt}`}]`);
    s.title = why;
    return s;
  };
  if (rel === null) return off('Only image files inside the work folder are shown. Web addresses and images outside the folder are not opened.');
  const holder = el('span', 'md-img-wrap');
  const placeholder = el('span', 'md-img-off', 'Loading image…');
  holder.append(placeholder);
  void ctx.loadImage(rel).then(
    (r) => {
      if (!r.ok) {
        holder.replaceChildren(off('Could not open the image.'));
        return;
      }
      const img = el('img', 'md-img');
      img.alt = alt;
      img.title = alt === '' ? rel : alt;
      img.src = r.dataUrl;
      holder.replaceChildren(img);
    },
    () => holder.replaceChildren(off('Could not open the image.')),
  );
  return holder;
}
