import { ApiCollections, type ImportedCollection } from '../../shared/api-collections.js';
import { parseCurl, toCurl } from '../../shared/api-curl.js';
import { CollectionOpDto, CollectionsDto, EnvOpDto, EnvironmentsDto, ExportRequestDto, HistoryDto, ImportRequestDto, SendRequestDto, type CollectionsJson, type EnvironmentsView, type HistoryJson } from '../../shared/api-dto.js';
import { ApiEnvironment, type ApiEnvironments } from '../../shared/api-env.js';
import { parseHttpFile, toHttpFile } from '../../shared/api-http-file.js';
import type { CollectionResult, EnvResult, ExportResult, SendResult } from '../../shared/api-ipc.js';
import { parseOpenApi } from '../../shared/api-openapi.js';
import { ApiError, ApiRequest } from '../../shared/api-request.js';
import { ApiHistory, ResponseSummary, type HistoryEntry } from '../../shared/api-response.js';
import { checkTarget } from '../../shared/api-guard.js';
import type { SendOutcome } from './api-sender.js';
import type { ApiStorePort } from './api-store.js';

export interface ApiServiceDeps {
  readonly collections: ApiStorePort<ApiCollections>;
  readonly envs: ApiStorePort<ApiEnvironments>;
  readonly history: ApiStorePort<ApiHistory>;
  readonly send: (prepared: ReturnType<ApiRequest['prepare']>, signal: AbortSignal) => Promise<SendOutcome>;
  readonly newId: () => string;
  readonly now: () => Date;
  /** 저장 위치를 물어 파일로 쓴다. 취소하면 null */
  readonly saveFile: (fileName: string, text: string) => Promise<string | null>;
}

const message = (e: unknown): string => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Something went wrong.');
const SECRET_VAR_RE = /^(token|api_?key|password|passwd|secret|.*_(token|key|secret|password))$/i;

/**
 * API 탭의 일: 불러오기 → 엔티티 메서드 → 저장. 요청 정의가 화면으로 나갈 때는 비밀이 변수 이름이고,
 * 실제 값은 환경 파일에서만 꺼내 보낼 때 채운다. 응답·기록에서는 아는 비밀 값을 가린다.
 */
