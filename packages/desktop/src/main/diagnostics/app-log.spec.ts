import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Redactor } from '../../shared/diagnostics.js';
import { AppLog } from './app-log.js';

const HOME = '/Users/kimpyeonghwa';
const FAKE_KEY = ['sk', 'ant', 'api03', 'abcdefghijklmnop1234567890'].join('-');
let dir = '';
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rauha-applog-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const make = (maxBytes?: number) => new AppLog({ dir, now: () => new Date('2026-11-09T01:00:00.000Z'), redactor: Redactor.of(HOME, 'kimpyeonghwa'), ...(maxBytes === undefined ? {} : { maxBytes }) });

describe('앱 오류 로그', () => {
  it('오류를 메모리 줄로 쌓고 같은 내용을 app.log 파일에도 쓴다', async () => {
    const log = make();
    log.record('main', 'Error: boom');
    expect(log.lines().at(-1)).toBe('2026-11-09T01:00:00.000Z [main] Error: boom');
    expect(await readFile(join(dir, 'app.log'), 'utf8')).toContain('[main] Error: boom');
  });

  it('메모리에도 파일에도 홈 경로·이메일·키가 새지 않는다', async () => {
    const log = make();
    log.record('renderer', `fail ${HOME}/work ${FAKE_KEY} kimpyeonghwa@example.com`);
    const file = await readFile(join(dir, 'app.log'), 'utf8');
    for (const text of [log.lines().join('\n'), file]) {
      for (const secret of ['kimpyeonghwa', 'example.com', FAKE_KEY]) expect(text).not.toContain(secret);
    }
  });

  it('파일이 1MB를 넘으면 app.log.1로 돌리고 새 파일에 쓴다', async () => {
    const log = make(200);
    for (let i = 0; i < 10; i++) log.record('main', `오류 번호 ${i} ${'x'.repeat(40)}`);
    const names = (await readdir(dir)).sort();
    expect(names).toEqual(['app.log', 'app.log.1']);
    expect(await readFile(join(dir, 'app.log'), 'utf8')).toContain('오류 번호 9');
  });

  it('다시 켜면 지난번 파일의 끝 줄을 이어받는다', async () => {
    await writeFile(join(dir, 'app.log'), 'old line 1\nold line 2\n');
    const log = make();
    expect(log.lines()).toContain('old line 2');
  });

  it('파일에 못 써도 던지지 않고 메모리에는 남는다', async () => {
    // 폴더 자리에 파일을 놓아 로그 폴더를 만들 수 없게 한다
    await writeFile(join(dir, 'blocker'), 'x');
    const log = new AppLog({ dir: join(dir, 'blocker', 'logs'), now: () => new Date(0), redactor: Redactor.of(HOME, 'kimpyeonghwa') });
    expect(() => log.record('main', 'x')).not.toThrow();
    expect(log.lines().some((l) => l.includes('[main] x'))).toBe(true);
  });
});
