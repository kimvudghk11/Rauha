import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { liveProfileResolver } from './compose.js';

const home = mkdtempSync(join(tmpdir(), 'rauha-live-'));
const before = process.env['RAUHA_CONFIG'];
process.env['RAUHA_CONFIG'] = join(home, 'missing-config.toml');
afterAll(() => {
  if (before === undefined) delete process.env['RAUHA_CONFIG'];
  else process.env['RAUHA_CONFIG'] = before;
  rmSync(home, { recursive: true, force: true });
});

describe('팀 작업 계정은 부를 때마다 지금 고른 계정', () => {
  it('앱을 다시 켜지 않아도 같은 해석기에서 personal → work 로 바뀐다', async () => {
    const resolve = await liveProfileResolver(home);
    expect(resolve(home, 'personal').name).toBe('personal');
    expect(resolve(home, 'work').name).toBe('work');
    expect(resolve(home, null).name).toBe('personal');
  });
});
