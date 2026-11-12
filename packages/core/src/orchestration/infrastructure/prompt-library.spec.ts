import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PromptLibrary } from './prompt-library.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function folder(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'rauha-prompts-'));
  dirs.push(dir);
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
}

const ALL = { '_common.md': 'C', '_kit-browser.md': 'KB', '_kit-aws.md': 'KA', '_kit-connectors.md': 'KC', 'intake.md': 'I', 'tester.md': 'T', 'implementer.md': 'M', 'reviewer.md': 'R', 'router.md': 'O', 'answerer.md': 'A', 'surveyor.md': 'S', 'writer.md': 'W', 'designer.md': 'D', 'operator.md': 'P', 'debugger.md': 'B', 'riskchecker.md': 'K', 'planner.md': 'N', 'chief.md': 'CHIEF', 'bm.md': 'BM', 'marketer.md': 'MARKETER', 'growth.md': 'GROWTH', 'uxdesigner.md': 'UXDESIGNER', 'brand.md': 'BRAND', 'securitychecker.md': 'SECURITYCHECKER', 'releaser.md': 'RELEASER', 'splitter.md': 'SPLITTER', 'publisher.md': 'PUBLISHER' };

describe('PromptLibrary', () => {
  it('공통 앞부분과 역할 프롬프트를 이어 붙인다', async () => {
    const lib = await PromptLibrary.load(folder({ ...ALL, '_common.md': 'COMMON' }));
    expect(lib.system('tester')).toBe('COMMON\n\nT');
    expect(lib.hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('프롬프트가 바뀌면 해시도 바뀐다', async () => {
    const a = await PromptLibrary.load(folder(ALL));
    const b = await PromptLibrary.load(folder({ ...ALL, 'tester.md': 'T2' }));
    expect(a.hash).not.toBe(b.hash);
  });

  it('리뷰어 프롬프트도 공통 원칙과 합쳐 읽는다', async () => {
    const lib = await PromptLibrary.load(folder(ALL));
    expect(lib.system('reviewer')).toBe('C\n\nR');
  });

  it('라우터·답변 팀원은 작업용 공통 앞부분 없이 자기 프롬프트만 쓴다', async () => {
    const lib = await PromptLibrary.load(folder(ALL));
    expect(lib.system('router')).toBe('O');
    expect(lib.system('answerer')).toBe('A');
  });

  it('저장소 조사 팀원도 공통 앞부분 없이 자기 프롬프트만 쓴다', async () => {
    const lib = await PromptLibrary.load(folder(ALL));
    expect(lib.system('surveyor')).toBe('S');
  });

  it('도구 묶음을 붙인 호출에만 그 묶음의 사용법을 덧붙인다', async () => {
    const lib = await PromptLibrary.load(folder(ALL));
    expect(lib.system('answerer', [])).toBe('A');
    expect(lib.system('answerer', ['aws'])).toBe('A\n\nKA');
    expect(lib.system('debugger', ['browser', 'aws'])).toBe('B\n\nKB\n\nKA');
  });

  it('역할 프롬프트가 없으면 알려 준다', async () => {
    await expect(PromptLibrary.load(folder({ '_common.md': 'C', '_kit-browser.md': 'KB', '_kit-aws.md': 'KA', '_kit-connectors.md': 'KC' }))).rejects.toThrow(/intake\.md/);
  });

  it('저장소의 기본 프롬프트를 읽을 수 있다', async () => {
    const lib = await PromptLibrary.load(PromptLibrary.defaultDir());
    expect(lib.system('implementer')).toContain('<role>');
  });
});
