/**
 * 작업 무대 배경과 소품 그리기(픽셀). 자리는 shared/scene-plan.ts 가 정하고 여기서는 모양만 그린다.
 * 소품은 기본 모양 몇 가지(기계·개수대·나무·탁자·선반·불·문·허수아비·물·의자)에 색을 입힌다. 높이는 10칸 이하.
 */
import type { CharacterSetId } from '../shared/character-set-ids.js';
import { sceneOf, type Station } from '../shared/scene-plan.js';

type Shape = 'machine' | 'basin' | 'tree' | 'table' | 'shelf' | 'fire' | 'door' | 'dummy' | 'water' | 'chair' | 'box' | 'plant' | 'board' | 'tower';

/** 소품 이름 → 모양과 색 */
const PROPS: Readonly<Record<string, readonly [Shape, string]>> = {
  'reef rock': ['box', '#3f5f74'], coral: ['plant', '#d8735f'], seaweed: ['plant', '#3f8f5a'], shipwreck: ['door', '#6a4a30'], 'treasure chest': ['box', '#b08a3a'], bubbles: ['water', '#7fc6e8'],
  campfire: ['fire', '#e8893a'], 'big tree': ['tree', '#2f6b3a'], mushrooms: ['plant', '#c45a4a'], stream: ['water', '#4f8fc0'], 'log bench': ['table', '#7a5434'], 'berry bush': ['plant', '#4a7a3a'],
  'barn door': ['door', '#8a3a2a'], field: ['plant', '#9aa83a'], well: ['basin', '#7a7a7a'], 'hay bale': ['box', '#c8a84a'], tractor: ['machine', '#3a7a3a'], 'chicken coop': ['door', '#9a7a4a'],
  'captain chair': ['chair', '#5a6a8a'], console: ['machine', '#3a6a9a'], airlock: ['door', '#6a7080'], window: ['board', '#1a2a5a'], rover: ['machine', '#9a8a6a'], antenna: ['tower', '#9aa0b0'],
  'meeting table': ['table', '#6a5040'], desk: ['table', '#7a5a40'], whiteboard: ['board', '#d8dde0'], 'server rack': ['tower', '#3a4048'], 'coffee corner': ['machine', '#5a3a2a'], printer: ['machine', '#9aa0a8'],
  throne: ['chair', '#b8902a'], 'training dummy': ['dummy', '#a8884a'], forge: ['fire', '#d8602a'], bookshelf: ['shelf', '#6a4a2a'], gate: ['door', '#5a5560'], 'war table': ['table', '#6a4a3a'],
  'teacher desk': ['table', '#7a5a3a'], desks: ['table', '#8a6a4a'], blackboard: ['board', '#2f5a3f'], locker: ['tower', '#4a6a8a'], library: ['shelf', '#6a4a2a'], 'science table': ['table', '#4a6a6a'],
  counter: ['table', '#7a4a2a'], 'coffee machine': ['machine', '#4a4a50'], sink: ['basin', '#9aa8b0'], oven: ['machine', '#5a3a30'], tables: ['table', '#8a6a4a'], 'menu board': ['board', '#2a2a2a'],
};

/** 배경: 벽(또는 하늘·물)과 바닥 색, 별 같은 점 */
const BG: Readonly<Record<CharacterSetId, { wall: string; floor: string; dots?: string }>> = {
  ocean: { wall: '#0d2a40', floor: '#8a7448', dots: '#4f8fb8' },
  forest: { wall: '#132a1c', floor: '#3b2c1c', dots: '#2f5a3a' },
  farm: { wall: '#27486a', floor: '#3f6a2c' },
  space: { wall: '#0a0b1c', floor: '#2f3346', dots: '#c8d0ff' },
  office: { wall: '#262a31', floor: '#3e352e' },
  fantasy: { wall: '#29253a', floor: '#4a4656', dots: '#3a3550' },
  school: { wall: '#25392d', floor: '#5a442c' },
  cafe: { wall: '#2e221a', floor: '#5e4530' },
};

function shade(hex: string, k: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const ch = (s: number) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * k)));
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

