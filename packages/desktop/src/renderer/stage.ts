import type { CharacterArt, CharacterRole, CharacterState } from './characters.js';
import { pixelArt } from './pixel-art.js';

/** 그림 공급자. 수채화 PNG로 바꿀 때는 이 한 줄만 바꾼다. */
let art: CharacterArt = pixelArt;
export function useArt(next: CharacterArt): void {
  art = next;
}
export const characterSize = (role: CharacterRole) => art.size(role);

export interface Actor {
  readonly role: CharacterRole;
  readonly state: CharacterState;
}

interface Mounted {
  readonly canvas: HTMLCanvasElement;
  readonly scale: number;
  readonly actors: () => readonly Actor[];
  /** 0이면 내용에 맞춘 고정 크기, 아니면 부모 너비에 맞춰 칸 수를 늘린다 */
  readonly fit: boolean;
  readonly rows: number;
  cols: number;
  visible: boolean;
}

const mounted = new Set<Mounted>();
const STEP_MS = 120;
let lastStep = 0;
let tick = 0;

const visibility = new IntersectionObserver((entries) => {
  for (const e of entries) for (const m of mounted) if (m.canvas === e.target) m.visible = e.isIntersecting;
});
const resizer = new ResizeObserver((entries) => {
  for (const e of entries) for (const m of mounted) if (m.fit && m.canvas.parentElement === e.target) resize(m, e.contentRect.width);
});

function resize(m: Mounted, px: number): void {
  const cols = Math.max(12, Math.floor(px / m.scale));
  if (cols === m.cols) return;
  m.cols = cols;
  m.canvas.width = cols * m.scale;
  m.canvas.style.width = `${cols * m.scale}px`;
  draw(m);
}

function draw(m: Mounted): void {
  const ctx = m.canvas.getContext('2d');
  if (ctx === null) return;
  ctx.clearRect(0, 0, m.canvas.width, m.canvas.height);
  const actors = m.actors();
  const gap = m.cols / (actors.length + 1);
  // 뒤에 서는 줄이 없어서 순서대로 한 줄에 선다
  actors.forEach((a, i) => {
    const { w, h } = art.size(a.role);
    art.draw(ctx, a.role, a.state, tick, { x: Math.round(gap * (i + 1) - w / 2), y: m.rows - 1 - h, scale: m.scale, seed: i });
  });
}

/**
 * 움직임은 requestAnimationFrame 하나로 모은다. 120ms 걸음마다 한 번, 화면에 보이는 캔버스만 그린다.
 * 화면에서 떨어진 캔버스는 목록에서 치운다(쌓이지 않는다). 창이 가려지면 rAF가 멈춰 아무것도 하지 않는다.
 */
function frame(now: number): void {
  if (now - lastStep >= STEP_MS) {
    lastStep = now;
    tick += 1;
    for (const m of [...mounted]) {
      if (!m.canvas.isConnected) {
        visibility.unobserve(m.canvas);
        mounted.delete(m);
        continue;
      }
      if (m.visible) draw(m);
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/**
 * 캐릭터를 그릴 캔버스를 등록한다. scale은 정수(흐려지지 않게). rows는 칸 높이.
 * fit이면 부모 너비를 채우고 캐릭터가 고르게 선다.
 */
export function mountStage(canvas: HTMLCanvasElement, options: { scale: number; rows: number; actors: () => readonly Actor[]; fit?: boolean }): { redraw(): void } {
  const m: Mounted = { canvas, scale: options.scale, actors: options.actors, fit: options.fit === true, rows: options.rows, cols: 0, visible: true };
  canvas.height = options.rows * options.scale;
  canvas.style.height = `${options.rows * options.scale}px`;
  if (!m.fit) {
    const widest = Math.max(...options.actors().map((a) => art.size(a.role).w * 2), 12);
    m.cols = widest;
    canvas.width = widest * options.scale;
    canvas.style.width = `${widest * options.scale}px`;
  }
  mounted.add(m);
  visibility.observe(canvas);
  if (m.fit) queueMicrotask(() => canvas.parentElement !== null && (resizer.observe(canvas.parentElement), resize(m, canvas.parentElement.clientWidth)));
  draw(m);
  return { redraw: () => draw(m) };
}

/** 한 번만 그리는 작은 캐릭터(말풍선 옆 얼굴). 움직이지 않으니 등록하지 않는다. */
export function paintOnce(canvas: HTMLCanvasElement, role: CharacterRole, scale: number, state: CharacterState = 'idle'): void {
  const { w, h } = art.size(role);
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;
  art.draw(ctx, role, state, 5, { x: 0, y: 0, scale, effects: false });
}
