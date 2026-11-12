import { ROLE_INFO, type MemberRole, type PermissionRequest } from '@rauha/core';
import { gaugeLevel, gaugeParts, type GaugeLevel } from './gauge.js';
import { displayWidth, fitLines, wrapText } from './text-width.js';

export { displayWidth };

/** 터미널에 그리는 rauha 캐릭터 Delfi(돌고래). 한 칸 = 픽셀 위아래 두 개(▀). */
export type Face = 'hello' | 'done' | 'stuck' | 'ask';
export type Pixels = (string | null)[][];

/**
 * 그림 16칸 + 오른쪽 6칸은 반짝이·땀·물음표 자리.
 * 줄의 마지막 칸은 위아래 픽셀 중 하나만 칠한다. 배경색이 있으면 cmd 창 크기를 바꿀 때 그 배경이 줄 끝까지 번진다.
 */
const WIDTH = 22;

const COLORS: Readonly<Record<string, string>> = {
  B: '#6FBDEB', S: '#4596CC', H: '#C4E8FF', L: '#DDF2FF',
  E: '#1D2B3A', W: '#FFFFFF', M: '#1D2B3A', P: '#F7A9C2', Y: '#FFDB7A', R: '#7CC4F0',
};

const BODY = [
  '........S.......',
  '.......SBS......',
  '.....HBBBBB.....',
  '...HBBBBBBBBB...',
  '..HBBBBBBBBBBB..',
  '.HBBBBBBBBBBBBB.',
  '.BBBBBBBBBBBBBB.',
  '.BBBBBBBBBBBBBB.',
  '.BBBBBBBBBBBBBB.',
  'SBBBBLLLLLLBBBBS',
  'SSBBLLLLLLLLBBSS',
  '..BBBLLLLLLBBB..',
  '...SBBLLLLBBS...',
  '.....SSSSSS.....',
];
const EYES: readonly [x: number, y: number][] = [[4, 6], [10, 6]];
const MOUTH: readonly [x: number, y: number] = [6, 10];
const BLUSH: readonly [x: number, y: number][] = [[2, 9], [3, 9], [12, 9], [13, 9]];

type Stamp = readonly string[];
const OPEN: Stamp = ['WE.', 'EE.', 'EE.'];
const HAPPY: Stamp = ['...', '.E.', 'E.E'];

interface FaceSpec {
  /** 왼쪽·오른쪽 눈 */
  readonly eyes: readonly [Stamp, Stamp];
  /** 3칸짜리 ^ 눈은 왼쪽 눈을 한 칸 당겨야 좌우가 맞는다. */
  readonly shiftLeftEye: boolean;
  readonly mouth: Stamp;
  readonly blush: boolean;
  readonly extra: readonly [color: string, points: readonly [number, number][]] | null;
}

const FACES: Readonly<Record<Face, FaceSpec>> = {
  hello: { eyes: [OPEN, OPEN], shiftLeftEye: false, mouth: ['M..M', '.MM.'], blush: false, extra: null },
  done: {
    eyes: [HAPPY, HAPPY], shiftLeftEye: true, mouth: ['M..M', '.MM.'], blush: true,
    extra: ['Y', [[19, 0], [18, 1], [19, 1], [20, 1], [19, 2], [17, 4]]],
  },
  stuck: {
    eyes: [['E..', '.E.', 'E..'], ['.E.', 'E..', '.E.']], shiftLeftEye: false, mouth: ['M.M.', '.M.M'], blush: false,
    extra: ['R', [[16, 2], [16, 3], [17, 3], [16, 4], [17, 4]]],
  },
  ask: {
    eyes: [OPEN, OPEN], shiftLeftEye: false, mouth: ['.MM.'], blush: false,
    extra: ['Y', [[18, 0], [19, 0], [20, 0], [21, 1], [20, 2], [19, 3], [19, 5]]],
  },
};