/** 한 소품: (cx, 바닥 y) 기준으로 아래에서 위로 */
function drawProp(px: (x: number, y: number, w: number, h: number, c: string) => void, shape: Shape, cx: number, gy: number, c: string, tick: number): void {
  const dark = shade(c, 0.65);
  const lite = shade(c, 1.3);
  switch (shape) {
    case 'machine':
      px(cx - 4, gy - 8, 8, 8, c); px(cx - 3, gy - 7, 6, 2, lite); px(cx + 1, gy - 4, 2, 2, (tick >> 2) % 2 === 0 ? '#e8c84a' : dark); px(cx - 3, gy - 4, 2, 3, dark);
      break;
    case 'basin':
      px(cx - 5, gy - 5, 10, 2, lite); px(cx - 4, gy - 3, 8, 3, c); px(cx + 2, gy - 8, 1, 3, dark);
      break;
    case 'tree':
      px(cx - 1, gy - 5, 2, 5, '#5a3a22'); px(cx - 5, gy - 10, 10, 5, c); px(cx - 3, gy - 12, 6, 2, lite);
      break;
    case 'table':
      px(cx - 6, gy - 5, 12, 2, c); px(cx - 5, gy - 3, 1, 3, dark); px(cx + 4, gy - 3, 1, 3, dark);
      break;
    case 'shelf':
      px(cx - 4, gy - 10, 8, 10, dark); for (let r = 0; r < 3; r++) px(cx - 3, gy - 9 + r * 3, 6, 2, r % 2 === 0 ? '#a8584a' : '#4a7aa8');
      break;
    case 'fire': {
      const f = (tick >> 1) % 2;
      px(cx - 4, gy - 1, 8, 1, '#5a3a22'); px(cx - 2, gy - 4 - f, 4, 3 + f, c); px(cx - 1, gy - 6 - f, 2, 2, '#f8d86a');
      break;
    }
    case 'door':
      px(cx - 4, gy - 10, 8, 10, c); px(cx - 3, gy - 9, 6, 9, dark); px(cx + 1, gy - 5, 1, 1, lite);
      break;
    case 'dummy':
      px(cx, gy - 9, 1, 9, '#5a3a22'); px(cx - 3, gy - 7, 7, 1, '#5a3a22'); px(cx - 2, gy - 9, 5, 4, c); px(cx - 1, gy - 11, 3, 2, lite);
      break;
    case 'water': {
      const b = tick % 12;
      px(cx - 5, gy - 1, 10, 1, c); px(cx - 2, gy - 3 - (b >> 2), 1, 1, lite); px(cx + 2, gy - 6 + (b >> 2), 1, 1, lite);
      break;
    }
    case 'chair':
      px(cx - 3, gy - 10, 6, 6, c); px(cx - 4, gy - 4, 8, 2, lite); px(cx - 4, gy - 2, 1, 2, dark); px(cx + 3, gy - 2, 1, 2, dark);
      break;
    case 'box':
      px(cx - 4, gy - 5, 8, 5, c); px(cx - 4, gy - 5, 8, 1, lite); px(cx - 1, gy - 4, 2, 1, dark);
      break;
    case 'plant':
      px(cx - 1, gy - 4, 1, 4, c); px(cx + 1, gy - 6, 1, 6, c); px(cx + 3, gy - 3, 1, 3, lite); px(cx - 3, gy - 5, 1, 5, lite);
      break;
    case 'board':
      px(cx - 6, gy - 11, 12, 7, dark); px(cx - 5, gy - 10, 10, 5, c); px(cx - 1, gy - 4, 1, 4, dark);
      break;
    case 'tower':
      px(cx - 2, gy - 11, 5, 11, c); for (let r = 0; r < 4; r++) px(cx - 1, gy - 10 + r * 3, 3, 1, (tick + r) % 4 === 0 ? '#6ad86a' : lite);
      break;
  }
}

type Px = (x: number, y: number, w: number, h: number, c: string) => void;

/** 시간대(작업마다 고른다): 0 낮, 1 저녁, 2 밤. 벽 밝기와 하늘 색에 쓴다 */
const LIGHT = [1.25, 0.95, 0.7] as const;

/** 왼쪽→오른쪽으로 흘러가는 위치(칸). speed 는 걸음당 칸, offset 은 시작 자리 */
const drift = (tick: number, speed: number, cols: number, offset: number, span = 12): number => ((Math.floor(tick * speed) + offset) % (cols + span)) - span / 2;

