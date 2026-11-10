/**
 * 파일·폴더 아이콘 그림 모음(직접 그린 16px SVG, 외부 아이콘 없음). VS Code의 Material Icon Theme처럼
 * 종류마다 색과 모양이 달라 한눈에 알아본다: 언어는 색 사각형 + 글자, 문서 종류는 색 종이 + 안쪽 그림,
 * 패키지·git·도커·설정 같은 특수 파일은 자기 모양, 폴더는 종류별 색 + 안쪽 그림.
 * 색(currentColor)은 CSS 클래스 fi-<색>이 정한다. 키를 고르는 규칙은 shared/file-icon.ts.
 */

export type Tone = 'blue' | 'yellow' | 'green' | 'red' | 'purple' | 'orange' | 'teal' | 'pink' | 'gray' | 'folder';

/** 안쪽 그림에 쓰는 어두운 색(아이콘 색 위에 올린다) */
const D = '#181818';
const stroke = (d: string, w = 1.2): string => `<path d="${d}" fill="none" stroke="${D}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
const solid = (d: string): string => `<path d="${d}" fill="${D}"/>`;
const dot = (x: number, y: number, r = 0.95): string => `<circle cx="${x}" cy="${y}" r="${r}" fill="${D}"/>`;

const FONT = 'Segoe UI, Arial, sans-serif';
/** 언어 아이콘: 색 사각형 + 글자 */
const square = (text: string): string =>
  `<rect x="1.5" y="1.5" width="13" height="13" rx="2.6" fill="currentColor"/><text x="8" y="11.4" text-anchor="middle" font-size="${text.length > 2 ? 5.8 : 7.6}" font-weight="800" font-family="${FONT}" fill="${D}">${text}</text>`;
/** 색 사각형 + 안쪽 그림 */
const squareWith = (inner: string): string => `<rect x="1.5" y="1.5" width="13" height="13" rx="2.6" fill="currentColor"/>${inner}`;
/** 문서 종류 아이콘: 귀퉁이가 접힌 색 종이 + 안쪽 그림 */
const paper = (inner: string): string =>
  `<path d="M3 1.5h6.4L13 5.1V14.5H3z" fill="currentColor"/><path d="M9.4 1.5v3.6H13" fill="none" stroke="${D}" stroke-width="1" stroke-opacity=".45" stroke-linejoin="round"/>${inner}`;
const paperText = (text: string): string => paper(`<text x="8" y="12.4" text-anchor="middle" font-size="${text.length > 2 ? 4.6 : 5.6}" font-weight="800" font-family="${FONT}" fill="${D}">${text}</text>`);

const GEAR = `<g fill="currentColor"><circle cx="8" cy="8" r="4.6"/><rect x="6.8" y="1.5" width="2.4" height="13" rx=".7"/><rect x="6.8" y="1.5" width="2.4" height="13" rx=".7" transform="rotate(60 8 8)"/><rect x="6.8" y="1.5" width="2.4" height="13" rx=".7" transform="rotate(120 8 8)"/></g><circle cx="8" cy="8" r="1.9" fill="${D}"/>`;
const PROMPT = stroke('M4.8 5.6L7.6 8l-2.8 2.4 M8.8 11.2h3', 1.4);
const LINES = stroke('M5.4 7h5.2 M5.4 9h5.2 M5.4 11h3', 1.2);

/** 키 → [색, 그림]: 언어(사각형)와 문서 종류(종이) */
export const FILE_ART: Readonly<Record<string, readonly [Tone, string]>> = {
  ts: ['blue', square('TS')], tsx: ['blue', square('TSX')], js: ['yellow', square('JS')], jsx: ['yellow', square('JSX')],
  py: ['blue', square('PY')], go: ['teal', square('GO')], rs: ['orange', square('RS')], java: ['red', square('JV')],
  kt: ['purple', square('KT')], swift: ['orange', square('SW')], c: ['blue', square('C')], cpp: ['blue', square('C+')], h: ['purple', square('H')],
  cs: ['green', square('C#')], rb: ['red', square('RB')], php: ['purple', square('PHP')], lua: ['blue', square('LU')], dart: ['teal', square('DT')],
  vue: ['green', square('V')], svelte: ['orange', square('S')], scss: ['pink', square('SC')], graphql: ['pink', square('GQ')],
  css: ['purple', squareWith(stroke('M6.4 4.8L5.8 11.2 M10.2 4.8L9.6 11.2 M4.6 7h7 M4.4 9.2h7', 1.2))],
  bat: ['gray', square('BAT')], make: ['gray', square('MK')],
  sh: ['green', squareWith(PROMPT)], ps1: ['blue', squareWith(PROMPT)],
  html: ['orange', squareWith(stroke('M6.6 5.4L4 8l2.6 2.6 M9.4 5.4L12 8l-2.6 2.6', 1.4))],
  md: ['blue', paper(stroke('M4.9 11.2V6.8l1.6 2 1.6-2v4.4 M10.9 6.8v3.9 M9.7 9.5l1.2 1.4 1.2-1.4', 1.1))],
  json: ['yellow', paper(stroke('M6.7 6.1c-1 0-1.3.5-1.3 1.2v.7c0 .6-.4.9-.9 1 .5.1.9.4.9 1v.8c0 .7.3 1.2 1.3 1.2 M9.3 6.1c1 0 1.3.5 1.3 1.2v.7c0 .6.4.9.9 1-.5.1-.9.4-.9 1v.8c0 .7-.3 1.2-1.3 1.2', 1.1))],
  yaml: ['red', paper(stroke('M5.4 6.8h2.2 M6.9 9h3.8 M6.9 11.2h2.2', 1.3))],
  toml: ['orange', paper(stroke('M5.4 6.8h5.2 M5.4 9h3.4 M5.4 11.2h4.4', 1.3))],
  ini: ['gray', paper(stroke('M5.4 6.8h5.2 M5.4 9h3.4 M5.4 11.2h4.4', 1.3))],
  xml: ['orange', paper(stroke('M6.6 6.8L4.8 9l1.8 2.2 M9.4 6.8L11.2 9l-1.8 2.2', 1.2))],
  csv: ['green', paper(stroke('M5.2 7h5.6 M5.2 9.2h5.6 M5.2 11.4h5.6 M8 6.4v5.6', 1))],
  txt: ['gray', paper(LINES)],
  log: ['gray', paper(LINES)],
  editorconfig: ['gray', paper(LINES)],
  sql: ['orange', paper(`<ellipse cx="8" cy="7.4" rx="2.7" ry="1.2" fill="none" stroke="${D}" stroke-width="1.1"/>${stroke('M5.3 7.4v3.9c0 .7 1.2 1.2 2.7 1.2s2.7-.5 2.7-1.2V7.4', 1.1)}`)],
  lock: ['gray', paper(`<rect x="5.6" y="9" width="4.8" height="3.4" rx=".7" fill="${D}"/>${stroke('M6.6 9V7.9a1.4 1.4 0 0 1 2.8 0V9', 1.1)}`)],
  env: ['yellow', paper(`${dot(5.9, 10)}${dot(8, 10)}${dot(10.1, 10)}${stroke('M5.4 7.2h5.2', 1.2)}`)],
  img: ['teal', paper(`${solid('M4.6 12.2l2.4-3.3 1.6 2 1.2-1.4 1.6 2.7z')}${dot(10.4, 7.8)}`)],
  svg: ['orange', paper(solid('M4.9 12l.4-1.8 4.3-4.3 1.4 1.4-4.3 4.3z'))],
  pdf: ['red', paperText('PDF')],
  zip: ['orange', paper(`${stroke('M8 5.8v1.4 M8 8.2v1.4', 1.2)}<rect x="6.9" y="10" width="2.2" height="2.5" rx=".5" fill="${D}"/>`)],
  exe: ['gray', paper(`<rect x="4.7" y="6.6" width="6.6" height="5.4" rx=".8" fill="none" stroke="${D}" stroke-width="1.1"/>${stroke('M4.9 8.4h6.2', 1)}`)],
  video: ['pink', paper(solid('M6.4 6.6v5.2l4.2-2.6z'))],
  audio: ['pink', paper(`${stroke('M9.6 6.2v4.6 M9.6 6.2l1.7.8', 1.1)}<circle cx="7.9" cy="10.9" r="1.3" fill="${D}"/>`)],
  font: ['purple', paperText('Aa')],
  test: ['green', paper(stroke('M7 6.2h2 M7.3 6.2v2.6L5.7 12.1h4.6L8.7 8.8V6.2', 1.1))],
  readme: ['blue', paper(`${stroke('M8 9v2.8', 1.4)}${dot(8, 6.9, 0.85)}`)],
  license: ['yellow', paper(`<circle cx="8" cy="8.6" r="2" fill="none" stroke="${D}" stroke-width="1.1"/>${stroke('M7 10.3l-.6 2 1.6-.9 1.6.9-.6-2', 1)}`)],
};

/** 모양이 따로 있는 특수 파일 */
export const SPECIAL_ART: Readonly<Record<string, readonly [Tone, string]>> = {
  pkg: ['green', `<path d="M8 1.6l5.6 3.2v6.4L8 14.4l-5.6-3.2V4.8z" fill="currentColor"/>${stroke('M8 8.2v6 M2.6 4.9L8 8.2l5.4-3.3', 1)}`],
  git: ['orange', `<path d="M8 1.4l6.6 6.6L8 14.6 1.4 8z" fill="currentColor"/>${stroke('M6.4 6.1v4 M6.4 8h3.4', 1)}${dot(6.4, 6, 1.05)}${dot(6.4, 10.2, 1.05)}${dot(9.9, 8, 1.05)}`],
  docker: ['blue', '<path d="M1.6 8.6h12.6c-.4 2.8-2.7 4.6-5.9 4.6-3 0-5.4-1.8-6.7-4.6z" fill="currentColor"/><path d="M3.3 6.1h2v2h-2z M5.7 6.1h2v2h-2z M8.1 6.1h2v2h-2z M5.7 3.7h2v2h-2z M8.1 3.7h2v2h-2z" fill="currentColor"/>'],
  config: ['gray', GEAR],
  tsconfig: ['blue', GEAR],
  claude: ['orange', '<g stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><path d="M8 2v12"/><path d="M8 2v12" transform="rotate(60 8 8)"/><path d="M8 2v12" transform="rotate(120 8 8)"/></g>'],
  key: ['yellow', `<rect x="2.5" y="7" width="11" height="7.5" rx="1.6" fill="currentColor"/><path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.5"/>${dot(8, 10.6, 1.2)}`],
};