/**
 * 대화 화면에서 팀원이 일하는 동안 옆에 두는 작은 Delfi. 몸은 10×8 픽셀이고 10×10 도화지(= 5줄) 위를 움직인다.
 *
 * 줄마다 마지막으로 칠한 칸은 위아래 중 하나만 칠해야 한다(cmd 창 크기를 바꿀 때 배경색이 줄 끝까지 번지지 않게).
 * 한 줄은 위아래 두 픽셀 줄을 묶으므로, 이웃한 두 픽셀 줄의 가장 오른쪽 칸이 서로 달라야 한다.
 * 몸이 위아래로 움직이면 짝이 바뀌어서 어느 짝에서도 성립해야 해서, 눈 줄에 지느러미 끝 한 픽셀(S)을 더 뒀다.
 */
const MINI = [
  '....S.....',
  '...HBB....',
  '..HBBBB...',
  '.HEBBEBS..',
  '.BBBBBB...',
  'SBLLLLBS..',
  '.SBLLBS...',
  '..SSSS....',
];
const MINI_COLS = 10;
const MINI_ROWS = 10;
/** 몸이 도화지 위에서 내려온 칸 수. 틱 3번마다 다음 값으로 바뀐다(둥실). */
const MINI_BOB = [1, 0, 1, 2] as const;
/** 틱 3번을 한 걸음으로 센다. 120ms 틱이면 한 걸음이 약 0.36초다. */
const TICKS_PER_STEP = 3;
/** 이 걸음 수마다 한 걸음 동안 눈을 감는다 */
const BLINK_EVERY_STEPS = 8;

/** 작은 Delfi의 tick번째 모습: 위아래로 둥실, 가끔 눈 깜빡임, 오른쪽에서 올라가는 물방울 두 개. */
export function paintMiniDelfi(tick = 0): Pixels {
  const step = Math.floor(tick / TICKS_PER_STEP);
  const offset = MINI_BOB[step % MINI_BOB.length]!;
  const blink = step % BLINK_EVERY_STEPS === BLINK_EVERY_STEPS - 1;
  const px: Pixels = Array.from({ length: MINI_ROWS }, () => Array<string | null>(MINI_COLS).fill(null));
  MINI.forEach((row, r) =>
    [...row].forEach((k, x) => {
      if (k !== '.') px[r + offset]![x] = COLORS[blink && k === 'E' ? 'S' : k]!;
    }),
  );
  // 물방울: 몸 오른쪽(8·9칸)에서 한 칸씩 올라간다. 둘은 5줄 떨어져 있어 한 칸(위아래 묶음)에 같이 들지 않는다.
  const wobble = Math.floor(tick / 2) % 2;
  px[MINI_ROWS - 1 - (tick % MINI_ROWS)]![8 + wobble] = COLORS['H']!;
  px[MINI_ROWS - 1 - ((tick + MINI_ROWS / 2) % MINI_ROWS)]![9 - wobble] = COLORS['H']!;
  return px;
}

/** 픽셀 하나를 k×k로 키운다. 칸은 가로 1·세로 2(위아래 픽셀)라 가로·세로를 같은 배수로 키워야 모양이 안 일그러진다. */
export function scalePixels(px: Pixels, k: number): Pixels {
  return px.flatMap((row) => {
    const wide = row.flatMap((p) => Array<string | null>(k).fill(p));
    return Array.from({ length: k }, () => [...wide]);
  });
}

/**
 * 작은 Delfi를 k배로 키운다. 키우면 위아래 픽셀이 같은 색이 되어 줄 끝 칸이 배경색 빈칸이 되므로(cmd 창 크기를 바꿀 때 번진다),
 * 줄마다 마지막으로 칠한 칸은 아래 픽셀을 비워 위만 칠한다.
 */
export function paintMiniDelfiScaled(tick: number, k: number): Pixels {
  const px = k === 1 ? paintMiniDelfi(tick) : scalePixels(paintMiniDelfi(tick), k);
  if (k === 1) return px;
  for (let y = 0; y + 1 < px.length; y += 2) {
    const last = Math.max(px[y]!.findLastIndex((c) => c !== null), px[y + 1]!.findLastIndex((c) => c !== null));
    if (last >= 0 && px[y]![last] !== null && px[y + 1]![last] !== null) px[y + 1]![last] = null;
  }
  return px;
}

