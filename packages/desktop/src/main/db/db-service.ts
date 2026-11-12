import { basename } from 'node:path';
import { DbRequest, NO_ENGINE, engineFailure, failure, inputFailure, serverFailure, type DbConnectionList, type DbCsvSaved, type DbFailure, type DbResult, type DbResultSet, type DbRowsPage, type DbServerTest, type DbTableDetail, type DbTableInfo } from '../../shared/db-api.js';
import type { DbConnectionView, DbConnections } from '../../shared/db-connections.js';
import type { DbPassword } from '../../shared/db-server.js';
import { DbFilePath, DbInputError } from '../../shared/db-names.js';
import type { FileCheck } from './db-file.js';
import type { ConnectionsPort } from './db-store.js';
import type { ServerConnection, ServerRequest, ServerRunner } from './server-engine.js';
import { ServerPasswords, type SecretBox } from './server-passwords.js';
import type { EngineRequest } from './sqlite-engine.js';
import type { EngineRunner, RunOutcome } from './sqlite-runner.js';

export interface DbServiceDeps {
  readonly store: ConnectionsPort;
  readonly runner: EngineRunner;
  /** MySQL·PostgreSQL 엔진 */
  readonly servers: ServerRunner;
  /** 서버 비밀번호 암호화(safeStorage) */
  readonly secrets: SecretBox;
  /** 파일이 진짜 SQLite 파일인지 직접 확인한다 */
  readonly checkFile: (path: DbFilePath) => Promise<FileCheck>;
  /** 파일 고르기 창. 취소하면 null */
  readonly pickFile: () => Promise<string | null>;
  /** 저장 창을 열어 쓴다. 취소하면 null */
  readonly saveCsv: (fileName: string, text: string) => Promise<string | null>;
  readonly newId: () => string;
  readonly now: () => number;
}

/** 목록·스키마·행 보기 같은 안쪽 질의의 시간 제한 */
const BROWSE_TIMEOUT_MS = 15_000;
/** 서버 연결을 더하거나 비밀번호를 받을 때 한 번 접속해 보는 시간 제한(접속 자체는 엔진이 10초로 끊는다) */
const PING_TIMEOUT_MS = 10_000;

const fail = (f: DbFailure): { readonly ok: false; readonly failure: DbFailure } => ({ ok: false, failure: f });
const ok = <T>(data: T): DbResult<T> => ({ ok: true, data });

/** 연결 id 로 찾은 실행 대상 */
type Target = { readonly kind: 'file'; readonly real: string } | { readonly kind: 'server'; readonly conn: ServerConnection };

/**
 * DB 서비스: 요청 검사(DTO) → 대상 찾기(파일 확인 · 서버 비밀번호) → 엔진 실행 → 돌려주기만 한다.
 * SQLite 는 자식 프로세스(runner), MySQL·PostgreSQL 은 서버 엔진(servers)이 돌린다.
 * 규칙(어떤 SQL 이 읽기인지, 쓰기에 무엇이 필요한지, 무엇을 저장하는지)은 shared/db-*.ts 가 가지고 있고 여기에는 없다. 던지지 않고 DbResult 로 돌려준다.
 */
export class DbService {
  private readonly passwords: ServerPasswords;

  constructor(private readonly deps: DbServiceDeps) {
    this.passwords = new ServerPasswords(deps.secrets);
  }

  private async guarded<T>(task: () => Promise<DbResult<T>>): Promise<DbResult<T>> {
    try {
      return await task();
    } catch (error) {
      if (error instanceof DbInputError) return fail(inputFailure(error));
      return fail(failure('failed', 'Database action failed', 'Something unexpected went wrong.'));
    }
  }

  async list(): Promise<DbResult<DbConnectionList>> {
    return this.guarded(async () => ok({ connections: (await this.deps.store.load()).list(), canSavePasswords: this.passwords.canSave() }));
  }

  private async register(rawPath: unknown): Promise<DbResult<DbConnectionView>> {
    const path = DbFilePath.parse(rawPath);
    const checked = await this.deps.checkFile(path);
    if (!checked.ok) return fail(checked.failure);
    const connections = await this.deps.store.load();
    const view = connections.add(path, this.deps.newId(), this.deps.now());
    await this.deps.store.save(connections);
    return ok(view);
  }

