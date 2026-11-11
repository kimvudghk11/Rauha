import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TermEvent } from '../../shared/terminal-api.js';
import { MAX_TERMINALS, PtyHost, type PtyLike } from './pty-host.js';

class FakePty implements PtyLike {
  readonly pid = 4242;
  written: string[] = [];
  size = { cols: 0, rows: 0 };
  paused = false;
  killed = false;
  private dataCb: (d: string) => void = () => undefined;
  private exitCb: (e: { exitCode: number }) => void = () => undefined;
  onData(cb: (d: string) => void): void {
    this.dataCb = cb;
  }
  onExit(cb: (e: { exitCode: number }) => void): void {
    this.exitCb = cb;
  }
  write(d: string): void {
    this.written.push(d);
  }
  resize(cols: number, rows: number): void {
    this.size = { cols, rows };
  }
  pause(): void {
    this.paused = true;
  }
  resume(): void {
    this.paused = false;
  }
  kill(): void {
    this.killed = true;
  }
  emitData(d: string): void {
    this.dataCb(d);
  }
  emitExit(code: number): void {
    this.exitCb({ exitCode: code });
  }
}

function setup(over: Partial<{ roots: { path: string; label: string; abs: string }[]; spawnThrows: boolean }> = {}) {
  const events: TermEvent[] = [];
  const ptys: FakePty[] = [];
  const spawned: { file: string; args: readonly string[]; cwd: string; env: Record<string, string>; cols: number; rows: number }[] = [];
  const killed: number[] = [];
  const host = new PtyHost({
    platform: 'linux',
    env: () => ({ PATH: '/usr/bin', SHELL: '/bin/bash', RAUHA_DATA_DIR: '/secret', ELECTRON_RUN_AS_NODE: '1' }),
    roots: () => over.roots ?? [{ path: '', label: 'Work folder', abs: '/work' }, { path: 'repo', label: 'repo', abs: '/work/repo' }],
    display: (abs) => abs,
    exists: () => true,
    spawn: (file, args, opts) => {
      if (over.spawnThrows) throw new Error('boom');
      const p = new FakePty();
      ptys.push(p);
      spawned.push({ file, args, ...opts });
      return p;
    },
    killTree: (pid) => killed.push(pid),
    emit: (e) => events.push(e),
  });
  return { host, events, ptys, spawned, killed };
}

const open = (host: PtyHost, rootPath = '') => host.open({ rootPath, cols: 100, rows: 30 });

describe('PtyHost: 터미널 열기', () => {
  it('작업 폴더에서 main이 고른 셸로 PTY를 띄우고 처음 크기를 넘긴다', () => {
    const { host, spawned } = setup();
    const r = open(host);
    expect(r.ok).toBe(true);
    expect(spawned[0]).toMatchObject({ file: '/bin/bash', args: ['-l'], cwd: '/work', cols: 100, rows: 30 });
  });

  it('셸에 rauha 내부 환경 변수를 넘기지 않는다', () => {
    const { host, spawned } = setup();
    open(host);
    expect(spawned[0]?.env['RAUHA_DATA_DIR']).toBeUndefined();
    expect(spawned[0]?.env['ELECTRON_RUN_AS_NODE']).toBeUndefined();
    expect(spawned[0]?.env['TERM']).toBe('xterm-256color');
  });

  it('작업 폴더 밖이거나 목록에 없는 폴더에서는 열지 않는다(렌더러가 임의 경로를 정할 수 없다)', () => {
    const { host, spawned } = setup();
    expect(open(host, '../..').ok).toBe(false);
    expect(open(host, '/etc').ok).toBe(false);
    expect(spawned).toHaveLength(0);
  });

  it(`터미널은 최대 ${MAX_TERMINALS}개까지만 연다`, () => {
    const { host } = setup();
    for (let i = 0; i < MAX_TERMINALS; i++) expect(open(host).ok).toBe(true);
    const r = open(host);
    expect(r.ok).toBe(false);
  });

  it('셸을 못 띄우면 이유를 담아 실패로 돌려준다', () => {
    const { host } = setup({ spawnThrows: true });
    const r = open(host);
    expect(r).toEqual({ ok: false, message: 'Could not start the shell: boom' });
  });
});