/**
 * 컨셉마다 늘 조금씩 움직이는 배경(물고기·반딧불·구름·별똥별·창밖 도시·김·횃불 …). 소품 뒤, 팀원 뒤에 그린다.
 * variant 는 시간대(LIGHT)이고, 같은 작업이면 같은 시간대다.
 */
function drawAmbient(px: Px, id: CharacterSetId, cols: number, ground: number, tick: number, variant: number): void {
  const night = variant === 2;
  const dusk = variant === 1;
  switch (id) {
    case 'ocean': {
      // 빛줄기, 오가는 물고기 셋, 올라가는 거품
      for (let i = 0; i < 3; i++) px((cols * (i + 1)) / 4 + Math.round(Math.sin((tick + i * 20) / 18) * 2), 0, 2, ground - 4, night ? '#0f3048' : '#16405a');
      for (let i = 0; i < 3; i++) {
        const x = drift(tick, 0.35 + i * 0.15, cols, i * 37);
        const y = 3 + i * 4;
        const c = ['#f0a040', '#e86a8a', '#6ad0e0'][i]!;
        px(x, y, 3, 2, c); px(x - 1, y, 1, 2, c); px(x + 2, y, 1, 1, '#10202a');
      }
      for (let i = 0; i < 4; i++) px((i * 53 + 11) % cols, ground - 2 - ((tick + i * 9) % (ground - 2)), 1, 1, '#a8e0f8');
      break;
    }
    case 'forest': {
      if (night) for (let i = 0; i < 7; i++) if ((tick + i * 5) % 14 < 9) px((i * 41 + Math.round(Math.sin((tick + i * 13) / 9) * 3)) % cols, 3 + ((i * 7) % (ground - 8)), 1, 1, '#e8f070');
      else for (let i = 0; i < 4; i++) px((i * 47 + Math.round(Math.sin((tick + i * 11) / 7) * 2)) % cols, (tick + i * 15) % ground, 1, 1, dusk ? '#d87a3a' : '#7aa84a');
      // 뒤쪽 나무 그림자
      for (let x = 4; x < cols; x += 23) px(x, ground - 9, 3, 9, '#0f2216');
      break;
    }
    case 'farm': {
      // 해·달, 흘러가는 구름, 가끔 나는 새
      px(cols - 14, 2, 4, 4, night ? '#e8e8d0' : dusk ? '#f08a3a' : '#f8d84a');
      for (let i = 0; i < 3; i++) {
        const x = drift(tick, 0.12 + i * 0.05, cols, i * 61, 20);
        px(x, 3 + i * 2, 8, 2, night ? '#5a6a8a' : '#f0f4f8'); px(x + 2, 2 + i * 2, 4, 1, night ? '#5a6a8a' : '#f0f4f8');
      }
      if (!night && tick % 200 < 80) { const x = drift(tick, 0.9, cols, 0); px(x, 6 + ((tick >> 2) % 2), 1, 1, '#2a2a2a'); px(x + 1, 5, 1, 1, '#2a2a2a'); px(x + 2, 6 + ((tick >> 2) % 2), 1, 1, '#2a2a2a'); }
      break;
    }
    case 'space': {
      // 반짝이는 별, 행성, 가끔 별똥별
      for (let i = 0; i < cols; i += 7) if ((i + tick) % 23 !== 0) px(i + ((i * 5) % 3), (i * 11) % Math.max(1, ground - 5), 1, 1, (i + tick) % 17 === 0 ? '#ffffff' : '#8890c8');
      px(Math.round(cols * 0.62), 2, 5, 5, dusk ? '#c87a5a' : '#6a5aa8'); px(Math.round(cols * 0.62) - 1, 4, 7, 1, '#b8a8e8');
      const fall = tick % 90;
      if (fall < 12) px(cols - 10 - fall * 3, 1 + fall, 2, 1, '#ffffff');
      break;
    }
    case 'office': {
      // 창밖 도시(밤엔 불 켜진 창), 벽시계
      const wx = Math.round(cols * 0.18);
      const ww = Math.min(30, Math.round(cols * 0.22));
      px(wx, 2, ww, 9, night ? '#0e1630' : dusk ? '#e89a6a' : '#8ac0e8');
      for (let b = 0; b < ww; b += 4) {
        const h = 3 + ((b * 7) % 5);
        px(wx + b, 11 - h, 3, h, night ? '#1a2238' : '#4a5668');
        if (night && (b + tick) % 9 < 6) px(wx + b + 1, 11 - h + 1, 1, 1, '#f8d86a');
      }
      const cx = Math.round(cols * 0.62);
      px(cx, 2, 5, 5, '#d8dde0'); px(cx + 2, 3, 1, 2, '#2a2a2a'); px(cx + 2 + ((tick >> 4) % 2), 4, 1, 1, '#c84a3a');
      break;
    }
    case 'school': {
      // 창문, 종이비행기, 시계
      const wx = Math.round(cols * 0.8);
      px(wx, 2, 12, 8, night ? '#1a2a4a' : dusk ? '#e8a06a' : '#9ad0f0'); px(wx + 5, 2, 1, 8, '#5a442c'); px(wx, 6, 12, 1, '#5a442c');
      if (tick % 160 < 70) { const t = tick % 160; px(Math.round(cols * 0.15) + t, 4 + Math.round(Math.sin(t / 6) * 2), 3, 1, '#f8f8f8'); }
      px(Math.round(cols * 0.45), 2, 4, 4, '#e8e0c8'); px(Math.round(cols * 0.45) + 1 + ((tick >> 5) % 2), 3, 1, 1, '#2a2a2a');
      break;
    }
    case 'cafe': {
      // 매달린 조명(밤엔 더 밝게), 컵에서 오르는 김
      for (let x = 10; x < cols; x += 26) { px(x, 0, 1, 3, '#3a2a20'); px(x - 1, 3, 3, 2, night || dusk ? '#f8d070' : '#c8a060'); }
      const cx = Math.round(cols / 2);
      for (let i = 0; i < 3; i++) px(cx - 2 + i * 2 + Math.round(Math.sin((tick + i * 4) / 4)), ground - 7 - ((tick + i * 3) % 5), 1, 1, '#e8e0d8');
      break;
    }
    case 'fantasy': {
      // 깃발과 흔들리는 횃불
      for (let x = 8; x < cols; x += 30) {
        px(x, 3, 1, 6, '#5a3a22');
        const f = (tick + x) % 3;
        px(x - 1, 1 - (f === 0 ? 1 : 0), 3, 2, '#f08a2a'); px(x, 0 + (f === 2 ? 1 : 0), 1, 1, '#f8e06a');
      }
      for (let x = 22; x < cols; x += 30) { px(x, 2, 5, 6, dusk ? '#7a2a3a' : '#3a4a8a'); px(x + 1, 7 + ((tick >> 3) % 2), 3, 1, dusk ? '#7a2a3a' : '#3a4a8a'); px(x + 2, 4, 1, 1, '#e8c84a'); }
      break;
    }
  }
}

