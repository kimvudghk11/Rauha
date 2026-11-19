/**
 * 작업 무대의 장면(순수 규칙): 컨셉마다 가운데 자리 + 소품 다섯 곳, 팀원은 맡은 일에 맞는 두 소품 사이를 오간다.
 * 그림은 renderer/scene-draw.ts 가 그린다. 여기서는 자리(가로 비율)와 시간에 따른 위치만 정한다.
 */
import type { CharacterSetId } from './character-set-ids.js';

export interface Station {
  readonly id: string;
  readonly label: string;
  /** 무대 너비에 대한 가로 비율(0~1) */
  readonly x: number;
}

export interface Scene {
  readonly center: Station;
  readonly stations: readonly Station[];
}

const st = (id: string, label: string, x: number): Station => ({ id, label, x });
const XS = [0.1, 0.27, 0.73, 0.9, 0.38] as const;
const scene = (center: [string, string], labels: readonly [string, string, string, string, string]): Scene => ({
  center: st(center[0], center[1], 0.5),
  stations: labels.map((l, i) => st(l.replace(/\s+/g, '-'), l, XS[i]!)),
});

const SCENES: Readonly<Record<CharacterSetId, Scene>> = {
  ocean: scene(['reef', 'reef rock'], ['coral', 'seaweed', 'shipwreck', 'treasure chest', 'bubbles']),
  forest: scene(['campfire', 'campfire'], ['big tree', 'mushrooms', 'stream', 'log bench', 'berry bush']),
  farm: scene(['barn', 'barn door'], ['field', 'well', 'hay bale', 'tractor', 'chicken coop']),
  space: scene(['bridge', 'captain chair'], ['console', 'airlock', 'window', 'rover', 'antenna']),
  office: scene(['meeting', 'meeting table'], ['desk', 'whiteboard', 'server rack', 'coffee corner', 'printer']),
  fantasy: scene(['throne', 'throne'], ['training dummy', 'forge', 'bookshelf', 'gate', 'war table']),
  school: scene(['podium', 'teacher desk'], ['desks', 'blackboard', 'locker', 'library', 'science table']),
  cafe: scene(['counter', 'counter'], ['coffee machine', 'sink', 'oven', 'tables', 'menu board']),
};

/**
 * 역할 → 오가는 두 소품(번호). 만드는 일은 0↔1, 확인하는 일은 4↔2, 쓰는·꾸미는 일은 2↔3, 계획은 4↔3,
 * 돈·물건·고객을 다루는 일은 1↔4·3↔0·2↔4 로 흩어 같은 길만 다니지 않게 한다.
 */
const ROLE_PAIRS: Readonly<Record<string, readonly [number, number]>> = {
  implementer: [0, 1], debugger: [0, 1], operator: [0, 1], splitter: [0, 1], frontend: [0, 1], backend: [1, 0], ios: [0, 1], android: [1, 0], crossplatform: [0, 1], dataengineer: [1, 0],
  tester: [4, 2], reviewer: [4, 2], riskchecker: [4, 2], securitychecker: [2, 4], qa: [4, 2], legal: [2, 4],
  writer: [2, 3], designer: [2, 3], uxdesigner: [2, 3], brand: [3, 2], marketer: [2, 3], publisher: [2, 3], content: [3, 2], copywriter: [2, 3], video: [3, 2], graphic: [2, 3], productdesigner: [3, 2], pr: [2, 3],
  planner: [4, 3], chief: [4, 3], router: [4, 3], surveyor: [4, 3], answerer: [4, 3], bm: [4, 3], growth: [4, 3], releaser: [4, 3], pm: [3, 4], md: [4, 3], analyst: [3, 4], performance: [4, 3], sales: [3, 4], recruiter: [4, 3],
  accountant: [3, 0], finops: [0, 3], ecommerce: [1, 4], logistics: [4, 1], support: [2, 4], voc: [4, 2],
};

export function sceneOf(id: CharacterSetId): Scene {
  return SCENES[id];
}

/** 그 역할에 정해 둔 소품 쌍이 있는지(없으면 0↔3 으로 간다) */
export function hasStations(role: string): boolean {
  return ROLE_PAIRS[role] !== undefined;
}

/** 그 역할이 오가는 두 소품(팀장은 가운데 한 곳) */
export function stationsFor(id: CharacterSetId, role: string): Station[] {
  const s = SCENES[id];
  if (role === 'intake') return [s.center];
  const [a, b] = ROLE_PAIRS[role] ?? [0, 3];
  return [s.stations[a]!, s.stations[b]!];
}

/** 같은 입력이면 같은 수(팀원마다 박자를 다르게 할 때 쓴다) */
function hashOf(text: string): number {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

interface Segment {
  readonly from: number;
  readonly to: number;
  readonly len: number;
}

/**
 * 한 팀원의 세 바퀴 길(세 바퀴마다 같은 길을 되풀이한다). 두 바퀴는 두 소품을 오가고, 한 바퀴는 가운데(팀장 자리)에
 * 들러 잠깐 모였다 간다. 머무는 시간과 걷는 빠르기는 팀원마다(역할·순서) 다르다. 걷는 동안은 고르게 지나간다.
 */
function route(a: number, b: number, center: number, cols: number, h: number): Segment[] {
  const speed = cols / (26 + (h % 15));
  const walk = (from: number, to: number): Segment => ({ from, to, len: Math.max(1, Math.ceil(Math.abs(to - from) / speed)) });
  const stay = (x: number, len: number): Segment => ({ from: x, to: x, len });
  const dwell = (lap: number, k: number): number => 16 + ((h >> (lap * 4 + k)) % 22);
  const huddleLap = h % 3;
  const out: Segment[] = [];
  for (let lap = 0; lap < 3; lap++) {
    out.push(stay(a, dwell(lap, 0)));
    if (lap === huddleLap) out.push(walk(a, center), stay(center, 10 + (h % 9)), walk(center, b));
    else out.push(walk(a, b));
    out.push(stay(b, dwell(lap, 1)), walk(b, a));
  }
  return out;
}

/**
 * 시간(tick)에 따른 왼쪽 위치(칸). 팀원마다 시작 시점·박자·들르는 바퀴가 다르다(index·역할).
 * 걷는 동안은 두 자리 사이를 고르게 지나간다(순간이동 없음). 무대 밖으로 나가지 않는다.
 */
export function actorX(id: CharacterSetId, role: string, index: number, tick: number, cols: number, width: number): number {
  const spots = stationsFor(id, role);
  const clamp = (x: number): number => Math.max(0, Math.min(cols - width, Math.round(x)));
  const at = (s: Station): number => s.x * cols - width / 2;
  if (spots.length === 1) return clamp(at(spots[0]!));
  const h = hashOf(`${role}:${index}`);
  const path = route(at(spots[0]!), at(spots[1]!), at(SCENES[id].center), cols, h);
  const period = path.reduce((n, s) => n + s.len, 0);
  let t = (tick + index * 23 + (h % 41)) % period;
  for (const s of path) {
    if (t < s.len) return clamp(s.from + ((s.to - s.from) * t) / s.len);
    t -= s.len;
  }
  return clamp(path[0]!.from);
}
