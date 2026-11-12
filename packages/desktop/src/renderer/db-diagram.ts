import { DIAGRAM, DiagramLayout, type DbSchemaGraph } from '../shared/db-diagram.js';
import { el } from './dom.js';
import { button } from './todo-parts.js';

const NS = 'http://www.w3.org/2000/svg';
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 2.5;
/** SVG 글은 줄임표가 없어서 글자 수로 자른다 */
const NAME_CHARS = 22;
const TYPE_CHARS = 12;

const svg = <K extends keyof SVGElementTagNameMap>(tag: K, cls?: string): SVGElementTagNameMap[K] => {
  const n = document.createElementNS(NS, tag);
  if (cls !== undefined) n.setAttribute('class', cls);
  return n;
};
const attrs = (n: SVGElement, a: Readonly<Record<string, string | number>>): void => {
  for (const [k, v] of Object.entries(a)) n.setAttribute(k, String(v));
};
const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

export interface DiagramDeps {
  /** 상자를 눌렀을 때(고르기 · 큰 스키마면 그 테이블 중심으로 다시 그리기) */
  readonly onPick: (table: string) => void;
  /** 상자를 두 번 눌렀을 때(그 테이블 행 보기) */
  readonly onOpen: (table: string) => void;
}

/**
 * 테이블 시각화(ERD): 테이블 상자(열 · PK · FK)와 FK 선을 인라인 SVG 로 그린다(외부 라이브러리 없음).
 * 배치는 shared/db-diagram.ts 가 계산하고, 여기서는 그리기 · 끌어서 옮기기 · 휠로 확대만 한다.
 */