export function paintDelfi(face: Face): Pixels {
  const spec = FACES[face];
  const px: Pixels = BODY.map((row) => [...row.padEnd(WIDTH, '.')].map((k) => (k === '.' ? null : COLORS[k]!)));
  const stamp = (rows: Stamp, x: number, y: number) =>
    rows.forEach((row, dy) =>
      [...row].forEach((k, dx) => {
        if (k !== '.') px[y + dy]![x + dx] = COLORS[k]!;
      }),
    );
  EYES.forEach(([x, y], i) => stamp(spec.eyes[i]!, x - (i === 0 && spec.shiftLeftEye ? 1 : 0), y));
  stamp(spec.mouth, MOUTH[0], MOUTH[1]);
  if (spec.blush) for (const [x, y] of BLUSH) px[y]![x] = COLORS['P']!;
  if (spec.extra !== null) for (const [x, y] of spec.extra[1]) px[y]![x] = COLORS[spec.extra[0]]!;
  return px;
}

// ── 색 ─────────────────────────────────────────────────────

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

/** xterm 256색 큐브(16~231)에서 가장 가까운 번호. */
export function ansi256(hex: string): number {
  const levels = [0, 95, 135, 175, 215, 255];
  const nearest = (v: number) => levels.reduce((best, level, i) => (Math.abs(level - v) < Math.abs(levels[best]! - v) ? i : best), 0);
  const [r, g, b] = rgb(hex).map(nearest) as [number, number, number];
  return 16 + 36 * r + 6 * g + b;
}

/** depth: 24 = 트루컬러, 8 = 256색. layer 38 = 글자색, 48 = 배경색. */
function color(hex: string, depth: number, layer: 38 | 48): string {
  return depth >= 24 ? `${layer};2;${rgb(hex).join(';')}` : `${layer};5;${ansi256(hex)}`;
}

const RESET = '\x1b[0m';

export function toAnsi(px: Pixels, depth: number): string[] {
  const lines: string[] = [];
  for (let y = 0; y < px.length; y += 2) {
    let line = '';
    for (let x = 0; x < px[y]!.length; x += 1) {
      const top = px[y]![x] ?? null;
      const bottom = px[y + 1]?.[x] ?? null;
      // 글자색·배경색 코드는 따로 쓴다. 한 코드에 묶으면 Ink(대화 화면)가 다시 쓸 때 배경색을 닫지 않는다.
      // 위아래가 같은 색이면 배경색 빈칸으로 칠한다. macOS 터미널은 ▀가 줄 높이를 다 채우지 않아 가로 틈이 보이는데, 배경색은 칸 전체를 채운다.
      if (top !== null && top === bottom) line += `\x1b[39m\x1b[${color(top, depth, 48)}m `;
      else if (top !== null && bottom !== null) line += `\x1b[${color(top, depth, 38)}m\x1b[${color(bottom, depth, 48)}m▀`;
      else if (top !== null) line += `\x1b[49m\x1b[${color(top, depth, 38)}m▀`;
      else if (bottom !== null) line += `\x1b[49m\x1b[${color(bottom, depth, 38)}m▄`;
      else line += `${RESET} `;
    }
    lines.push(line + RESET);
  }
  return lines;
}

/**
 * 1/8 블록으로 그린 얇은 테두리 박스. 테두리는 글자색만 쓴다(배경색 없음).
 * 세로선 ▕ ▏은 칸의 안쪽 가장자리에, 윗변 ▁·아랫변 ▔은 그 사이 칸에만 그려서 모서리가 맞물린다.
 * 선 문자(╭─╮)는 한글 글꼴 cmd에서 창 크기를 바꾸면 가로선이 사라져서 쓰지 않는다.
 * 안쪽 글에는 '·'처럼 터미널마다 폭이 다른 글자를 넣지 않는다. 두 칸이 되어 테두리가 어긋난다.
 */
