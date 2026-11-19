import type { CharacterArt, CharacterRole, CharacterState } from './characters.js';
import { pixelArt } from './pixel-art.js';
import { layoutRow } from './stage-layout.js';
import type { CharacterSetId } from '../shared/character-set-ids.js';
import { actorX } from '../shared/scene-plan.js';
import { drawScene } from './scene-draw.js';

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
  /** 컨셉 배경을 깔고 팀원이 소품 사이를 오가게 할지(작업 카드 무대) */
  readonly scene: (() => CharacterSetId) | null;
  /** 작업마다 고르는 배경 시간대(0 낮, 1 저녁, 2 밤) */
  readonly variant: () => number;
  cols: number;
  visible: boolean;
  /** 부모 크기 관찰을 시작했는지(붙기 전에 등록된 캔버스는 붙은 뒤에 시작한다) */
  observed: boolean;
  /** 아직 화면에 붙지 않은 채 지나간 걸음 수 */
  waiting: number;
}

const mounted = new Set<Mounted>();
const STEP_MS = 120;
/** 붙기 전에 등록된 캔버스를 기다려 주는 걸음 수(약 12초) */
const WAIT_STEPS = 100;
/** 붙었다가 떨어진(다른 탭) 캔버스를 기다려 주는 걸음 수(약 30분) */
const DETACHED_STEPS = 15_000;
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

/** 화면에 붙은 fit 캔버스의 부모를 관찰하고 지금 너비로 한 번 맞춘다(한 번만) */
function watchParent(m: Mounted): void {
  if (m.observed || !m.canvas.isConnected) return;
  if (!m.fit || m.canvas.parentElement === null) {
    m.observed = true;
    return;
  }
  m.observed = true;
  resizer.observe(m.canvas.parentElement);
  resize(m, m.canvas.parentElement.clientWidth);
}

function draw(m: Mounted): void {
  const ctx = m.canvas.getContext('2d');
  if (ctx === null) return;
  ctx.clearRect(0, 0, m.canvas.width, m.canvas.height);
  const actors = m.actors();
  // 장면 무대: 배경·소품을 깔고, 팀원은 맡은 일의 두 소품 사이를 걸어 다닌다(팀장은 가운데)
  if (m.scene !== null && m.cols >= 40) {
    const id = m.scene();
    drawScene(ctx, id, m.cols, m.rows, m.scale, tick, m.variant());
    actors.forEach((a, i) => {
      const { w, h } = art.size(a.role);
      art.draw(ctx, a.role, a.state, tick, { x: actorX(id, a.role, i, tick, m.cols, w), y: m.rows - 1 - h, scale: m.scale, seed: i });
    });
    return;
  }
  // 뒤에 서는 줄이 없어서 순서대로 한 줄에 선다. 칸 수가 모자라거나 아직 모르면 겹치지 않을 만큼 늘린다.
  const sizes = actors.map((a) => art.size(a.role));
  const row = layoutRow(m.cols, sizes.map((s) => s.w));
  if (row.cols !== m.cols) {
    m.cols = row.cols;
    m.canvas.width = row.cols * m.scale;
    m.canvas.style.width = `${row.cols * m.scale}px`;
  }
  actors.forEach((a, i) => {
    const { h } = sizes[i]!;
    art.draw(ctx, a.role, a.state, tick, { x: row.xs[i]!, y: m.rows - 1 - h, scale: m.scale, seed: i });
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
        // 다른 탭에 갔다 오면 채팅 화면이 잠깐 떨어진다. 그때 지우면 돌아와도 무대가 굳어 있다(컨셉을 바꿔도 그대로).
        // 그래서 떨어져 있는 동안은 건너뛰기만 하고, 한 번도 안 붙었으면 약 12초, 붙었던 것은 약 30분 뒤에 치운다.
        if ((m.waiting += 1) > (m.observed ? DETACHED_STEPS : WAIT_STEPS)) {
          visibility.unobserve(m.canvas);
          mounted.delete(m);
        }
        continue;
      }
      m.waiting = 0;
      watchParent(m);
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
export function mountStage(canvas: HTMLCanvasElement, options: { scale: number; rows: number; actors: () => readonly Actor[]; fit?: boolean; scene?: () => CharacterSetId; variant?: () => number }): { redraw(): void } {
  const m: Mounted = { canvas, scale: options.scale, actors: options.actors, fit: options.fit === true, rows: options.rows, scene: options.scene ?? null, variant: options.variant ?? (() => 0), cols: 0, visible: true, observed: false, waiting: 0 };
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
  watchParent(m);
  if (m.fit) queueMicrotask(() => watchParent(m));
  draw(m);
  return { redraw: () => draw(m) };
}

/** 한 번만 그리는 작은 캐릭터(말풍선 옆 얼굴). 움직이지 않으니 등록하지 않는다. */
/** 한 번 그린 캔버스들(약한 참조). 캐릭터 컨셉이 바뀌면 repaintAll 이 모두 새 컨셉으로 다시 그린다 */
const painted = new Set<WeakRef<HTMLCanvasElement>>();
const paintedArgs = new WeakMap<HTMLCanvasElement, { role: CharacterRole; scale: number; state: CharacterState }>();

/** 지금까지 paintOnce 로 그린 캐릭터를 모두 다시 그린다(다른 탭에 떼어 둔 것도). 사라진 캔버스는 목록에서 뺀다 */
export function repaintAll(): void {
  for (const ref of [...painted]) {
    const c = ref.deref();
    const a = c === undefined ? undefined : paintedArgs.get(c);
    if (c === undefined || a === undefined) {
      painted.delete(ref);
      continue;
    }
    drawStill(c, a.role, a.scale, a.state);
  }
}

export function paintOnce(canvas: HTMLCanvasElement, role: CharacterRole, scale: number, state: CharacterState = 'idle'): void {
  if (!paintedArgs.has(canvas)) painted.add(new WeakRef(canvas));
  paintedArgs.set(canvas, { role, scale, state });
  drawStill(canvas, role, scale, state);
}

function drawStill(canvas: HTMLCanvasElement, role: CharacterRole, scale: number, state: CharacterState): void {
  const { w, h } = art.size(role);
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;
  art.draw(ctx, role, state, 5, { x: 0, y: 0, scale, effects: false });
}
