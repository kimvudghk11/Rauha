import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TermEvent } from '../../shared/terminal-api.js';
import { TerminalHost, type StartRoot } from './terminal-host.js';

let dir = '';
let events: TermEvent[] = [];
let hosts: TerminalHost[] = [];

const make = (guard: (c: string) => string | null = () => null): TerminalHost => {
  const roots: StartRoot[] = [{ path: '', label: '작업 폴더', abs: dir }];
  const h = new TerminalHost({ platform: process.platform, env: () => process.env, home: homedir(), roots: () => roots, display: (abs) => abs, guard, emit: (e) => events.push(e) });
  hosts.push(h);
  return h;
};

const output = (id: string): string => events.filter((e): e is Extract<TermEvent, { type: 'out' }> => e.type === 'out' && e.id === id).map((e) => e.data).join('');
const exited = (id: string) => events.find((e): e is Extract<TermEvent, { type: 'exit' }> => e.type === 'exit' && e.id === id);
async function until(cond: () => boolean, ms = 20_000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('시간 안에 끝나지 않았어요');
    await new Promise((r) => setTimeout(r, 25));
  }
}
const opened = (h: TerminalHost): string => {
  const r = h.open('');
  if (!r.ok) throw new Error(r.message);
  return r.id;
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rauha-term-'));
  events = [];
});
afterEach(async () => {
  for (const h of hosts) h.disposeAll();
  hosts = [];
  await new Promise((r) => setTimeout(r, 100));
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

describe('터미널 명령 실행', () => {
  it('명령을 실행하고 출력과 종료 코드를 알린다', async () => {
    const h = make();
    const id = opened(h);
    expect(await h.run(id, 'echo hello-rauha')).toEqual({ ok: true });
    await until(() => exited(id) !== undefined);
    expect(output(id)).toContain('hello-rauha');
    expect(exited(id)?.code).toBe(0);
  });

  it('실패한 명령은 0이 아닌 종료 코드를 준다', async () => {
    const h = make();
    const id = opened(h);
    await h.run(id, 'node -e "process.exit(3)"');
    await until(() => exited(id) !== undefined);
    expect(exited(id)?.code).toBe(3);
  });

  it('명령은 터미널이 기억하는 폴더에서 돈다(cd 다음 명령부터)', async () => {
    await mkdir(join(dir, 'sub'));
    await writeFile(join(dir, 'sub', 'marker.txt'), 'x');
    const h = make();
    const id = opened(h);
    expect(await h.run(id, 'cd sub')).toEqual({ ok: true });
    await h.run(id, 'node -e "console.log(require(\'fs\').readdirSync(\'.\').join(\',\'))"');
    await until(() => output(id).includes('marker.txt'));
  });

  it('없는 폴더로 cd 하면 알리고 폴더는 그대로다', async () => {
    const h = make();
    const id = opened(h);
    expect(await h.run(id, 'cd nope')).toMatchObject({ ok: false, reason: 'bad-dir' });
    expect(await h.run(id, 'cd -')).toMatchObject({ ok: false, reason: 'bad-dir' });
  });

  it('막아야 하는 명령은 실행하지 않는다', async () => {
    const h = make((c) => (c.includes('.env') ? '비밀 파일' : null));
    const id = opened(h);
    expect(await h.run(id, 'cat .env')).toEqual({ ok: false, reason: 'blocked', message: '비밀 파일' });
    expect(events.filter((e) => e.type === 'start')).toHaveLength(0);
  });

  it('돌고 있는 명령을 멈출 수 있다', async () => {
    const h = make();
    const id = opened(h);
    await h.run(id, 'node -e "setTimeout(()=>{},60000)"');
    await until(() => events.some((e) => e.type === 'start'));
    await h.stop(id);
    await until(() => exited(id) !== undefined);
    expect(exited(id)?.note).toBe('멈췄어요.');
    expect(await h.run(id, 'echo again')).toEqual({ ok: true });
  });

  // GitHub Actions의 Windows 실행기에서는 PowerShell 아래 자식으로 stdin이 전달되지 않아 끝나지 않는다(개발 PC의 Windows에서는 통과).
  // 실행기 환경 차이라서 거기서만 건너뛰고, 맥·개발 PC에서는 그대로 확인한다.
  it.skipIf(process.platform === 'win32' && process.env['CI'] !== undefined)('돌고 있는 명령에게 입력을 보낼 수 있다', async () => {
    const h = make();
    const id = opened(h);
    await h.run(id, 'node -e "process.stdin.once(\'data\',d=>console.log(\'got:\'+String(d).trim()));console.log(\'ready\')"');
    await until(() => output(id).includes('ready'));
    await h.run(id, 'hi-there');
    await until(() => output(id).includes('got:hi-there'));
  });

  it('작업 폴더 목록에 없는 폴더로는 터미널을 열지 않는다', () => {
    const h = make();
    expect(h.open('../x')).toMatchObject({ ok: false });
  });

  it('닫힌 터미널에는 실행하지 않는다', async () => {
    const h = make();
    const id = opened(h);
    await h.close(id);
    expect(await h.run(id, 'echo x')).toMatchObject({ ok: false, reason: 'unknown' });
  });

  it('출력이 상한을 넘으면 멈춘다', async () => {
    const h = make();
    const id = opened(h);
    await h.run(id, 'node -e "const b=\'x\'.repeat(65536);const t=setInterval(()=>process.stdout.write(b),0)"');
    await until(() => exited(id) !== undefined, 30_000);
    expect(exited(id)?.note).toBe('출력이 너무 많아 멈췄어요.');
  }, 40_000);
});