export function box(lines: readonly string[], borderHex: string, depth: number): string[] {
  const inner = Math.max(...lines.map(displayWidth));
  const edge = (text: string) => `\x1b[${color(borderHex, depth, 38)}m${text}${RESET}`;
  return [
    ` ${edge('▁'.repeat(inner + 2))} `,
    ...lines.map((line) => `${edge('▕')} ${line}${' '.repeat(inner - displayWidth(line))} ${edge('▏')}`),
    ` ${edge('▔'.repeat(inner + 2))} `,
  ];
}

/** 너비 max를 넘으면 가운데를 '...'로 줄인다. 경로의 앞(드라이브)과 끝(폴더 이름)이 남는다. */
function shortenMiddle(text: string, max: number): string {
  if (displayWidth(text) <= max) return text;
  const chars = [...text];
  const take = (from: string[], budget: number) => {
    const out: string[] = [];
    for (const ch of from) {
      if (displayWidth([...out, ch].join('')) > budget) break;
      out.push(ch);
    }
    return out;
  };
  const room = Math.max(0, max - 3);
  const head = take(chars, Math.ceil(room / 2));
  const tail = take([...chars].reverse(), Math.floor(room / 2)).reverse();
  return `${head.join('')}...${tail.join('')}`;
}

/** 그림 오른쪽에 글을 붙인다. 짧은 쪽을 세로 가운데에 둔다. */
export function beside(art: readonly string[], text: readonly string[], gap = 2): string[] {
  const artWidth = displayWidth(art[0] ?? '');
  const height = Math.max(art.length, text.length);
  const artTop = Math.floor((height - art.length) / 2);
  const textTop = Math.floor((height - text.length) / 2);
  return Array.from({ length: height }, (_, i) => {
    const a = art[i - artTop];
    const t = text[i - textTop];
    if (t === undefined) return a ?? '';
    return `${a ?? ' '.repeat(artWidth)}${' '.repeat(gap)}${t}`;
  });
}

// ── 화면 ───────────────────────────────────────────────────

/**
 * 시작 박스의 최대 너비. cmd는 창을 줄이면 이미 찍힌 줄도 다시 접어서, 박스보다 좁아지면 테두리가 깨진다.
 * 다시 그리는 TUI가 아니므로 박스를 작게 잡아서 버틴다.
 */
const MAX_BANNER_WIDTH = 60;
const GREETING = '오늘도 신나게 헤엄쳐요';
/** 시작 화면 Delfi를 키울 수 있는 배수. 큰 것부터 맞는지 본다. */
const SCALES = [3, 2] as const;

/** 허락 박스의 최대 너비. 긴 명령은 이 안에서 접는다. */
const MAX_PERMISSION_WIDTH = 76;

const ROLE_COLOR: Readonly<Record<MemberRole, string>> = { intake: '#8FD3F7', tester: '#F3958F', implementer: '#84D9AE', reviewer: '#C3B4F5', router: '#8FD3F7', answerer: '#8FD3F7', surveyor: '#8FD3F7', writer: '#FFDB7A', designer: '#C3B4F5', operator: '#84D9AE', debugger: '#F3958F', riskchecker: '#FFDB7A', planner: '#C3B4F5', chief: '#8FD3F7', bm: '#FFDB7A', marketer: '#F3958F', growth: '#84D9AE', uxdesigner: '#C3B4F5', brand: '#C3B4F5', securitychecker: '#F3958F', releaser: '#84D9AE', splitter: '#8FD3F7', publisher: '#84D9AE' };

export interface ResultCard {
  readonly status: 'complete' | 'stopped';
  readonly title: string;
  readonly elapsed: string;
  readonly stopMessage: string | null;
  readonly files: readonly { readonly path: string; readonly kind: 'added' | 'modified' | 'deleted' }[];
  /** rauha가 추천대로 알아서 정한 해석(묻지 않은 것). 다르면 다시 요청하면 된다. */
  readonly decided: readonly string[];
  /** 사용자가 직접 확인해야 할 것(코드에 들어갔는데 근거를 못 찾은 사실) */
  readonly todo: readonly string[];
}