  addPath(raw: unknown): Promise<DbResult<DbConnectionView>> {
    return this.guarded(() => this.register(DbRequest.addPath(raw).value));
  }

  pick(): Promise<DbResult<DbConnectionView | null>> {
    return this.guarded(async () => {
      const chosen = await this.deps.pickFile();
      if (chosen === null) return ok(null);
      return this.register(chosen);
    });
  }

  /** 서버에 한 번 접속해 본다(되면 data 가 true) */
  private async ping(conn: ServerConnection): Promise<DbResult<true>> {
    return this.toResult<true>(await this.deps.servers.run(conn, { op: 'ping' }, { timeoutMs: PING_TIMEOUT_MS }), PING_TIMEOUT_MS, serverFailure);
  }

  /** 서버 연결 추가: 먼저 접속해 보고, 되면 저장한다. 비밀번호는 암호문으로만 저장하고(못 하면 저장하지 않는다) 이번 실행 동안 메모리에 둔다. */
  addServer(raw: unknown): Promise<DbResult<DbConnectionView>> {
    return this.guarded(async () => {
      const req = DbRequest.addServer(raw);
      const reached = await this.ping({ target: req.target, password: req.password });
      if (!reached.ok) return reached;
      const connections = await this.deps.store.load();
      const view = connections.addServer(req.target, req.label, this.passwords.toSaved(req.password, req.savePassword), this.deps.newId(), this.deps.now());
      this.passwords.remember(view.id, req.password);
      await this.deps.store.save(connections);
      return ok(view);
    });
  }

  /** 저장하지 않고 접속만 해 본다. 고치는 중인 연결이면(keepPassword) 저장한·기억한 비밀번호를 쓴다. */
  testServer(raw: unknown): Promise<DbResult<DbServerTest>> {
    return this.guarded(async () => {
      const req = DbRequest.testServer(raw);
      const password = req.password ?? (await this.knownPassword(req.id?.value ?? ''));
      if (password === null) return fail(failure('need-password', 'Password needed', 'Type the password to test this connection.'));
      const started = this.deps.now();
      const reached = await this.ping({ target: req.target, password });
      return reached.ok ? ok({ elapsedMs: Math.max(0, this.deps.now() - started) }) : reached;
    });
  }

  /**
   * 저장한 서버 연결 고치기: 고친 값으로 먼저 접속해 보고, 되면 같은 id 로 바꾼다(안 되면 그대로 둔다).
   * 비밀번호 칸을 비우면(keepPassword) 저장한·기억한 비밀번호를 쓰고, 저장 여부는 폼의 선택대로 다시 정한다.
   */
  editServer(raw: unknown): Promise<DbResult<DbConnectionView>> {
    return this.guarded(async () => {
      const req = DbRequest.editServer(raw);
      const id = req.id.value;
      const password = req.password ?? (await this.knownPassword(id));
      if (password === null) return fail(failure('need-password', 'Password needed', 'Type the password for this connection.'));
      const reached = await this.ping({ target: req.target, password });
      if (!reached.ok) return reached;
      const connections = await this.deps.store.load();
      const view = connections.editServer(id, req.target, req.label, this.passwords.toSaved(password, req.savePassword), this.deps.now());
      this.passwords.remember(id, password);
      await this.deps.store.save(connections);
      return ok(view);
    });
  }

  /** 저장한 서버 연결의 비밀번호(이번 실행에 기억한 것 → 저장한 암호문). 없거나 서버 연결이 아니면 null */
  private async knownPassword(id: string): Promise<DbPassword | null> {
    if (id === '') return null;
    const found = (await this.deps.store.load()).locate(id);
    return found?.kind === 'server' ? this.passwords.resolve(id, found.password) : null;
  }

