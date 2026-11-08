import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DomainError } from '../../shared/domain-error.js';
import { AnalysisDocDto } from '../application/dto/analysis-doc.dto.js';
import { FileAnalysisDocs, realAskTimer } from './file-analysis-docs.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const repo = () => {
  const d = mkdtempSync(join(tmpdir(), 'rauha-analysis-'));
  dirs.push(d);
  return d;
};
const doc = (id: string, body = '본문') => `${AnalysisDocDto.marker(id)}\n# 제목\n\n${body}\n`;

describe('FileAnalysisDocs', () => {
  it('docs/analysis 폴더가 없으면 만들고 날짜-주제.md로 새 문서를 쓴다', async () => {
    const root = repo();
    const path = await new FileAnalysisDocs(root).create({ date: '2026-11-08', topic: '결제 이중 승인' }, doc('r1'));
    expect(path).toBe('docs/analysis/2026-11-08-결제-이중-승인.md');
    expect(readFileSync(join(root, path), 'utf8')).toContain('rauha-analysis:r1');
  });

  it('저장소가 이미 쓰는 분석 문서 폴더가 있으면 거기에 쓴다', async () => {
    const root = repo();
    mkdirSync(join(root, 'docs', 'investigations'), { recursive: true });
    const path = await new FileAnalysisDocs(root).create({ date: '2026-11-08', topic: 'x' }, doc('r1'));
    expect(path.startsWith('docs/investigations/')).toBe(true);
  });

  it('같은 이름의 문서가 이미 있으면 덮어쓰지 않고 새 이름으로 쓴다', async () => {
    const root = repo();
    mkdirSync(join(root, 'docs', 'analysis'), { recursive: true });
    writeFileSync(join(root, 'docs', 'analysis', '2026-11-08-결제.md'), '사용자가 직접 쓴 글');
    const path = await new FileAnalysisDocs(root).create({ date: '2026-11-08', topic: '결제' }, doc('r1'));
    expect(path).toBe('docs/analysis/2026-11-08-결제-2.md');
    expect(readFileSync(join(root, 'docs', 'analysis', '2026-11-08-결제.md'), 'utf8')).toBe('사용자가 직접 쓴 글');
  });

  it('두 분석이 동시에 같은 주제로 와도 서로 다른 파일에 쓴다', async () => {
    const root = repo();
    const docs = new FileAnalysisDocs(root);
    const [a, b] = await Promise.all([docs.create({ date: '2026-11-08', topic: '결제' }, doc('r1')), docs.create({ date: '2026-11-08', topic: '결제' }, doc('r2'))]);
    expect(a).not.toBe(b);
    expect(readFileSync(join(root, a), 'utf8')).toContain('r1');
    expect(readFileSync(join(root, b), 'utf8')).toContain('r2');
  });

  it('이 분석이 만든 문서에는 이어 쓸 수 있다', async () => {
    const root = repo();
    const docs = new FileAnalysisDocs(root);
    const path = await docs.create({ date: '2026-11-08', topic: '결제' }, doc('r1', '1단계'));
    await docs.update(path, 'r1', doc('r1', '1단계\n2단계'));
    expect(readFileSync(join(root, path), 'utf8')).toContain('2단계');
  });

  it('표지가 없거나 다른 분석의 문서는 고쳐 쓰지 않는다', async () => {
    const root = repo();
    mkdirSync(join(root, 'docs', 'analysis'), { recursive: true });
    writeFileSync(join(root, 'docs', 'analysis', 'mine.md'), '# 사용자 문서');
    writeFileSync(join(root, 'docs', 'analysis', 'other.md'), doc('r9'));
    const docs = new FileAnalysisDocs(root);
    await expect(docs.update('docs/analysis/mine.md', 'r1', doc('r1'))).rejects.toThrow(DomainError);
    await expect(docs.update('docs/analysis/other.md', 'r1', doc('r1'))).rejects.toThrow(DomainError);
    expect(readFileSync(join(root, 'docs', 'analysis', 'mine.md'), 'utf8')).toBe('# 사용자 문서');
  });

  it('없어진 문서에 이어 쓰라고 하면 거절한다', async () => {
    const root = repo();
    await expect(new FileAnalysisDocs(root).update('docs/analysis/gone.md', 'r1', doc('r1'))).rejects.toThrow(DomainError);
  });

  it('docs 밖이거나 마크다운이 아닌 곳에는 쓰지 않는다', async () => {
    const root = repo();
    const docs = new FileAnalysisDocs(root);
    await expect(docs.update('src/a.md', 'r1', doc('r1'))).rejects.toThrow(DomainError);
    await expect(docs.update('docs/../src/a.md', 'r1', doc('r1'))).rejects.toThrow(DomainError);
    expect(existsSync(join(root, 'src'))).toBe(false);
  });
});

describe('realAskTimer', () => {
  it('시간이 되면 끝나고, 거두면 끝나지 않는다', async () => {
    const quick = realAskTimer(5);
    await expect(quick.expired).resolves.toBeUndefined();
    const cancelled = realAskTimer(5);
    cancelled.cancel();
    const raced = await Promise.race([cancelled.expired.then(() => 'expired'), new Promise((r) => setTimeout(() => r('quiet'), 30))]);
    expect(raced).toBe('quiet');
  });
});
