import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import { ConnectorBook, ConnectorPreset, connectorServers, type ConnectorServers } from '@rauha/core';
import { customInputOf, isSettled, safeError, statusFromSdk, type ConnectorListView, type ConnectorReply, type ConnectorStatus, type SdkServerStatus } from '../../shared/connector-api.js';

/** Claude Code 한 프로세스에 MCP 서버를 붙여 상태를 묻고, 로그인(OAuth)을 시키는 창구. 모델은 부르지 않는다. */
export interface ConnectorProbe {
  status(name: string): Promise<SdkServerStatus>;
  /** 로그인 시작. 브라우저로 열 주소를 돌려준다(이미 로그인돼 있으면 null). Claude Code 가 localhost 로 돌아오는 응답을 받아 토큰을 자기 설정 폴더에 저장한다. */
  authenticate(name: string): Promise<{ authUrl: string | null }>;
  /** Claude Code 에 저장된 그 서버의 로그인을 지운다 */
  clearAuth(name: string): Promise<void>;
  close(): void;
}

export interface ConnectorStore {
  load(): Promise<ConnectorBook>;
  save(book: ConnectorBook): Promise<void>;
}

export interface ConnectorServiceDeps {
  readonly store: ConnectorStore;
  readonly openProbe: (servers: Record<string, McpServerConfig>) => Promise<ConnectorProbe>;
  /** 시스템 브라우저로 연다(https 만) */
  readonly openExternal: (url: string) => Promise<void>;
  readonly notify: (view: ConnectorListView) => void;
  /** 상태를 다시 묻는 간격 */
  readonly pollMs?: number;
  /** 브라우저 로그인을 기다리는 최대 시간 */
  readonly timeoutMs?: number;
}

const POLL_MS = 1500;
const TIMEOUT_MS = 5 * 60_000;
/** 처음 접속(pending)을 기다리는 최대 횟수 */
const SETTLE_TRIES = 20;

interface RowState {
  readonly status: ConnectorStatus;
  readonly note: string | null;
}

const errorText = (e: unknown): string => safeError(e instanceof Error ? e.message : String(e));

/**
 * 설정 → 커넥터. 목록(이름·주소)은 rauha 가 파일에 두고, 로그인과 토큰은 Claude Code 가 계정 설정 폴더(CLAUDE_CONFIG_DIR)에 둔다.
 * rauha 는 토큰을 읽지도 옮기지도 않는다.
 */
export class ConnectorService {
  private book: ConnectorBook = ConnectorBook.empty();
  private loaded: Promise<void> | null = null;
  private readonly states = new Map<string, RowState>();
  private readonly running = new Map<string, { cancelled: boolean; done: Promise<void> }>();

  constructor(private readonly deps: ConnectorServiceDeps) {}

  async list(): Promise<ConnectorListView> {
    await this.ready();
    return this.view();
  }

  /** 팀원 실행에 붙일 서버. 로그인이 필요하거나 접속에 실패한 것은 뺀다(도구 없이 설명만 늘어서). */
  servers(): ConnectorServers {
    const usable = this.book.list().filter((c) => !['needs-auth', 'failed', 'signing-in'].includes(this.stateOf(c.serverName).status));
    return connectorServers(ConnectorBook.of(usable));
  }

  async refresh(): Promise<ConnectorListView> {
    await this.ready();
    const names = this.book.serverNames().filter((n) => !this.running.has(n));
    if (names.length === 0) return this.view();
    for (const n of names) this.states.set(n, { status: 'checking', note: null });
    this.emit();
    const all = connectorServers(this.book).servers;
    let probe: ConnectorProbe | null = null;
    try {
      probe = await this.deps.openProbe(Object.fromEntries(names.map((n) => [n, all[n]!])));
      for (const n of names) {
        const status = await this.settle(probe, n);
        this.states.set(n, { status: statusFromSdk(status), note: null });
      }
    } catch (e) {
      for (const n of names) this.states.set(n, { status: 'failed', note: errorText(e) });
    } finally {
      probe?.close();
    }
    return this.emit();
  }

  async addPreset(id: unknown): Promise<ConnectorReply> {
    return this.change(async () => {
      const added = this.book.addPreset(ConnectorPreset.of(typeof id === 'string' ? id : ''));
      return added.serverName;
    });
  }

  async addCustom(input: unknown): Promise<ConnectorReply> {
    const custom = customInputOf(input);
    if (custom === null) return { ok: false, error: 'Enter a name and an https address.', view: await this.list() };
    return this.change(async () => this.book.addCustom(custom.label, custom.url).serverName);
  }

  /** 상태를 보고, 로그인이 필요하면 브라우저를 연다. 기다림은 뒤에서 이어 가고 바로 돌려준다. */
  async connect(id: unknown): Promise<ConnectorReply> {
    await this.ready();
    try {
      const connector = this.book.find(typeof id === 'string' ? id : '');
      this.start(connector.serverName);
      return { ok: true, view: this.view() };
    } catch (e) {
      return { ok: false, error: errorText(e), view: this.view() };
    }
  }

