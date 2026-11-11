import { basename } from 'node:path';
import { DbRequest, NO_ENGINE, engineFailure, failure, inputFailure, type DbConnectionList, type DbCsvSaved, type DbFailure, type DbResult, type DbResultSet, type DbRowsPage, type DbTableDetail, type DbTableInfo } from '../../shared/db-api.js';
import type { DbConnectionView } from '../../shared/db-connections.js';
import { DbFilePath, DbInputError } from '../../shared/db-names.js';
import type { FileCheck } from './db-file.js';
import type { ConnectionsPort } from './db-store.js';
import type { EngineRequest } from './sqlite-engine.js';
import type { EngineRunner, RunOutcome } from './sqlite-runner.js';

export interface DbServiceDeps {
  readonly store: ConnectionsPort;
  readonly runner: EngineRunner;
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

const fail = (f: DbFailure): { readonly ok: false; readonly failure: DbFailure } => ({ ok: false, failure: f });
const ok = <T>(data: T): DbResult<T> => ({ ok: true, data });

/**
 * DB 서비스: 요청 검사(DTO) → 파일 확인 → 자식 프로세스에서 SQLite 실행 → 돌려주기만 한다.
 * 규칙(어떤 SQL 이 읽기인지, 쓰기에 무엇이 필요한지)은 shared/db-*.ts 가 가지고 있고 여기에는 없다. 던지지 않고 DbResult 로 돌려준다.
 */
export class DbService {
  constructor(private readonly deps: DbServiceDeps) {}

  private async guarded<T>(task: () => Promise<DbResult<T>>): Promise<DbResult<T>> {
    try {
      return await task();
    } catch (error) {
      if (error instanceof DbInputError) return fail(inputFailure(error));
      return fail(failure('failed', 'Database action failed', 'Something unexpected went wrong.'));
    }
  }

  async list(): Promise<DbResult<DbConnectionList>> {
    return this.guarded(async () => ok({ connections: (await this.deps.store.load()).list() }));
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

  remove(rawId: unknown): Promise<DbResult<DbConnectionList>> {
    return this.guarded(async () => {
      const id = DbRequest.connection(rawId).value;
      const connections = await this.deps.store.load();
      connections.remove(id);
      await this.deps.store.save(connections);
      return ok({ connections: connections.list() });
    });
  }

  /** 저장된 연결의 파일을 다시 확인해 진짜 경로를 돌려준다(화면이 보낸 경로가 아니라 저장된 경로만 쓴다) */
  private async fileOf(rawId: unknown): Promise<{ readonly real: string } | DbFailure> {
    const id = DbRequest.connection(rawId).value;
    const connections = await this.deps.store.load();
    const found = connections.find(id);
    if (found === undefined) return failure('bad-input', 'Unknown file', 'That file is not in your list. Add it again.');
    const checked = await this.deps.checkFile(DbFilePath.parse(found.path));
    return checked.ok ? { real: checked.real } : checked.failure;
  }

  private async execute<T>(rawId: unknown, build: (file: string) => EngineRequest, o: { readonly timeoutMs: number; readonly key?: string | null; readonly writable?: boolean }): Promise<DbResult<T>> {
    const file = await this.fileOf(rawId);
    if (!('real' in file)) return fail(file);
    const req = build(file.real);
    const outcome = await this.deps.runner.run(req, { timeoutMs: o.timeoutMs, key: o.key ?? null });
    if (o.writable === true && outcome.kind !== 'done') await this.recover(file.real);
    return this.toResult<T>(outcome, o.timeoutMs);
  }

  /** 쓰기 실행이 죽으면 반쯤 쓴 저널이 남는다. 쓸 수 있는 연결로 한 번 열어 SQLite 가 되돌리게 한다(읽기 전용 연결은 못 한다). */
  private async recover(file: string): Promise<void> {
    await this.deps.runner.run({ op: 'query', file, sql: 'SELECT 1', writable: true, kind: 'read', verb: 'SELECT' }, { timeoutMs: 10_000, key: null });
  }

  private toResult<T>(outcome: RunOutcome, timeoutMs: number): DbResult<T> {
    switch (outcome.kind) {
      case 'done': {
        const r = outcome.response;
        if (r.ok) return ok(r.data as T);
        return fail(r.code === 'no-engine' ? NO_ENGINE : engineFailure(r.message));
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
      const result = await this.execute<readonly DbTableInfo[]>(rawId, (file) => ({ op: 'tables', file }), { timeoutMs: BROWSE_TIMEOUT_MS });
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
      return this.execute<DbTableDetail>(req.id.value, (file) => ({ op: 'detail', file, table: req.table.value }), { timeoutMs: BROWSE_TIMEOUT_MS });
    });
  }

  rows(raw: unknown): Promise<DbResult<DbRowsPage>> {
    return this.guarded(() => {
      const req = DbRequest.rows(raw);
      return this.execute<DbRowsPage>(req.id.value, (file) => ({ op: 'rows', file, table: req.table.value, page: req.page.value, sort: req.sort === null ? null : { column: req.sort.column, dir: req.sort.dir } }), { timeoutMs: BROWSE_TIMEOUT_MS });
    });
  }

  query(raw: unknown): Promise<DbResult<DbResultSet>> {
    return this.guarded(() => {
      const req = DbRequest.query(raw);
      // 쓰기 모드가 켜져 있어도 읽기 문장은 읽기 전용으로 연다(쓸 수 있는 연결은 쓰기 문장에만)
      const writable = req.writeMode && req.statement.needsWriteMode();
      return this.execute<DbResultSet>(
        req.id.value,
        (file) => ({ op: 'query', file, sql: req.statement.text, writable, kind: req.statement.kind, verb: req.statement.verb }),
        { timeoutMs: req.timeout.ms(), key: req.key, writable },
      );
    });
  }

  async cancel(rawKey: unknown): Promise<boolean> {
    try {
      return this.deps.runner.cancel(DbRequest.cancel(rawKey));
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

  stopAll(): void {
    this.deps.runner.stopAll();
  }
}
