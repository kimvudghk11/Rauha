/** 코드 탭에서 파일을 어떻게 미리 보여 줄지 고른다. 문자열만 보는 순수 함수라 화면과 main이 같이 쓴다. */

export type PreviewKind = 'markdown' | 'image';

/** 이미지 뷰어가 여는 파일 크기 상한(넘으면 열지 않는다) */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const IMAGE_MIME: Readonly<Record<string, string>> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon',
};

const MARKDOWN = new Set(['md', 'markdown', 'mdx']);

const extensionOf = (name: string): string | null => {
  const base = name.slice(name.lastIndexOf('/') + 1).toLowerCase();
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? null : base.slice(dot + 1);
};

export function imageMimeOf(name: string): string | null {
  const ext = extensionOf(name);
  return ext === null ? null : (IMAGE_MIME[ext] ?? null);
}

export function previewKindOf(name: string): PreviewKind | null {
  const ext = extensionOf(name);
  if (ext === null) return null;
  if (MARKDOWN.has(ext)) return 'markdown';
  return IMAGE_MIME[ext] === undefined ? null : 'image';
}

/**
 * 마크다운 속 이미지 주소 → 작업 폴더 기준 경로. 같은 작업 폴더 안의 그림 파일만 허락하고 나머지는 null.
 * 주소(http·data·file …)·절대 경로·드라이브 경로·작업 폴더 밖(`..`, 인코딩된 것 포함)·그림이 아닌 확장자는 null이다.
 * 실제로 읽을 때는 main이 링크를 다 푼 경로로 한 번 더 검사한다.
 */
export function workImagePath(markdownPath: string, src: string): string | null {
  if (src === '' || src.includes('\0')) return null;
  let target = src.replace(/[?#].*$/s, '');
  try {
    target = decodeURIComponent(target);
  } catch {
    return null;
  }
  if (target === '' || target.includes('\0')) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target) || /^[\\/]/.test(target)) return null;
  const parts = markdownPath.split('/').slice(0, -1);
  for (const part of target.split(/[\\/]+/)) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(part);
  }
  const out = parts.join('/');
  return imageMimeOf(out) === null ? null : out;
}