/** 사용률 막대 색: 평소는 하늘색, 70%부터 노랑, 90%부터 산호색. */
const GAUGE_COLOR: Readonly<Record<GaugeLevel, string>> = { normal: '#8FD3F7', warn: '#FFDB7A', critical: '#F3958F' };
/** 막대의 빈 부분(레일) 색. 어두운 바탕에서 보일 만큼만 밝은 회청색. */
const GAUGE_TRACK_COLOR = '#56627A';

/** 결과 카드에 다 쓰는 바뀐 파일 수. 넘으면 "외 n개". */
const MAX_CARD_FILES = 6;
const DONE_COLOR = '#84D9AE';
const STOP_COLOR = '#F3958F';
const FILE_MARK: Readonly<Record<ResultCard['files'][number]['kind'], readonly [string, string]>> = {
  added: ['+', DONE_COLOR],
  modified: ['~', '#8FD3F7'],
  deleted: ['-', STOP_COLOR],
};

export interface MascotView {
  /** columns: 터미널 너비. 박스가 이보다 넓어지지 않게 작업 폴더 경로를 줄인다. */
  /** columns·rows: 터미널 크기. rows를 알려 주면 창이 넓고 높을 때 Delfi를 정수 배로 키운다. */
  banner(workDir: string, columns: number, rows?: number): string;
  step(message: string, role?: MemberRole): string;
  /** 팀원이 일하는 동안 다시 그리는 한 줄 */
  working(frame: string, message: string, role: MemberRole, elapsed: string): string;
  /** 대화 화면용: 작은 Delfi 옆에 그린 작업 중 줄(여러 줄이라 -p의 한 줄 진행 표시에는 못 쓴다) */
  workingDelfi(frame: string, message: string, role: MemberRole, elapsed: string, tick?: number, scale?: number): string;
  /** 팀원 일이 끝나 고정되는 줄 */
  done(message: string, role: MemberRole, elapsed: string): string;
  finale(status: 'complete' | 'stopped'): string;
  /** Claude Code 허락 화면처럼: 물음표 Delfi + 누가·어떤 도구로·무엇을·왜 하는지 담은 박스 */
  permission(request: PermissionRequest, columns: number, compact?: boolean): string;
  /** 코드에 들어갔는데 근거를 확인하지 못한 사실을 보여 주는 화면 */
  factCheck(claim: string, columns: number, compact?: boolean): string;
  /** 작업이 끝났을 때 결과 요약 카드: 상태·바뀐 파일·확인할 것. 자세한 안내서는 /guide로. */
  resultCard(card: ResultCard, columns: number): string;
  /** "아까 그 기능" 후보를 고르게 하기 전에 보여 주는 화면 */
  pastPick(columns: number, compact?: boolean): string;
  /** 사용률 막대. 채운 부분은 사용률에 따라 색이 달라지고 빈 부분은 흐리다. */
  gauge(percent: number, cells: number): string;
  /** 선택 목록에서 고른 줄 색칠 */
  highlight(text: string): string;
  /** 사용자가 보낸 입력: 지난 답과 나누는 흐린 가로줄 + 하늘색 세로 막대가 붙은 굵은 글 */
  userTurn(text: string, columns: number): string;
}