  /** 저장한 비밀번호가 없는(또는 못 푸는) 서버 연결에 비밀번호를 준다. 접속이 되어야 받아들인다. */
  unlock(raw: unknown): Promise<DbResult<DbConnectionView>> {
    return this.guarded(async () => {
      const req = DbRequest.unlock(raw);
      const connections = await this.deps.store.load();
      const found = connections.locate(req.id.value);
      if (found?.kind !== 'server') return fail(failure('bad-input', 'Unknown connection', 'That connection is not in your list. Add it again.'));
      const reached = await this.ping({ target: found.target, password: req.password });
      if (!reached.ok) return reached;
      this.passwords.remember(req.id.value, req.password);
      connections.rememberPassword(req.id.value, this.passwords.toSaved(req.password, req.savePassword));
      await this.deps.store.save(connections);
      return ok(connections.find(req.id.value)!);
    });
  }

  remove(rawId: unknown): Promise<DbResult<DbConnectionList>> {
    return this.guarded(async () => {
      const id = DbRequest.connection(rawId).value;
      const connections = await this.deps.store.load();
      connections.remove(id);
      this.passwords.forget(id);
      await this.deps.store.save(connections);
      return ok({ connections: connections.list(), canSavePasswords: this.passwords.canSave() });
    });
  }

  /** 저장된 연결로 실행 대상을 찾는다: 파일은 다시 확인한 진짜 경로(화면이 보낸 경로가 아니다), 서버는 대상 + 비밀번호 */
  private async targetOf(rawId: unknown): Promise<DbResult<Target>> {
    const id = DbRequest.connection(rawId).value;
    const found = (await this.deps.store.load()).locate(id);
    if (found === undefined) return fail(failure('bad-input', 'Unknown database', 'That database is not in your list. Add it again.'));
    switch (found.kind) {
      case 'file': {
        const checked = await this.deps.checkFile(found.path);
        return checked.ok ? ok({ kind: 'file', real: checked.real }) : fail(checked.failure);
      }
      case 'server': {
        const password = this.passwords.resolve(id, found.password);
        if (password === null) return fail(failure('need-password', 'Password needed', `Type the password for ${found.target.address()}.`));
        return ok({ kind: 'server', conn: { target: found.target, password } });
      }
    }
  }

  private async execute<T>(rawId: unknown, build: { readonly sqlite: (file: string) => EngineRequest; readonly server: ServerRequest }, o: { readonly timeoutMs: number; readonly key?: string | null; readonly writable?: boolean }): Promise<DbResult<T>> {
    const found = await this.targetOf(rawId);
    if (!found.ok) return found;
    const target = found.data;
    if (target.kind === 'server') return this.toResult<T>(await this.deps.servers.run(target.conn, build.server, { timeoutMs: o.timeoutMs, key: o.key ?? null }), o.timeoutMs, serverFailure);
    const outcome = await this.deps.runner.run(build.sqlite(target.real), { timeoutMs: o.timeoutMs, key: o.key ?? null });
    if (o.writable === true && outcome.kind !== 'done') await this.recover(target.real);
    return this.toResult<T>(outcome, o.timeoutMs, engineFailure);
  }

  /** 쓰기 실행이 죽으면 반쯤 쓴 저널이 남는다. 쓸 수 있는 연결로 한 번 열어 SQLite 가 되돌리게 한다(읽기 전용 연결은 못 한다). */
  private async recover(file: string): Promise<void> {
    await this.deps.runner.run({ op: 'query', file, sql: 'SELECT 1', writable: true, kind: 'read', verb: 'SELECT' }, { timeoutMs: 10_000, key: null });
  }

  private toResult<T>(outcome: RunOutcome, timeoutMs: number, classify: (message: string) => DbFailure): DbResult<T> {
    switch (outcome.kind) {
      case 'done': {
        const r = outcome.response;
        if (r.ok) return ok(r.data as T);
        return fail(r.code === 'no-engine' ? NO_ENGINE : classify(r.message));
      }
      case 'timeout':
        return fail(failure('timeout', 'The query was stopped', `It ran longer than ${Math.round(timeoutMs / 1000)} seconds, so Rauha stopped it. Nothing was kept from a half-finished change.`, 'Add a WHERE or LIMIT, or raise the time limit.'));
      case 'cancelled':
        return fail(failure('cancelled', 'Cancelled', 'The query was cancelled.'));
      case 'too-large':
        return fail(failure('too-large', 'The result was too large', 'The query produced far more data than the limit, so it was stopped. Add a LIMIT or select fewer columns.'));
      case 'crashed':
        return fail(failure('failed', 'The SQLite helper stopped', outcome.detail));
    }
  }

