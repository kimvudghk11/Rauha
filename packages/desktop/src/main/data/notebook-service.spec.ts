import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NotebookService } from './notebook-service.js';

function setup(files: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'rauha-notebook-'));
  let n = 0;
  const service = NotebookService.open({
    file: join(dir, 'notebook.json'),
    home: '/Users/me',
    newId: () => `id${(n += 1)}`,
    now: () => '2026-11-24T02:00:00.000Z',
    readText: (p) => files[p.replace(/\\/g, '/')] ?? null,
  });
  return { service, dir };
}

describe('rauha 노트 서비스', () => {
  it('"라우하에 저장해줘"로 받은 글을 데이터 폴더에 남기고 다시 열어도 그대로다', async () => {
    const { service, dir } = setup();
    expect(await service.remember({ title: 'memory.md', text: 'VPN 켜는 법', source: '/Users/me/memory.md' })).toContain('rauha 기억에 남겼어요');
    expect(JSON.parse(readFileSync(join(dir, 'notebook.json'), 'utf8')).notes[0].title).toBe('memory.md');
    const again = NotebookService.open({ file: join(dir, 'notebook.json'), home: '/Users/me', newId: () => 'x', now: () => '', readText: () => null });
    expect(again.memoryBlock()).toContain('VPN 켜는 법');
  });

  it('항상 따를 룰 파일은 읽을 수 있을 때만 남기고(~ 는 홈으로 푼다), 팀원 규칙 글에 지금 내용을 싣는다', async () => {
    const files: Record<string, string> = { '/Users/me/repos/rules/RULES.md': '# 백엔드 룰\n- DDD' };
    const { service } = setup(files);
    expect(await service.keepRule('~/repos/rules/RULES.md')).toContain('/Users/me/repos/rules/RULES.md');
    expect(service.rulesBlock()).toContain('- DDD');
    files['/Users/me/repos/rules/RULES.md'] = '# 백엔드 룰\n- DDD\n- 테스트 먼저';
    expect(service.rulesBlock()).toContain('- 테스트 먼저');
    await expect(service.keepRule('/Users/me/none.md')).rejects.toThrow(/읽을 수 없/);
  });

  it('비밀 파일은 룰로 남기지 않는다', async () => {
    const { service } = setup({ '/Users/me/app/.env': 'KEY=1' });
    await expect(service.keepRule('/Users/me/app/.env')).rejects.toThrow(/secrets/);
    expect(service.rulesBlock()).toBe('');
  });

  it('지우면 다음 호출부터 붙지 않는다', async () => {
    const { service } = setup({ '/r/R.md': '룰' });
    await service.keepRule('/r/R.md');
    await service.remember({ title: 't', text: '기억', source: null });
    for (const item of [...service.get().rules, ...service.get().notes]) await service.forget(item.id);
    expect(service.rulesBlock()).toBe('');
    expect(service.memoryBlock()).toBe('');
  });

  it('저장본이 깨져 있으면 빈 노트로 연다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rauha-notebook-'));
    writeFileSync(join(dir, 'notebook.json'), '{깨짐');
    expect(NotebookService.open({ file: join(dir, 'notebook.json'), home: '/h', newId: () => 'x', now: () => '', readText: () => null }).get()).toEqual({ notes: [], rules: [] });
  });
});
