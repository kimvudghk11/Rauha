import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RoleSettingsDto } from '../application/dto/role-settings.dto.js';
import { FileRunLog } from './file-run-log.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('FileRunLog', () => {
  it('기록 폴더에 팀원 호출·검사 결과·요약·안내서를 남긴다', async () => {
    const runs = mkdtempSync(join(tmpdir(), 'rauha-runs-'));
    dirs.push(runs);
    const log = new FileRunLog(runs, 'abcdef123456', new Date(2026, 9, 25, 14, 2, 3), 'deadbeef');
    const call = { role: 'tester' as const, setting: RoleSettingsDto.defaults().get('tester'), userMessage: 'm', outputSchema: {}, canWrite: () => true };
    const usage = { model: 'claude-haiku-5-5', durationMs: 1, costUsd: 0, turns: 1, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, denials: [], endReason: 'success' };
    await log.recordCall('tester', 1, call, { output: { ok: true }, error: null, usage, fetched: [] });
    await log.recordChecks('red-1', []);
    const dir = await log.finish({ status: 'complete' }, '# 안내서');

    expect(dir.replace(/\\/g, '/')).toBe(`${runs.replace(/\\/g, '/')}/20261025-140203-abcdef12`);
    expect(readdirSync(join(dir, 'calls'))).toEqual(['01-tester-1.json']);
    expect(JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'))).toMatchObject({ status: 'complete', promptHash: 'deadbeef' });
    expect(readFileSync(join(dir, 'guide.md'), 'utf8')).toBe('# 안내서');
    expect(readdirSync(dir)).toContain('checks-red-1.json');
  });

  it('팀원 호출 기록에 찾아본 도구를 한 줄로 남긴다', async () => {
    const runs = mkdtempSync(join(tmpdir(), 'rauha-runs-'));
    dirs.push(runs);
    const log = new FileRunLog(runs, 'abcdef123456', new Date(2026, 9, 25, 14, 2, 3), 'deadbeef');
    const call = { role: 'answerer' as const, setting: RoleSettingsDto.defaults().get('answerer'), userMessage: 'm', outputSchema: {}, canWrite: () => false };
    const usage = { model: 'm', durationMs: 1, costUsd: 0, turns: 1, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, denials: [], endReason: 'success', tools: [{ name: 'Grep', count: 3 }, { name: 'Read', count: 5 }] };
    await log.recordCall('answerer', 1, call, { output: null, error: null, usage, fetched: [] });
    const dir = await log.finish({}, '');
    expect(JSON.parse(readFileSync(join(dir, 'calls', '01-answerer-1.json'), 'utf8'))).toMatchObject({ toolsLine: 'Grep 3 · Read 5' });
  });
});