/** 폴더 종류(folder-<종류>) → [색, 몸통 한가운데(x 3~13 · y 7.5~12.5)에 올리는 그림] */
export const FOLDER_ART: Readonly<Record<string, readonly [Tone, string]>> = {
  src: ['green', stroke('M6.6 8.4L5 10l1.6 1.6 M9.4 8.4L11 10l-1.6 1.6', 1.1)],
  lib: ['purple', stroke('M5.8 8v3.8 M8 8v3.8 M10.2 8.4v3.4', 1.2)],
  out: ['gray', stroke('M8 8v3.2 M6.4 9.9L8 11.5l1.6-1.6', 1.1)],
  modules: ['gray', `${dot(6, 10, 0.9)}${dot(8, 10, 0.9)}${dot(10, 10, 0.9)}`],
  docs: ['blue', stroke('M5.6 8.6h4.8 M5.6 10.4h4.8 M5.6 12h2.8', 1)],
  test: ['green', stroke('M5.7 10.2l1.7 1.7 3.1-3.5', 1.2)],
  scripts: ['orange', stroke('M5.6 8.4L7.4 10l-1.8 1.6 M8.8 11.6h2', 1.1)],
  config: ['gray', `<circle cx="8" cy="10" r="1.7" fill="none" stroke="${D}" stroke-width="1.1"/>`],
  assets: ['teal', `${solid('M5 12l1.8-2.4 1.2 1.4.9-1 1.6 2z')}${dot(10.2, 8.8, 0.8)}`],
  components: ['purple', `<path d="M5.4 8.2h2v2h-2z M8.6 8.2h2v2h-2z M5.4 11h2v.9h-2z M8.6 11h2v.9h-2z" fill="${D}"/>`],
  packages: ['blue', stroke('M8 8L10.6 9.4v2.2L8 13 5.4 11.6V9.4z', 1)],
  git: ['orange', `${stroke('M6.6 8.6v2.6 M6.6 9.8h2.8', 1)}${dot(6.6, 8.6, 0.9)}${dot(6.6, 11.4, 0.9)}${dot(9.6, 9.8, 0.9)}`],
  github: ['gray', `<circle cx="8" cy="10" r="2" fill="none" stroke="${D}" stroke-width="1.1"/>`],
  vscode: ['blue', stroke('M9.6 8.2L6 10.2l3.6 2 M9.6 8.2v4', 1.1)],
  api: ['teal', stroke('M5.5 10h5 M8.8 8.4l1.7 1.6-1.7 1.6', 1.1)],
  db: ['orange', `<ellipse cx="8" cy="8.8" rx="2.3" ry=".9" fill="none" stroke="${D}" stroke-width="1"/>${stroke('M5.7 8.8v2.5c0 .5 1 .9 2.3.9s2.3-.4 2.3-.9V8.8', 1)}`],
  styles: ['pink', stroke('M6 8.6h4 M6 10.3h4 M6 12h2.4', 1)],
  utils: ['yellow', stroke('M5.7 11.8l3.4-3.4 M8.2 8.2l1.2-.2.6.6-.2 1.2', 1.1)],
  types: ['blue', stroke('M5.6 8.7h4.8 M8 8.7v3.5', 1.3)],
  hooks: ['purple', stroke('M8.8 8.1v3a1.4 1.4 0 0 1-2.8 0', 1.2)],
};