/**
 * 배경(벽·바닥·점·움직이는 배경)과 소품을 그린다. cols·rows 는 칸 수, scale 은 칸 하나의 화면 픽셀.
 * variant 는 작업마다 고르는 시간대(0 낮, 1 저녁, 2 밤)
 */
export function drawScene(ctx: CanvasRenderingContext2D, id: CharacterSetId, cols: number, rows: number, scale: number, tick: number, variant = 0): void {
  const bg = BG[id];
  const px: Px = (x, y, w, h, c) => {
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(x) * scale, Math.round(y) * scale, w * scale, h * scale);
  };
  const ground = rows - 1;
  const v = Math.abs(variant) % LIGHT.length;
  px(0, 0, cols, ground, shade(bg.wall, LIGHT[v]!));
  px(0, ground, cols, rows - ground, bg.floor);
  if (bg.dots !== undefined) for (let i = 0; i < cols; i += 9) px(i + ((i * 7) % 5), (i * 3) % Math.max(1, ground - 6), 1, 1, bg.dots);
  drawAmbient(px, id, cols, ground, tick, v);
  const s = sceneOf(id);
  const all: Station[] = [s.center, ...s.stations];
  for (const st of all) {
    const prop = PROPS[st.label];
    if (prop !== undefined) drawProp(px, prop[0], Math.round(st.x * cols), ground, prop[1], tick);
  }
}
