import { DomainError } from '../../shared/domain-error.js';
import { toPosixPath } from '../../shared/path-pattern.js';
import { WritePolicy } from '../../orchestration/domain/write-policy.js';

/** 저장소가 이미 쓰는 분석 문서 폴더 후보(앞이 우선). 하나도 없으면 첫째를 새로 만든다. */
const FOLDERS = ['docs/analysis', 'docs/analyses', 'docs/investigations'] as const;
const SLUG_LIMIT = 40;
const MAX_SUFFIX = 99;

export class AnalysisFolder {
  private constructor() {}

  /** existing: 저장소에 있는 폴더들(저장소 루트 기준). 이미 있는 방식을 따르고, 없으면 `docs/analysis`. */
  static choose(existing: readonly string[]): string {
    const have = new Set(existing.map((e) => toPosixPath(e).replace(/\/+$/, '')));
    return FOLDERS.find((f) => have.has(f)) ?? FOLDERS[0];
  }

  static candidates(): readonly string[] {
    return FOLDERS;
  }
}

/** 분석 문서의 위치 규칙: `<폴더>/YYYY-MM-DD-<주제>.md`, 이미 있으면 덮어쓰지 않고 번호를 붙인다. */
export class AnalysisDocPath {
  private constructor() {}

  static plan(input: { folder: string; date: string; topic: string; isTaken: (path: string) => boolean }): string {
    const slug =
      input.topic
        .trim()
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, SLUG_LIMIT)
        .replace(/-+$/g, '') || 'analysis';
    const stem = `${input.folder.replace(/\/+$/, '')}/${input.date}-${slug}`;
    for (let n = 1; n <= MAX_SUFFIX; n += 1) {
      const path = n === 1 ? `${stem}.md` : `${stem}-${n}.md`;
      if (!input.isTaken(path)) return path;
    }
    throw new DomainError('DOC_NAME_TAKEN', `같은 이름의 분석 문서가 너무 많습니다: ${stem}`);
  }

  /** 문서 팀원과 같은 범위(docs 아래)의 마크다운만 쓴다. 저장소 밖(`..`, 절대 경로)은 거절한다. */
  static assertWritable(path: string): void {
    const p = toPosixPath(path);
    const outside = p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.split('/').includes('..');
    if (outside || !/\.md$/i.test(p) || !WritePolicy.forScope([]).allows('writer', p, false)) {
      throw new DomainError('WRITE_DENIED', `분석 문서는 docs 아래 마크다운 파일로만 쓸 수 있습니다: ${path}`);
    }
  }
}