  tables(rawId: unknown): Promise<DbResult<readonly DbTableInfo[]>> {
    return this.guarded(async () => {
      const result = await this.execute<readonly DbTableInfo[]>(rawId, { sqlite: (file) => ({ op: 'tables', file }), server: { op: 'tables' } }, { timeoutMs: BROWSE_TIMEOUT_MS });
      if (result.ok) {
        const connections = await this.deps.store.load();
        connections.touch(DbRequest.connection(rawId).value, this.deps.now());
        await this.deps.store.save(connections);
      }
      return result;
    });
  }

  detail(raw: unknown): Promise<DbResult<DbTableDetail>> {
    return this.guarded(() => {
      const req = DbRequest.detail(raw);
      return this.execute<DbTableDetail>(req.id.value, { sqlite: (file) => ({ op: 'detail', file, table: req.table.value }), server: { op: 'detail', table: req.table.value } }, { timeoutMs: BROWSE_TIMEOUT_MS });
    });
  }

  rows(raw: unknown): Promise<DbResult<DbRowsPage>> {
    return this.guarded(() => {
      const req = DbRequest.rows(raw);
      const sort = req.sort === null ? null : { column: req.sort.column, dir: req.sort.dir };
      return this.execute<DbRowsPage>(req.id.value, { sqlite: (file) => ({ op: 'rows', file, table: req.table.value, page: req.page.value, sort }), server: { op: 'rows', table: req.table.value, page: req.page.value, sort } }, { timeoutMs: BROWSE_TIMEOUT_MS });
    });
  }

  query(raw: unknown): Promise<DbResult<DbResultSet>> {
    return this.guarded(async () => {
      // 연결 종류를 알아야 그 DB 의 문법으로 문장을 검사할 수 있다
      const dialect = (await this.deps.store.load()).dialectOf(DbRequest.queryTarget(raw).value);
      const req = DbRequest.query(raw, dialect);
      // 쓰기 모드가 켜져 있어도 읽기 문장은 읽기 전용으로 연다(쓸 수 있는 연결은 쓰기 문장에만)
      const writable = req.writeMode && req.statement.needsWriteMode();
      const statement = { sql: req.statement.text, writable, kind: req.statement.kind, verb: req.statement.verb };
      return this.execute<DbResultSet>(req.id.value, { sqlite: (file) => ({ op: 'query', file, ...statement }), server: { op: 'query', ...statement } }, { timeoutMs: req.timeout.ms(), key: req.key, writable });
    });
  }

  async cancel(rawKey: unknown): Promise<boolean> {
    try {
      const key = DbRequest.cancel(rawKey);
      return this.deps.runner.cancel(key) || this.deps.servers.cancel(key);
    } catch {
      return false;
    }
  }

  exportCsv(raw: unknown): Promise<DbResult<DbCsvSaved>> {
    return this.guarded(async () => {
      const req = DbRequest.exportCsv(raw);
      // 엑셀이 한글 UTF-8 을 바로 읽도록 BOM 을 붙인다
      const saved = await this.deps.saveCsv(req.fileName, `﻿${req.csv}`);
      return ok({ saved: saved !== null, fileName: saved === null ? null : basename(saved) });
    });
  }

  /** 팀원 DB 도구용: 저장한 연결 목록(엔티티). 화면에는 쓰지 않는다. */
  connections(): Promise<DbConnections> {
    return this.deps.store.load();
  }

  /** 팀원 DB 도구용: 비밀번호를 묻지 않고 바로 열 수 있는지(파일이거나, 이번 실행에 받았거나, 저장한 암호문을 풀 수 있다) */
  async canOpen(id: string): Promise<boolean> {
    const found = (await this.deps.store.load()).locate(id);
    if (found === undefined) return false;
    return found.kind === 'file' || this.passwords.resolve(id, found.password) !== null;
  }

  stopAll(): void {
    this.deps.runner.stopAll();
    this.deps.servers.stopAll();
  }
}
