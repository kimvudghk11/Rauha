import { iconFor } from '../shared/file-icon.js';

/**
 * 파일·폴더 아이콘 그림 모음(직접 그린 16px SVG). 색(currentColor)은 CSS 클래스 fi-<색>이 정하고,
 * 종류마다 글자 배지를 달아 색에만 기대지 않는다. 심볼은 한 번만 문서에 넣고 각 줄은 <use>로 가리킨다.
 */
const NS = 'http://www.w3.org/2000/svg';

type Tone = 'blue' | 'yellow' | 'green' | 'red' | 'purple' | 'orange' | 'teal' | 'pink' | 'gray' | 'folder';

/** 키 → [색, 배지 글자(3자 이하)] */
const FILE_BADGES: Readonly<Record<string, readonly [Tone, string]>> = {
  ts: ['blue', 'TS'], tsx: ['blue', 'TSX'], js: ['yellow', 'JS'], jsx: ['yellow', 'JSX'], json: ['yellow', '{}'],
  md: ['blue', 'MD'], css: ['purple', 'CSS'], scss: ['pink', 'SC'], html: ['orange', 'H'], vue: ['green', 'V'],
  svelte: ['orange', 'S'], py: ['blue', 'PY'], go: ['teal', 'GO'], rs: ['orange', 'RS'], java: ['red', 'JV'],
  kt: ['purple', 'KT'], swift: ['orange', 'SW'], c: ['blue', 'C'], cpp: ['blue', 'C+'], h: ['purple', 'H'],
  cs: ['green', 'C#'], rb: ['red', 'RB'], php: ['purple', 'PHP'], sh: ['green', 'SH'], ps1: ['blue', 'PS'],
  bat: ['gray', 'BAT'], sql: ['orange', 'SQL'], yaml: ['red', 'YML'], toml: ['orange', 'TML'], ini: ['gray', 'INI'],
  xml: ['orange', 'XML'], csv: ['green', 'CSV'], txt: ['gray', 'TXT'], log: ['gray', 'LOG'], lock: ['gray', 'LCK'],
  env: ['yellow', 'ENV'], img: ['teal', 'IMG'], svg: ['orange', 'SVG'], pdf: ['red', 'PDF'], zip: ['orange', 'ZIP'],
  exe: ['gray', 'EXE'], video: ['pink', 'MP4'], audio: ['pink', 'MP3'], test: ['green', 'TST'], pkg: ['green', 'PKG'],
  tsconfig: ['blue', 'TSC'], config: ['gray', 'CFG'], docker: ['blue', 'DK'], git: ['orange', 'GIT'],
  editorconfig: ['gray', 'EC'], readme: ['blue', 'i'], license: ['yellow', 'LIC'], claude: ['orange', 'CL'], make: ['gray', 'MK'],
};

/** 폴더 종류(folder-<종류>) → 색 */
const FOLDER_TONES: Readonly<Record<string, Tone>> = {
  src: 'green', lib: 'purple', out: 'gray', modules: 'gray', docs: 'blue', test: 'green', scripts: 'orange',
  config: 'gray', assets: 'teal', components: 'purple', packages: 'blue', git: 'orange', github: 'gray', vscode: 'blue',
};

const FOLDER_CLOSED = 'M1.5 3.5h4.2l1.4 1.5h7.4v8.5h-13z';
const FOLDER_OPEN = 'M1.5 3.5h4.2l1.4 1.5h6.4v2H4.2L1.5 13.5z M4.6 7.8h11l-2.4 5.7H1.5z';
const PAGE = 'M3.5 1.5h6l3.5 3.5v9.5h-9.5z';

const badge = (text: string): string => `<text x="8" y="12" text-anchor="middle" font-size="${text.length > 2 ? 5.4 : 6.4}" font-weight="700" font-family="sans-serif" fill="#181818">${text}</text>`;

const symbolFor = (key: string): { tone: Tone; body: string } => {
  const spec = FILE_BADGES[key];
  if (spec !== undefined) {
    const [tone, text] = spec;
    const body = key === 'key' ? '' : `<rect x="1.5" y="3" width="13" height="10.5" rx="2.2" fill="currentColor"/>${badge(text)}`;
    return { tone, body };
  }
  if (key === 'key') {
    return { tone: 'yellow', body: '<rect x="2.5" y="7" width="11" height="7.5" rx="1.6" fill="currentColor"/><path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="10.6" r="1.2" fill="#181818"/>' };
  }
  if (key.startsWith('folder')) {
    const open = key.endsWith('-open');
    const kind = key.replace(/^folder-?/, '').replace(/-open$/, '');
    return { tone: FOLDER_TONES[kind] ?? 'folder', body: `<path d="${open ? FOLDER_OPEN : FOLDER_CLOSED}" fill="currentColor"/>` };
  }
  return { tone: 'gray', body: `<path d="${PAGE}" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M5.5 8h5M5.5 10.5h5" stroke="currentColor" stroke-width="1"/>` };
};

/** 만들 수 있는 아이콘 키 전부(갤러리·시험용) */
export function allIconKeys(): string[] {
  const keys = [...Object.keys(FILE_BADGES), 'key', 'file', 'folder', 'folder-open'];
  for (const k of Object.keys(FOLDER_TONES)) keys.push(`folder-${k}`, `folder-${k}-open`);
  return keys;
}

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
    const known = FILE_BADGES[key] !== undefined || key === 'key' || key.startsWith('folder') ? key : 'file';
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