  cancel(id: unknown): void {
    const run = typeof id === 'string' ? this.running.get(id) : undefined;
    if (run !== undefined) run.cancelled = true;
  }

  async remove(id: unknown): Promise<ConnectorReply> {
    await this.ready();
    try {
      const connector = this.book.find(typeof id === 'string' ? id : '');
      this.cancel(connector.serverName);
      await this.clearAuth(connector.serverName);
      this.book.remove(connector.serverName);
      this.states.delete(connector.serverName);
      await this.deps.store.save(this.book);
      return { ok: true, view: this.emit() };
    } catch (e) {
      return { ok: false, error: errorText(e), view: this.view() };
    }
  }

  /** 지금 도는 연결(로그인 기다림)이 끝날 때까지(테스트와 앱 종료용) */
  async settled(id: string): Promise<void> {
    await this.running.get(id)?.done;
  }

  private async change(add: () => Promise<string>): Promise<ConnectorReply> {
    await this.ready();
    try {
      const name = await add();
      await this.deps.store.save(this.book);
      this.start(name);
      return { ok: true, view: this.view() };
    } catch (e) {
      return { ok: false, error: errorText(e), view: this.view() };
    }
  }

  private start(name: string): void {
    if (this.running.has(name)) return;
    const run = { cancelled: false, done: Promise.resolve() };
    run.done = this.signIn(name, run).finally(() => {
      this.running.delete(name);
      this.emit();
    });
    this.running.set(name, run);
  }

  private async signIn(name: string, run: { cancelled: boolean }): Promise<void> {
    this.states.set(name, { status: 'checking', note: null });
    this.emit();
    let probe: ConnectorProbe | null = null;
    try {
      probe = await this.deps.openProbe({ [name]: connectorServers(this.book).servers[name]! });
      const first = await this.settle(probe, name);
      if (first !== 'needs-auth') {
        this.states.set(name, { status: statusFromSdk(first), note: null });
        return;
      }
      const { authUrl } = await probe.authenticate(name);
      if (authUrl !== null) {
        if (!/^https:\/\//i.test(authUrl)) throw new Error('The sign-in address was not https, so it was not opened.');
        await this.deps.openExternal(authUrl);
      }
      this.states.set(name, { status: 'signing-in', note: 'Finish signing in in your browser.' });
      this.emit();
      const ends = Date.now() + (this.deps.timeoutMs ?? TIMEOUT_MS);
      while (!run.cancelled && Date.now() < ends) {
        await sleep(this.deps.pollMs ?? POLL_MS);
        const now = await probe.status(name);
        if (now === 'connected' || now === 'failed' || now === 'disabled' || now === 'missing') {
          this.states.set(name, { status: statusFromSdk(now), note: null });
          return;
        }
      }
      this.states.set(name, { status: 'needs-auth', note: run.cancelled ? 'Sign-in cancelled.' : 'Sign-in was not finished in time. Press Connect to try again.' });
    } catch (e) {
      this.states.set(name, { status: 'failed', note: errorText(e) });
    } finally {
      probe?.close();
    }
  }

  private async clearAuth(name: string): Promise<void> {
    let probe: ConnectorProbe | null = null;
    try {
      probe = await this.deps.openProbe({ [name]: connectorServers(this.book).servers[name]! });
      await probe.clearAuth(name);
    } catch {
      // 지우지 못해도 목록에서는 뺀다(다시 더하면 Claude Code 에 남은 로그인을 그대로 쓴다)
    } finally {
      probe?.close();
    }
  }

  /** 처음 접속(pending)이 끝날 때까지 잠깐 기다린다 */
  private async settle(probe: ConnectorProbe, name: string): Promise<SdkServerStatus> {
    let status = await probe.status(name);
    for (let i = 0; i < SETTLE_TRIES && !isSettled(status); i += 1) {
      await sleep(Math.min(this.deps.pollMs ?? POLL_MS, 500));
      status = await probe.status(name);
    }
    return status;
  }

  private ready(): Promise<void> {
    this.loaded ??= this.deps.store.load().then(
      (book) => void (this.book = book),
      () => void (this.book = ConnectorBook.empty()),
    );
    return this.loaded;
  }

  private stateOf(name: string): RowState {
    return this.states.get(name) ?? { status: 'unknown', note: null };
  }

  private view(): ConnectorListView {
    const added = new Set(this.book.list().map((c) => c.preset));
    return {
      presets: ConnectorPreset.all().map((p) => ({ id: p.id, label: p.label, covers: p.covers, summary: p.summary, examples: p.examples, added: added.has(p.id), unavailable: p.unavailableReason })),
      connectors: this.book.list().map((c) => ({ id: c.serverName, label: c.label, url: c.url, preset: c.preset, ...this.stateOf(c.serverName) })),
    };
  }

  private emit(): ConnectorListView {
    const view = this.view();
    this.deps.notify(view);
    return view;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
