export type FolderKind = 'repo' | 'docs' | 'other';

/** 폴더 하나에서 본 것(내용은 읽지 않고 이름과 확장자만 센다) */
export interface FolderFacts {
  /** 자기 안에 .git이 있다 */
  readonly hasGit: boolean;
  /** 바로 아래 파일들의 확장자(점 없이, 소문자) */
  readonly extensions: readonly string[];
}

const DOC_EXTENSIONS = new Set(['md', 'mdx', 'pdf', 'docx', 'doc', 'txt', 'pptx', 'xlsx', 'hwp', 'hwpx']);

/** 이 폴더는 가지 않는다: 생성물·의존성·도구 폴더 */
export const SKIPPED_FOLDERS: ReadonlySet<string> = new Set(['node_modules', 'dist', 'build', '.venv', 'venv', '.next', 'target', '.git', '.gradle', '__pycache__', '.idea', '.vscode', 'out', 'coverage']);

/**
 * 폴더 종류: .git이 있으면 레포, 아니면 파일 대부분(절반 넘게)이 문서(md·pdf·docx …)면 문서 폴더, 그 밖은 기타.
 * 파일이 하나도 없으면 기타다.
 */
export function classifyFolder(facts: FolderFacts): FolderKind {
  if (facts.hasGit) return 'repo';
  if (facts.extensions.length === 0) return 'other';
  const docs = facts.extensions.filter((e) => DOC_EXTENSIONS.has(e)).length;
  return docs * 2 > facts.extensions.length ? 'docs' : 'other';
}