export class ApiService {
  private readonly inflight = new Map<string, AbortController>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: ApiServiceDeps) {}

  /** 저장 파일을 읽고 쓰는 일은 한 줄로 세운다(동시에 바꿔도 서로 덮지 않게) */
  private serial<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.catch(() => undefined).then(job);
    this.queue = run;
    return run;
  }

  async send(raw: unknown): Promise<SendResult> {
    const bad = (error: string): SendResult => ({ ok: false, kind: 'invalid', error, missing: [], historyId: null });
    let json;
    try {
      json = SendRequestDto.from(raw);
    } catch (e) {
      return bad(message(e));
    }
    if (this.inflight.has(json.key)) return { ok: false, kind: 'busy', error: 'This request is already being sent.', missing: [], historyId: null };
    const controller = new AbortController();
    this.inflight.set(json.key, controller);
    try {
      const request = ApiRequest.create(json.request);
      const envs = await this.deps.envs.load();
      const env = envs.find(envs.selectedId);
      const secretNames = new Set((env?.props.vars ?? []).filter((v) => v.secret).map((v) => v.name));
      let prepared;
      try {
        prepared = request.prepare(env?.variableMap() ?? new Map(), secretNames);
      } catch (e) {
        if (e instanceof ApiError) return { ok: false, kind: e.missing.length > 0 ? 'missing' : 'invalid', error: e.message, missing: e.missing, historyId: null };
        throw e;
      }
      const target = checkTarget(prepared.url);
      if (!target.ok) return { ok: false, kind: 'blocked', error: target.error, missing: [], historyId: null };
      const outcome = await this.deps.send(prepared, controller.signal);
      const safe = request.withSecretsAsVariables().request.props;
      const entryBase = { id: this.deps.newId(), at: this.deps.now().toISOString(), request: safe };
      if (!outcome.ok) {
        if (outcome.kind !== 'cancelled') await this.remember({ ...entryBase, status: null, ms: outcome.ms, size: 0, error: outcome.error, response: null });
        return { ok: false, kind: outcome.kind, error: outcome.error, missing: [], historyId: null };
      }
      const summary = ResponseSummary.create(outcome.response);
      await this.remember({ ...entryBase, status: summary.props.status, ms: summary.props.ms, size: summary.props.size, error: null, response: summary.forHistory(prepared.secrets).props });
      return { ok: true, response: summary.props, masked: summary.props.body.length <= 100_000 ? summary.masked(prepared.secrets).props : null, historyId: entryBase.id };
    } catch (e) {
      return { ok: false, kind: 'network', error: message(e), missing: [], historyId: null };
    } finally {
      this.inflight.delete(json.key);
    }
  }

  cancel(key: string): boolean {
    const c = this.inflight.get(key);
    if (c === undefined) return false;
    c.abort();
    return true;
  }

  private remember(entry: HistoryEntry): Promise<void> {
    return this.serial(async () => this.deps.history.save((await this.deps.history.load()).add(entry)));
  }

  // ── 컬렉션 ──

  async getCollections(): Promise<CollectionsJson> {
    return this.serial(async () => this.safeJson(await this.deps.collections.load()));
  }

  /** 화면에 나가는 컬렉션: 값으로 적힌 비밀은 변수 이름으로 바뀐 모양 */
  private safeJson(c: ApiCollections): CollectionsJson {
    const dto = CollectionsDto.fromEntity(c).toJSON();
    return { version: 1, nodes: dto.nodes.map((n) => (n.kind === 'folder' ? n : { ...n, request: ApiRequest.create(n.request).withSecretsAsVariables().request.props })) };
  }

  /**
   * 요청을 컬렉션에 넣기 전에 비밀을 변수로 옮긴다: 요청은 `{{이름}}`이 되고 값은 고른 환경에 비밀 변수로 들어간다.
   * 옮긴 값이 있으면 true.
   */
  private async extractSecrets(requests: readonly ApiRequest[]): Promise<{ readonly requests: ApiRequest[]; readonly moved: boolean }> {
    const found: { name: string; value: string }[] = [];
    const out = requests.map((r) => {
      const s = r.withSecretsAsVariables();
      found.push(...s.secrets);
      return s.request;
    });
    if (found.length === 0) return { requests: out, moved: false };
    const envs = (await this.deps.envs.load()).withSecrets(found, this.deps.newId);
    await this.deps.envs.save(envs);
    return { requests: out, moved: true };
  }

  async applyCollection(raw: unknown): Promise<CollectionResult> {
    return this.serial(async () => {
      try {
        const op = CollectionOpDto.from(raw);
        let c = await this.deps.collections.load();
        let focusId: string | null = null;
        let moved = false;
        switch (op.kind) {
          case 'add-folder': {
            focusId = this.deps.newId();
            c = c.addFolder(focusId, op.name, op.parentId);
            break;
          }
          case 'add-request': {
            const base = ApiRequest.create(op.request === null ? { id: this.deps.newId(), name: 'New request' } : { ...op.request, id: this.deps.newId() });
            const x = await this.extractSecrets([base]);
            moved = x.moved;
            focusId = base.id;
            c = c.addRequest(x.requests[0] as ApiRequest, op.parentId);
            break;
          }
          case 'update-request': {
            const x = await this.extractSecrets([ApiRequest.create(op.request)]);
            moved = x.moved;
            focusId = op.request.id;
            c = c.updateRequest(x.requests[0] as ApiRequest);
            break;
          }
          case 'rename':
            c = c.rename(op.id, op.name);
            break;
          case 'duplicate': {
            const before = new Set(c.nodes.map((n) => n.id));
            c = c.duplicate(op.id, this.deps.newId);
            focusId = c.nodes.find((n) => !before.has(n.id))?.id ?? null;
            break;
          }
          case 'remove':
            c = c.remove(op.id);
            break;
          case 'move':
            c = c.move(op.id, op.parentId);
            break;
        }
        await this.deps.collections.save(c);
        return { ok: true, collections: this.safeJson(c), focusId, envs: moved ? EnvironmentsDto.view(await this.deps.envs.load()) : null };
      } catch (e) {
        return { ok: false, error: message(e) };
      }
    });
  }

  // ── 환경 ──

  async getEnvs(): Promise<EnvironmentsView> {
    return this.serial(async () => EnvironmentsDto.view(await this.deps.envs.load()));
  }

  async applyEnv(raw: unknown): Promise<EnvResult> {
    return this.serial(async () => {
      try {
        const op = EnvOpDto.from(raw);
        let envs = await this.deps.envs.load();
        switch (op.kind) {
          case 'add':
            envs = envs.add(ApiEnvironment.create({ id: this.deps.newId(), name: op.name }));
            break;
          case 'save': {
            const cur = envs.find(op.id);
            if (cur === null) throw new ApiError('That environment no longer exists.');
            envs = envs.replace(cur.edit(op.name, op.vars));
            break;
          }
          case 'remove':
            envs = envs.remove(op.id);
            break;
          case 'select':
            envs = envs.select(op.id);
            break;
        }
        await this.deps.envs.save(envs);
        return { ok: true, envs: EnvironmentsDto.view(envs) };
      } catch (e) {
        return { ok: false, error: message(e) };
      }
    });
  }

  // ── 기록 ──

  async getHistory(): Promise<HistoryJson> {
    return this.serial(async () => HistoryDto.fromEntity(await this.deps.history.load()).toJSON());
  }
  async removeHistory(id: string): Promise<HistoryJson> {
    return this.serial(async () => {
      let h = await this.deps.history.load();
      if (h.entries.some((e) => e.id === id)) h = h.remove(id);
      await this.deps.history.save(h);
      return HistoryDto.fromEntity(h).toJSON();
    });
  }
  async clearHistory(): Promise<HistoryJson> {
    return this.serial(async () => {
      const h = (await this.deps.history.load()).clear();
      await this.deps.history.save(h);
      return HistoryDto.fromEntity(h).toJSON();
    });
  }

  // ── 가져오기·내보내기 ──

  async importText(raw: unknown): Promise<CollectionResult> {
    return this.serial(async () => {
      try {
        const req = ImportRequestDto.from(raw);
        let c = await this.deps.collections.load();
        const newId = this.deps.newId;
        let envs = await this.deps.envs.load();
        let touchedEnvs = false;
        let focusId: string | null = null;
        if (req.format === 'curl') {
          const s = parseCurl(req.text, newId()).withSecretsAsVariables();
          envs = envs.withSecrets(s.secrets, newId);
          touchedEnvs = s.secrets.length > 0;
          c = c.addRequest(s.request, req.parentId);
          focusId = s.request.id;
        } else if (req.format === 'http') {
          const f = parseHttpFile(req.text, newId);
          const secrets: { name: string; value: string }[] = [];
          const placed = f.requests.map((r) => {
            const s = r.withSecretsAsVariables();
            secrets.push(...s.secrets);
            return s.request;
          });
          const imp: ImportedCollection = { name: 'HTTP file', groups: [{ name: '', requests: placed }], variables: f.variables };
          envs = envs.withSecrets(secrets, newId).withSecrets(imp.variables.filter((v) => !SECRET_VAR_RE.test(v.name)), newId, false).withSecrets(imp.variables.filter((v) => SECRET_VAR_RE.test(v.name)), newId, true);
          touchedEnvs = secrets.length > 0 || imp.variables.length > 0;
          c = c.addImport(imp, newId);
          focusId = c.nodes[c.nodes.length - 1]?.id ?? null;
        } else {
          const imp = parseOpenApi(req.text, newId);
          envs = envs.withSecrets(imp.variables.filter((v) => !SECRET_VAR_RE.test(v.name)), newId, false).withSecrets(imp.variables.filter((v) => SECRET_VAR_RE.test(v.name)), newId, true);
          touchedEnvs = imp.variables.length > 0;
          c = c.addImport(imp, newId);
          focusId = c.nodes.find((n) => n.kind === 'folder' && n.parentId === null && n.name.startsWith(imp.name))?.id ?? null;
        }
        if (touchedEnvs) await this.deps.envs.save(envs);
        await this.deps.collections.save(c);
        return { ok: true, collections: this.safeJson(c), focusId, envs: touchedEnvs ? EnvironmentsDto.view(envs) : null };
      } catch (e) {
        return { ok: false, error: message(e) };
      }
    });
  }

  async exportItem(raw: unknown, save: boolean): Promise<ExportResult> {
    return this.serial(async () => {
      try {
        const req = ExportRequestDto.from(raw);
        const c = await this.deps.collections.load();
        const node = c.node(req.id);
        if (node === undefined) throw new ApiError('That item no longer exists.');
        let text: string;
        let fileName: string;
        if (req.format === 'curl') {
          if (node.kind !== 'request') throw new ApiError('Choose a request to copy as cURL.');
          text = toCurl(node.request);
          fileName = 'request.sh';
        } else {
          const requests = node.kind === 'request' ? [node.request] : ApiCollections.of(this.subtree(c, node.id)).requests();
          if (requests.length === 0) throw new ApiError('There are no requests to export.');
          text = toHttpFile(requests);
          fileName = `${(node.kind === 'request' ? node.request.name : node.name).replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'requests'}.http`;
        }
        const saved = save ? await this.deps.saveFile(fileName, text) : null;
        return { ok: true, text, fileName, saved };
      } catch (e) {
        return { ok: false, error: message(e) };
      }
    });
  }

  /** 폴더 아래 항목들(폴더 자신은 맨 위로 올려서) */
  private subtree(c: ApiCollections, id: string): ApiCollections['nodes'][number][] {
    const keep = new Set<string>();
    const walk = (pid: string): void => {
      for (const n of c.nodes) if (n.parentId === pid) (keep.add(n.id), walk(n.id));
    };
    walk(id);
    return c.nodes.filter((n) => keep.has(n.id)).map((n) => (n.parentId === id ? { ...n, parentId: null } : n));
  }
}