export function buildDiagram(deps: DiagramDeps) {
  const root = el('div', 'db-diagram');
  const bar = el('div', 'bar db-dia-bar');
  const note = el('span', 'hint grow db-dia-note');
  const zoomText = el('span', 'hint db-dia-zoom');
  const view = el('div', 'db-dia-view');
  view.tabIndex = 0;
  view.setAttribute('aria-label', 'Table diagram. Drag to move, scroll to zoom.');
  const canvas = svg('svg', 'db-dia-svg');
  const layer = svg('g');
  canvas.append(layer);
  view.append(canvas);
  root.append(bar, view);

  let scale = 1;
  let tx = 0;
  let ty = 0;
  let layout: DiagramLayout | null = null;
  let picked: string | null = null;

  const apply = (): void => {
    layer.setAttribute('transform', `translate(${tx} ${ty}) scale(${scale})`);
    zoomText.textContent = `${Math.round(scale * 100)}%`;
  };
  const zoomAt = (next: number, cx: number, cy: number): void => {
    const s = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
    tx = cx - ((cx - tx) * s) / scale;
    ty = cy - ((cy - ty) * s) / scale;
    scale = s;
    apply();
  };
  const fit = (): void => {
    if (layout === null) return;
    const w = view.clientWidth || 800;
    const h = view.clientHeight || 500;
    scale = Math.min(1, Math.max(ZOOM_MIN, Math.min(w / layout.width, h / layout.height)));
    tx = Math.max(0, (w - layout.width * scale) / 2);
    ty = 0;
    apply();
  };
  const centre = (): { x: number; y: number } => ({ x: (view.clientWidth || 800) / 2, y: (view.clientHeight || 500) / 2 });
  bar.append(
    note,
    button('−', 'btn icon sm', () => zoomAt(scale / 1.25, centre().x, centre().y)),
    zoomText,
    button('+', 'btn icon sm', () => zoomAt(scale * 1.25, centre().x, centre().y)),
    button('Fit', 'btn sm', () => fit()),
  );
  for (const b of bar.querySelectorAll('button')) b.setAttribute('aria-label', b.textContent === '−' ? 'Zoom out' : b.textContent === '+' ? 'Zoom in' : 'Fit to view');

  view.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const r = view.getBoundingClientRect();
      zoomAt(scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX - r.left, e.clientY - r.top);
    },
    { passive: false },
  );
  let drag: { x: number; y: number; tx: number; ty: number } | null = null;
  view.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, tx, ty };
    view.classList.add('drag');
  });
  window.addEventListener('mousemove', (e) => {
    if (drag === null) return;
    tx = drag.tx + e.clientX - drag.x;
    ty = drag.ty + e.clientY - drag.y;
    apply();
  });
  window.addEventListener('mouseup', () => {
    drag = null;
    view.classList.remove('drag');
  });
  view.addEventListener('keydown', (e) => {
    const step = 40;
    if (e.key === 'ArrowLeft') tx += step;
    else if (e.key === 'ArrowRight') tx -= step;
    else if (e.key === 'ArrowUp') ty += step;
    else if (e.key === 'ArrowDown') ty -= step;
    else if (e.key === '+' || e.key === '=') return zoomAt(scale * 1.25, centre().x, centre().y);
    else if (e.key === '-') return zoomAt(scale / 1.25, centre().x, centre().y);
    else return;
    e.preventDefault();
    apply();
  });

  function paint(): void {
    layer.replaceChildren();
    if (layout === null) return;
    canvas.setAttribute('width', String(Math.max(layout.width, 1)));
    canvas.setAttribute('height', String(Math.max(layout.height, 1)));
    const edgeLayer = svg('g');
    const boxLayer = svg('g');
    layer.append(edgeLayer, boxLayer);
    const edgesOf = new Map<string, SVGPathElement[]>();
    for (const e of layout.edges) {
      const p = svg('path', 'db-dia-edge');
      attrs(p, { d: e.path });
      const t = svg('title');
      t.textContent = e.label;
      p.append(t);
      const end = svg('circle', 'db-dia-end');
      attrs(end, { cx: e.x2, cy: e.y2, r: 3 });
      edgeLayer.append(p, end);
      for (const n of [e.from, e.to]) edgesOf.set(n, [...(edgesOf.get(n) ?? []), p]);
    }
    for (const b of layout.boxes) {
      const g = svg('g', `db-dia-table${b.focus || b.name === picked ? ' on' : ''}${b.kind === 'view' ? ' view' : ''}`);
      g.setAttribute('data-table', b.name);
      const frame = svg('rect', 'db-dia-box');
      attrs(frame, { x: b.x, y: b.y, width: b.w, height: b.h, rx: 6 });
      const head = svg('rect', 'db-dia-head');
      attrs(head, { x: b.x, y: b.y, width: b.w, height: DIAGRAM.header, rx: 6 });
      const title = svg('text', 'db-dia-title');
      attrs(title, { x: b.x + 10, y: b.y + DIAGRAM.header / 2 + 4 });
      title.textContent = `${b.kind === 'view' ? '◇ ' : ''}${clip(b.name, NAME_CHARS)}`;
      const tip = svg('title');
      tip.textContent = `${b.name}${b.kind === 'view' ? ' (view)' : ''} — click to select, double-click to query`;
      g.append(tip, frame, head, title);
      b.columns.forEach((c, i) => {
        const y = b.y + DIAGRAM.header + DIAGRAM.row * i + DIAGRAM.row / 2 + 4;
        const key = svg('text', `db-dia-key${c.pk ? ' pk' : c.fk ? ' fk' : ''}`);
        attrs(key, { x: b.x + 8, y });
        key.textContent = c.pk ? 'PK' : c.fk ? 'FK' : '';
        const name = svg('text', 'db-dia-col');
        attrs(name, { x: b.x + 30, y });
        name.textContent = clip(c.name, NAME_CHARS - 4);
        const type = svg('text', 'db-dia-type');
        attrs(type, { x: b.x + b.w - 8, y, 'text-anchor': 'end' });
        type.textContent = clip(c.type.toLowerCase(), TYPE_CHARS);
        g.append(key, name, type);
      });
      if (b.more > 0) {
        const more = svg('text', 'db-dia-type');
        attrs(more, { x: b.x + 30, y: b.y + DIAGRAM.header + DIAGRAM.row * b.columns.length + DIAGRAM.row / 2 + 4 });
        more.textContent = `+${b.more} more`;
        g.append(more);
      }
      g.addEventListener('mousedown', (e) => e.stopPropagation());
      g.addEventListener('click', () => deps.onPick(b.name));
      g.addEventListener('dblclick', () => deps.onOpen(b.name));
      g.addEventListener('mouseenter', () => edgesOf.get(b.name)?.forEach((p) => p.classList.add('hot')));
      g.addEventListener('mouseleave', () => edgesOf.get(b.name)?.forEach((p) => p.classList.remove('hot')));
      boxLayer.append(g);
    }
  }

  return {
    root,
    /** 그림을 새로 그린다. focus: 고른 테이블(큰 스키마면 이 테이블과 이웃만) */
    show(graph: DbSchemaGraph, focus: string | null, refit = true): void {
      picked = focus;
      layout = DiagramLayout.of(graph, focus);
      const links = layout.edges.length;
      note.textContent = graph.tables.length === 0
        ? 'No tables to draw.'
        : layout.partial
          ? `${layout.focus ?? ''} and its ${layout.boxes.length - 1} related tables (of ${graph.tables.length}${graph.truncated ? '+' : ''}). Click a table to center it.`
          : `${layout.boxes.length} tables · ${links} relation${links === 1 ? '' : 's'}. Double-click a table to query it.`;
      paint();
      if (refit) requestAnimationFrame(() => fit());
    },
    clear(): void {
      layout = null;
      layer.replaceChildren();
      note.textContent = '';
    },
  };
}