describe('PtyHost: 입출력', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('출력은 잠깐 모아서 한 번에 화면으로 보낸다', () => {
    const { host, events, ptys } = setup();
    const r = open(host);
    if (!r.ok) throw new Error('open');
    ptys[0]?.emitData('he');
    ptys[0]?.emitData('llo');
    expect(events).toHaveLength(0);
    vi.advanceTimersByTime(20);
    expect(events).toEqual([{ type: 'data', id: r.id, data: 'hello' }]);
  });

  it('입력은 PTY로 그대로 쓴다. 너무 긴 입력과 모르는 id는 버린다', () => {
    const { host, ptys } = setup();
    const r = open(host);
    if (!r.ok) throw new Error('open');
    host.write(r.id, 'ls\r');
    host.write(r.id, 'x'.repeat(70_000));
    host.write('3f2b8c1e-5d4a-4b7e-9c1d-0a1b2c3d4e5f', 'nope');
    expect(ptys[0]?.written).toEqual(['ls\r']);
  });

  it('크기 조절은 정수·허용 범위로 맞춰서 PTY에 알린다', () => {
    const { host, ptys } = setup();
    const r = open(host);
    if (!r.ok) throw new Error('open');
    host.resize(r.id, 120.9, 40);
    expect(ptys[0]?.size).toEqual({ cols: 120, rows: 40 });
    host.resize(r.id, 99999, 0);
    expect(ptys[0]?.size).toEqual({ cols: 500, rows: 1 });
  });

  it('화면이 못 따라가면 PTY를 멈추고, 다 그렸다는 확인이 오면 다시 읽는다', () => {
    const { host, ptys } = setup();
    const r = open(host);
    if (!r.ok) throw new Error('open');
    const big = 'a'.repeat(600 * 1024);
    ptys[0]?.emitData(big);
    vi.advanceTimersByTime(20);
    expect(ptys[0]?.paused).toBe(true);
    host.ack(r.id, big.length);
    expect(ptys[0]?.paused).toBe(false);
  });

  it('한 번에 보내는 출력 조각은 상한을 넘지 않는다', () => {
    const { host, events, ptys } = setup();
    const r = open(host);
    if (!r.ok) throw new Error('open');
    ptys[0]?.emitData('b'.repeat(200 * 1024));
    vi.advanceTimersByTime(20);
    for (const e of events) if (e.type === 'data') expect(e.data.length).toBeLessThanOrEqual(64 * 1024);
    expect(events.map((e) => (e.type === 'data' ? e.data.length : 0)).reduce((a, b) => a + b, 0)).toBe(200 * 1024);
  });

  it('셸이 끝나면 남은 출력을 먼저 보내고 종료 코드를 알린다', () => {
    const { host, events, ptys } = setup();
    const r = open(host);
    if (!r.ok) throw new Error('open');
    ptys[0]?.emitData('bye');
    ptys[0]?.emitExit(3);
    expect(events).toEqual([
      { type: 'data', id: r.id, data: 'bye' },
      { type: 'exit', id: r.id, code: 3 },
    ]);
    host.write(r.id, 'late');
    expect(ptys[0]?.written).toEqual([]);
  });
});

describe('PtyHost: 닫기·정리', () => {
  it('터미널을 닫으면 프로세스 트리를 끝내고 PTY를 닫는다', () => {
    const { host, ptys, killed } = setup();
    const r = open(host);
    if (!r.ok) throw new Error('open');
    host.close(r.id);
    expect(killed).toEqual([4242]);
    expect(ptys[0]?.killed).toBe(true);
  });

  it('닫은 터미널의 늦은 출력·종료는 화면으로 보내지 않는다', () => {
    vi.useFakeTimers();
    const { host, events, ptys } = setup();
    const r = open(host);
    if (!r.ok) throw new Error('open');
    host.close(r.id);
    ptys[0]?.emitData('late');
    ptys[0]?.emitExit(0);
    vi.advanceTimersByTime(50);
    expect(events).toEqual([]);
    vi.useRealTimers();
  });

  it('모두 닫으면(앱 종료·작업 폴더 변경) 열린 터미널 전부의 프로세스 트리를 끝낸다', () => {
    const { host, killed } = setup();
    open(host);
    open(host);
    host.disposeAll();
    expect(killed).toHaveLength(2);
    expect(open(host).ok).toBe(true);
  });
});
