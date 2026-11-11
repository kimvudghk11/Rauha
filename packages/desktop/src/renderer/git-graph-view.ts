import type { GraphRow } from '../shared/git-graph.js';
import { el } from './dom.js';

const NS = 'http://www.w3.org/2000/svg';
/** 한 칸의 너비(px)와 그래프가 차지하는 최대 칸 수. 칸이 더 많은 줄기는 오른쪽 끝에서 잘린다. */
export const GRAPH_COL_PX = 14;
export const GRAPH_MAX_COLS = 8;

/** 모든 줄에 같은 폭을 주기 위한 칸 수(최대 GRAPH_MAX_COLS) */
export function graphCols(rows: readonly GraphRow[]): number {
  return Math.max(1, Math.min(GRAPH_MAX_COLS, rows.reduce((n, r) => Math.max(n, r.cols), 1)));
}

const x = (col: number): number => col * GRAPH_COL_PX + GRAPH_COL_PX / 2;

function line(d: string, color: number): SVGPathElement {
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', d);
  p.setAttribute('class', `gedge glc${color}`);
  return p;
}

/**
 * 커밋 줄 한 개의 그래프 칸: 위쪽 선(높이 0→1), 아래쪽 선(1→2), 가운데 점.
 * 선은 SVG(줄 높이에 맞춰 늘어난다), 점은 늘어나지 않게 따로 HTML 동그라미로 그린다. 색은 클래스(glc0~glc7)가 토큰에서 가져온다.
 */
export function graphCell(row: GraphRow, cols: number): HTMLElement {
  const cell = el('span', 'ggraph');
  cell.setAttribute('aria-hidden', 'true');
  const w = cols * GRAPH_COL_PX;
  cell.style.width = `${w}px`;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} 2`);
  svg.setAttribute('width', String(w));
  svg.setAttribute('preserveAspectRatio', 'none');
  const clamp = (c: number): number => Math.min(c, cols - 1);
  for (const e of row.top) svg.append(line(e.from === e.to ? `M${x(clamp(e.from))} 0V1` : `M${x(clamp(e.from))} 0C${x(clamp(e.from))} 0.6 ${x(clamp(e.to))} 0.4 ${x(clamp(e.to))} 1`, e.color));
  for (const e of row.bottom) svg.append(line(e.from === e.to ? `M${x(clamp(e.from))} 1V2` : `M${x(clamp(e.from))} 1C${x(clamp(e.from))} 1.6 ${x(clamp(e.to))} 1.4 ${x(clamp(e.to))} 2`, e.color));
  const dot = el('span', `gdot glc${row.color}${row.merge ? ' merge' : ''}`);
  dot.style.left = `${x(clamp(row.col)) - 5}px`;
  cell.append(svg, dot);
  return cell;
}
