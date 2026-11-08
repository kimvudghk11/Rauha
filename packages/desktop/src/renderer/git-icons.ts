import { icon } from './dom.js';

/** git 탭 아이콘(24×24 선 그림). 글꼴과 상관없이 어디서나 같게 보인다. */
const PATHS = {
  /** 받아 오기: 아래 화살표 */
  pull: 'M12 4v14 M6 12l6 6 6-6',
  /** 올리기: 위 화살표 */
  push: 'M12 20V6 M6 12l6-6 6 6',
  /** 새로고침(순환) */
  fetch: 'M20 12a8 8 0 1 1-2.6-5.9 M20 4v5h-5',
  lock: 'M6 11h12v9H6z M8 11V8a4 4 0 0 1 8 0v3',
  branch: 'M7 4v11 M7 15a3 3 0 1 0 0 .01 M17 7a3 3 0 1 0 0 .01 M17 10c0 4-4 4-10 5',
  plus: 'M12 5v14 M5 12h14',
  undo: 'M9 14l-4-4 4-4 M5 10h9a5 5 0 0 1 0 10h-3',
  external: 'M14 4h6v6 M20 4l-9 9 M18 14v5H5V6h5',
  /** 기록 탭 */
  copy: 'M9 9h11v11H9z M5 15V4h11',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13',
  back: 'M15 6l-6 6 6 6',
  doc: 'M6 3h9l4 4v14H6z M14 3v5h5 M9 13h7 M9 17h7',
  close: 'M6 6l12 12 M18 6L6 18',
  save: 'M5 4h12l3 3v13H5z M8 4v5h8V4 M8 20v-7h8v7',
  check: 'M5 12l5 5 9-10',
  edit: 'M4 20l4-1 11-11-3-3L5 16z',
} as const;

export type GitIcon = keyof typeof PATHS;

export function gitIcon(kind: GitIcon, big = false): SVGSVGElement {
  const svg = icon(PATHS[kind]);
  svg.setAttribute('class', big ? 'ico lg' : 'ico');
  svg.setAttribute('aria-hidden', 'true');
  return svg;
}