/** 256색 이상 터미널에서만 Delfi를 그린다. 그보다 못하면 null(글자만 쓰는 기존 출력). */
export function mascotView(depth: number, version: string, badge: string): MascotView | null {
  if (depth < 8) return null;
  const fg = (hex: string, text: string) => `\x1b[${color(hex, depth, 38)}m${text}${RESET}`;
  const dim = (text: string) => `\x1b[2m${text}${RESET}`;
  /** Delfi를 왼쪽에서 두 칸 띄우고, 글과는 세 칸 띄운다. */
  const GAP = 3;
  const art = (face: Face, k = 1) => toAnsi(k === 1 ? paintDelfi(face) : scalePixels(paintDelfi(face), k), depth).map((line) => `  ${line}`);
  const say = (face: Face, text: string[]) => beside(art(face), text, GAP).join('\n');
  return {
    // Claude Code 시작 화면처럼 맨 위에 박스 하나: 왼쪽 Delfi, 오른쪽 rauha·인사말·작업 폴더.
    // 창이 좁으면 Delfi 아래에 글을 두고, 그것도 안 되면 박스 없이 글만 쓴다.
    banner: (workDir, columns, rows = 0) => {
      // 마지막 칸까지 채운 줄은 터미널이 다음 줄로 접어 버려서 한 칸을 비운다.
      const limit = Math.min(columns - 1, MAX_BANNER_WIDTH);
      const picture = art('hello');
      const title = `\x1b[1m${fg(COLORS['B']!, 'rauha')} ${dim(version)}  ${dim(badge)}`;
      const textWidth = Math.max(displayWidth(title), displayWidth(GREETING));
      // 창이 넓고 높으면 Delfi를 키워서 옆에 글을 둔다. 박스(위아래 테두리·빈 줄 2)까지 창 높이의 절반 안에 들어가는 가장 큰 배수.
      for (const k of rows > 0 ? SCALES : []) {
        const big = art('hello', k);
        const room = columns - 1 - 4 - displayWidth(big[0]!) - GAP;
        if (big.length + 4 > rows / 2 || room < textWidth) continue;
        const text = [title, GREETING, '', dim(shortenMiddle(workDir, room))];
        return box(['', ...beside(big, text, GAP), ''], COLORS['B']!, depth).join('\n');
      }
      const sideRoom = limit - 4 - displayWidth(picture[0]!) - GAP;
      if (sideRoom >= textWidth) {
        const text = [title, GREETING, '', dim(shortenMiddle(workDir, sideRoom))];
        return box(['', ...beside(picture, text, GAP), ''], COLORS['B']!, depth).join('\n');
      }
      const stackRoom = limit - 4;
      if (stackRoom >= Math.max(displayWidth(picture[0]!), textWidth + 2)) {
        const text = [title, GREETING, '', dim(shortenMiddle(workDir, stackRoom - 2))].map((line) => (line === '' ? '' : `  ${line}`));
        return box(['', ...picture, '', ...text, ''], COLORS['B']!, depth).join('\n');
      }
      return [`rauha ${version}  ${badge}`, GREETING, workDir].flatMap((line) => wrapText(line, limit)).join('\n');
    },
    step: (message, role) => (role === undefined ? `  ${dim('·')} ${dim(message)}` : `  ${fg(ROLE_COLOR[role], '◆')} ${message}`),
    working: (frame, message, role, elapsed) => `  ${fg(ROLE_COLOR[role], frame)} ${message} ${dim(elapsed)}`,
    workingDelfi: (frame, message, role, elapsed, tick = 0, scale = 1) => {
      const mini = toAnsi(paintMiniDelfiScaled(tick, scale), depth).map((line) => `  ${line}`);
      return beside(mini, [`${fg(ROLE_COLOR[role], frame)} ${message} ${dim(elapsed)}`], 1).join('\n');
    },
    done: (message, role, elapsed) => `  ${fg(ROLE_COLOR[role], '◆')} ${message.replace(/ 작업 중…$/, '')} ${dim(elapsed)}`,
    finale: (status) =>
      status === 'complete'
        ? say('done', ['끝났어요! 아래 읽기 안내서부터 봐 주세요.'])
        : say('stuck', ['여기서 멈췄어요. 이유는 아래에 적어 뒀어요.']),
    // compact: 낮은 창용. Delfi 없이 한 줄 안내와 상자만 둔다(화면이 창보다 높으면 Ink가 매번 전체를 다시 찍는다).
    permission: (request, columns, compact) => {
      const inner = Math.min(columns - 1, MAX_PERMISSION_WIDTH) - 4;
      const command = wrapText(request.detail, inner - 2).map((line) => `  \x1b[1m${line}${RESET}`);
      const reason = wrapText(request.reason, inner - 2).map((line) => `  ${dim(line)}`);
      const header = `\x1b[1m${fg(ROLE_COLOR[request.role], ROLE_INFO[request.role].name)}  ${dim(request.tool)}`;
      const intro = '위험할 수 있는 동작이라 직접 허락받을게요.';
      const head = compact ? [`  ${fg(COLORS['Y']!, '?')} ${intro}`] : [say('ask', [intro]), ''];
      return [...head, ...box([header, '', ...command, ...reason], COLORS['B']!, depth)].join('\n');
    },
    factCheck: (claim, columns, compact) => {
      const inner = Math.min(columns - 1, MAX_PERMISSION_WIDTH) - 4;
      const lines = wrapText(claim, inner - 2).map((line) => `  \x1b[1m${line}${RESET}`);
      const intro = '근거를 확인하지 못했어요. 맞는지 알려 주세요.';
      const head = compact ? [`  ${fg(COLORS['Y']!, '?')} ${intro}`] : [say('ask', [intro]), ''];
      return [...head, ...box([dim('코드에 들어간 사실'), '', ...lines], COLORS['B']!, depth)].join('\n');
    },
    resultCard: (card, columns) => {
      const inner = Math.min(columns - 1, MAX_PERMISSION_WIDTH) - 4;
      const fit = (text: string, indent = '') => fitLines(`${indent}${text}`, inner);
      const state = card.status === 'complete' ? fg(DONE_COLOR, '완료') : fg(STOP_COLOR, '멈춤');
      const shown = card.files.slice(0, MAX_CARD_FILES);
      const lines = [
        // '·'는 한글 글꼴 cmd에서 두 칸이라 박스 안에서는 띄어쓰기로 나눈다.
        // 걸린 시간('3분 5초')은 줄바꿈 안 되는 공백으로 이어 한 덩어리로 둔다(제목이 길어 접혀도 쪼개지지 않게).
        ...fit(`\x1b[1m${state}\x1b[1m  ${card.title}${RESET}  ${dim(card.elapsed.replace(/ /g, ' '))}`),
        ...(card.stopMessage !== null ? ['', ...fit(card.stopMessage)] : []),
        ...(card.files.length > 0
          ? [
              '',
              `바뀐 파일 ${card.files.length}개`,
              ...shown.flatMap((f) => fit(`${fg(FILE_MARK[f.kind][1], FILE_MARK[f.kind][0])} ${f.path}`, '  ')),
              ...(card.files.length > shown.length ? [dim(`  외 ${card.files.length - shown.length}개`)] : []),
            ]
          : []),
        ...(card.decided.length > 0 ? ['', `알아서 정한 것 ${card.decided.length}개`, ...card.decided.flatMap((t) => fit(`- ${t}`, '  ').map(dim))] : []),
        ...(card.todo.length > 0 ? ['', fg(STOP_COLOR, `확인할 것 ${card.todo.length}개`), ...card.todo.flatMap((t) => fit(`- ${t}`, '  '))] : []),
        '',
        dim('자세한 읽기 안내서는 /guide'),
      ];
      // 박스 너비를 창에 맞춰 고정한다(첫 줄을 채워 둔다).
      const head = lines[0]!;
      lines[0] = `${head}${' '.repeat(Math.max(0, inner - displayWidth(head)))}`;
      return box(lines, COLORS['B']!, depth).join('\n');
    },
    pastPick: (_columns, compact) => (compact ? `  ${fg(COLORS['Y']!, '?')} 혹시 이 작업을 말씀하시는 건가요?` : say('ask', ['혹시 이 작업을 말씀하시는 건가요?'])),
    gauge: (percent, cells) => {
      const { filled, track } = gaugeParts(percent, cells);
      return `${fg(GAUGE_COLOR[gaugeLevel(percent)], filled)}${fg(GAUGE_TRACK_COLOR, track)}`;
    },
    highlight: (text) => `\x1b[1m${fg(COLORS['B']!, text)}`,
    userTurn: (text, columns) => {
      const width = Math.min(columns - 1, MAX_PERMISSION_WIDTH);
      const gutter = fg(COLORS['B']!, '▍');
      // 이어지는 줄에도 막대를 붙이려고 여기서 접는다(막대와 띄어쓰기 두 칸을 뺀 너비).
      const body = text.split('\n').flatMap((line) => fitLines(line, Math.max(1, width - 2)));
      return [dim('▁'.repeat(width)), ...body.map((line) => `${gutter} \x1b[1m${line}${RESET}`)].join('\n');
    },
  };
}
