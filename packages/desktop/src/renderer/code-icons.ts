import { icon } from './dom.js';

/** 탐색기 도구줄 아이콘(24×24 선 그림) */
const PATHS = {
  newFile: 'M6 3h8l4 4v14H6z M12 11v6 M9 14h6',
  newFolder: 'M3 7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M12 10v6 M9 13h6',
  rename: 'M4 20l4-1 11-11-3-3L5 16z',
  duplicate: 'M9 9h11v11H9z M5 15V4h11',
  move: 'M3 7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M8 13h7 M12 10l3 3-3 3',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13',
  refresh: 'M20 12a8 8 0 1 1-2.6-5.9 M20 4v5h-5',
} as const;

export type CodeIcon = keyof typeof PATHS;

export const codeIcon = (kind: CodeIcon): SVGSVGElement => icon(PATHS[kind]);
