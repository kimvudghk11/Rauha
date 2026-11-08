import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DomainError } from '../../shared/domain-error.js';
import { AnalysisDocDto } from '../application/dto/analysis-doc.dto.js';
import type { AnalysisDocsPort, AskTimer } from '../application/ports.js';
import { AnalysisDocPath, AnalysisFolder } from '../domain/analysis-doc-path.js';

/** 파일 시스템 오류 중 "이미 있다" */
const isExists = (error: unknown): boolean => typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'EEXIST';

/**
 * 분석 문서를 저장소 안 `docs/...` 아래에 쓴다. 있는 파일은 덮어쓰지 않는다:
 * 새 문서는 "없을 때만 만들기"(wx)로 쓰고 이름이 겹치면 번호를 붙이며, 이어 쓰기는 첫 줄 표지가 같은 분석의 문서에만 한다.
 */
export class FileAnalysisDocs implements AnalysisDocsPort {
  /** root: 저장소 루트(분석을 시작한 레포 폴더) */
  constructor(private readonly root: string) {}

  async create(where: { date: string; topic: string }, markdown: string): Promise<string> {
    const folder = AnalysisFolder.choose(await this.existingFolders());
    const taken = new Set<string>();
    for (;;) {
      const path = AnalysisDocPath.plan({ folder, date: where.date, topic: where.topic, isTaken: (p) => taken.has(p) });
      AnalysisDocPath.assertWritable(path);
      const full = join(this.root, path);
      await mkdir(dirname(full), { recursive: true });
      try {
        await writeFile(full, markdown, { encoding: 'utf8', flag: 'wx' });
        return path;
      } catch (error) {
        if (!isExists(error)) throw error;
        taken.add(path);
      }
    }
  }

  async update(path: string, runId: string, markdown: string): Promise<void> {
    AnalysisDocPath.assertWritable(path);
    const full = join(this.root, path);
    let current: string;
    try {
      current = await readFile(full, 'utf8');
    } catch {
      throw new DomainError('DOC_GONE', `이어 쓸 분석 문서가 없어졌습니다: ${path}`);
    }
    if (AnalysisDocDto.markerOf(current) !== runId) throw new DomainError('DOC_NOT_OURS', `이 분석이 만든 문서가 아니라서 고쳐 쓰지 않습니다: ${path}`);
    await writeFile(full, markdown, 'utf8');
  }

  private async existingFolders(): Promise<string[]> {
    const found = await Promise.all(
      AnalysisFolder.candidates().map(async (folder) => {
        try {
          return (await stat(join(this.root, folder))).isDirectory() ? folder : null;
        } catch {
          return null;
        }
      }),
    );
    return found.filter((f): f is string => f !== null);
  }
}

/** 실제 시계로 기다림 한도를 재는 타이머. 기다리는 동안 앱이 꺼지는 것을 막지 않는다. */
export const realAskTimer: AskTimer = (ms) => {
  let handle: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<void>((resolve) => {
    handle = setTimeout(resolve, ms);
    handle.unref?.();
  });
  return { expired, cancel: () => clearTimeout(handle) };
};