const FOLDER_CLOSED = 'M1.5 3h4.5l1.5 1.6h7v8.9h-13z';
const FOLDER_OPEN = 'M1.5 3h4.5l1.5 1.6h6.4V7H4.2L1.5 13.5z M4.7 7.6h10.6l-2.5 5.9H1.6z';
const PAGE_ART = '<path d="M3.5 1.5h6l3.5 3.5v9.5h-9.5z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M5.5 8h5M5.5 10.5h5" stroke="currentColor" stroke-width="1"/>';

const isFolderKey = (key: string): boolean => key === 'folder' || key === 'folder-open' || key.startsWith('folder-');

export const isKnownIcon = (key: string): boolean => FILE_ART[key] !== undefined || SPECIAL_ART[key] !== undefined || isFolderKey(key);

export function symbolFor(key: string): { tone: Tone; body: string } {
  const file = FILE_ART[key] ?? SPECIAL_ART[key];
  if (file !== undefined) return { tone: file[0], body: file[1] };
  if (isFolderKey(key)) {
    const open = key.endsWith('-open');
    const kind = key.replace(/^folder-?/, '').replace(/-open$/, '');
    const art = FOLDER_ART[kind];
    const shape = `<path d="${open ? FOLDER_OPEN : FOLDER_CLOSED}" fill="currentColor"/>`;
    if (art === undefined) return { tone: 'folder', body: shape };
    // 열린 폴더는 앞판이 아래로 내려가 있어 그림도 조금 내린다
    return { tone: art[0], body: open ? `${shape}<g transform="translate(.5 .7)">${art[1]}</g>` : shape + art[1] };
  }
  return { tone: 'gray', body: PAGE_ART };
}

/** 만들 수 있는 아이콘 키 전부(갤러리·시험용) */
export function allIconKeys(): string[] {
  const keys = [...Object.keys(FILE_ART), ...Object.keys(SPECIAL_ART), 'file', 'folder', 'folder-open'];
  for (const k of Object.keys(FOLDER_ART)) keys.push(`folder-${k}`, `folder-${k}-open`);
  return keys;
}
