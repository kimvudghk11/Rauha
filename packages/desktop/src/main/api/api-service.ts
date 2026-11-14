import { ApiCollections, type ImportedCollection } from '../../shared/api-collections.js';
import { parseCurl, toCurl } from '../../shared/api-curl.js';
import { CollectionOpDto, CollectionsDto, EnvOpDto, EnvironmentsDto, ExportRequestDto, HistoryDto, ImportRequestDto, RunFolderDto, SendRequestDto, type CollectionsJson, type RunFolderJson, type EnvironmentsView, type HistoryJson } from '../../shared/api-dto.js';
import { ApiEnvironment, type ApiEnvironments } from '../../shared/api-env.js';
import { parseHttpFile, toHttpFile } from '../../shared/api-http-file.js';
import type { CollectionResult, EnvResult, ExportResult, SendResult } from '../../shared/api-ipc.js';
import { detectImportFormat } from '../../shared/api-import-format.js';
import { parseOpenApi } from '../../shared/api-openapi.js';
import { parsePostman } from '../../shared/api-postman.js';
import { ApiError, ApiRequest } from '../../shared/api-request.js';
import { ApiHistory, ResponseSummary, type HistoryEntry } from '../../shared/api-response.js';
import { checkTarget } from '../../shared/api-guard.js';
import { ApiProjects, ProjectApiSpec, ProjectStack, ProjectSyncRequestDto, StackFactsDto } from '../../shared/api-project.js';
import type { ProjectList, ProjectSyncResult } from '../../shared/api-ipc.js';
import { AfterRules } from '../../shared/api-after.js';
import { CookieJar } from '../../shared/api-cookies.js';
import type { AfterView, CookiesView, RunFolderResult, SaveBodyResult } from '../../shared/api-ipc.js';
import { RunReport, type RunStep } from '../../shared/api-runner.js';
import type { CookieHooks, SendOutcome } from './api-sender.js';
import type { ApiStorePort } from './api-store.js';
import type { ProjectReaderPort } from './project-reader.js';

export interface ApiServiceDeps {
  readonly collections: ApiStorePort<ApiCollections>;
  readonly envs: ApiStorePort<ApiEnvironments>;
  readonly history: ApiStorePort<ApiHistory>;
  readonly send: (prepared: ReturnType<ApiRequest['prepare']>, signal: AbortSignal, cookies: CookieHooks) => Promise<SendOutcome>;
  /** YAML 글을 JSON 글로(OpenAPI·Swagger YAML 가져오기). 없으면 JSON 만 받는다. 읽지 못하면 ApiError */
  readonly yamlToJson?: (text: string) => string;
  /** 응답 본문을 저장 위치를 물어 파일로 쓴다. 취소하면 null(없으면 저장 기능이 꺼진다) */
  readonly saveBytes?: (fileName: string, bytes: Uint8Array) => Promise<string | null>;
  readonly newId: () => string;
  readonly now: () => Date;
  /** 저장 위치를 물어 파일로 쓴다. 취소하면 null */
  readonly saveFile: (fileName: string, text: string) => Promise<string | null>;
  /** 프로젝트에서 컬렉션 만들기(없으면 그 기능만 꺼진다) */
  readonly projects?: ApiStorePort<ApiProjects>;
  readonly reader?: ProjectReaderPort;
  /** 작업 폴더에서 찾은 프로젝트들. 이 목록에 있는 경로만 읽는다 */
  readonly listProjects?: () => Promise<readonly { readonly root: string; readonly name: string; readonly relative: string }[]>;
}

const message = (e: unknown): string => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Something went wrong.');
const SECRET_VAR_RE = /^(token|api_?key|password|passwd|secret|.*_(token|key|secret|password))$/i;
/** accessToken · apiKey · clientSecret 같은 낙타 표기 비밀 이름 */
const CAMEL_SECRET_RE = /[a-z0-9](Token|Key|Secret|Password|Pwd)$/;

/**
 * API 탭의 일: 불러오기 → 엔티티 메서드 → 저장. 요청 정의가 화면으로 나갈 때는 비밀이 변수 이름이고,
 * 실제 값은 환경 파일에서만 꺼내 보낼 때 채운다. 응답·기록에서는 아는 비밀 값을 가린다.
 */
export class ApiService {
  private readonly inflight = new Map<string, AbortController>();
  /** 지금 읽는 중인 프로젝트 루트 */
  private readonly syncing = new Set<string>();
  private queue: Promise<unknown> = Promise.resolve();
  /** 폴더 실행 중(한 번에 하나) */
  private running = false;
  private runCancelled = false;
  /** 쿠키 저장소(메모리에만: 앱을 끄면 사라진다) */
  private jar = CookieJar.empty();
  /** 마지막 응답의 바이트(파일로 저장용, 하나만 들고 있는다) */
  private lastBody: { readonly id: string; readonly bytes: Uint8Array; readonly fileName: string } | null = null;
  private readonly cookieHooks: CookieHooks = {
    header: (url) => this.jar.header(url, this.deps.now().getTime()),
    store: (url, setCookies) => void (this.jar = this.jar.store(url, setCookies, this.deps.now().getTime())),
  };

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
      let rules: AfterRules;
      try {
        rules = AfterRules.of(request.props.after);
      } catch (e) {
        return { ok: false, kind: 'invalid', error: message(e), missing: [], historyId: null };
      }
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
      const outcome = await this.deps.send(prepared, controller.signal, this.cookieHooks);
      const safe = request.withSecretsAsVariables().request.props;
      const entryBase = { id: this.deps.newId(), at: this.deps.now().toISOString(), request: safe };
      if (!outcome.ok) {
        if (outcome.kind !== 'cancelled') await this.remember({ ...entryBase, status: null, ms: outcome.ms, size: 0, error: outcome.error, response: null });
        return { ok: false, kind: outcome.kind, error: outcome.error, missing: [], historyId: null };
      }
      const summary = ResponseSummary.create(outcome.response);
      this.lastBody = { id: entryBase.id, bytes: outcome.bytes ?? new TextEncoder().encode(outcome.response.body), fileName: ResponseSummary.fileName(prepared.url, summary.props.contentType) };
      const applied = rules.isEmpty() ? null : await this.applyAfter(rules, summary);
      const hide = [...prepared.secrets, ...(applied?.hidden ?? [])];
      await this.remember({ ...entryBase, status: summary.props.status, ms: summary.props.ms, size: summary.props.size, error: null, response: summary.forHistory(hide).props });
      return {
        ok: true,
        response: summary.props,
        masked: summary.props.body.length <= 100_000 ? summary.masked(hide).props : null,
        historyId: entryBase.id,
        after: applied?.view ?? null,
        envs: applied?.envs ?? null,
        cookies: this.jar.size(this.deps.now().getTime()),
      };
    } catch (e) {
      return { ok: false, kind: 'network', error: message(e), missing: [], historyId: null };
    } finally {
      this.inflight.delete(json.key);
    }
  }

  /** 응답 뒤 규칙을 돌리고, 꺼낸 값을 고른 환경에 저장한다. 비밀 변수 값은 화면용 결과에서 가린다 */
  private async applyAfter(rules: AfterRules, summary: ResponseSummary): Promise<{ readonly view: AfterView; readonly envs: EnvironmentsView | null; readonly hidden: readonly string[] }> {
    const result = rules.run(summary.props);
    const found = result.captured.filter((c) => c.found);
    const cap = await this.serial(async () => {
      const before = await this.deps.envs.load();
      const r = before.capture(found, (name) => SECRET_VAR_RE.test(name) || CAMEL_SECRET_RE.test(name));
      if (r.envs !== before) await this.deps.envs.save(r.envs);
      return { ...r, changed: r.envs !== before };
    });
    const hidden = found.filter((c) => cap.secret.has(c.name) && c.value.length >= 4).map((c) => c.value);
    return {
      view: { captured: result.captured.map((c) => (c.found && cap.secret.has(c.name) ? { ...c, value: '••••' } : c)), checks: result.checks, note: cap.note },
      envs: cap.changed ? EnvironmentsDto.view(cap.envs) : null,
      hidden,
    };
  }

  // ── 폴더 일괄 실행 ──

  /**
   * 폴더의 요청을 화면 순서(위에서 아래, 안쪽 폴더 포함)대로 보낸다. 보내기는 Send 와 같은 길(send)이라
   * 쿠키·응답 뒤 규칙이 그대로 돌고, 앞 요청에서 저장한 변수를 다음 요청이 쓴다.
   */
  async runFolder(raw: unknown): Promise<RunFolderResult> {
    let req: RunFolderJson;
    try {
      req = RunFolderDto.from(raw);
    } catch (e) {
      return { ok: false, error: message(e) };
    }
    if (this.running) return { ok: false, error: 'A run is already going. Stop it first.' };
    const c = await this.serial(async () => this.deps.collections.load());
    const folder = c.node(req.folderId);
    if (folder === undefined || folder.kind !== 'folder') return { ok: false, error: 'That folder no longer exists.' };
    const requests = c.tree(folder.id).flatMap(function flat(t): string[] {
      return t.kind === 'request' ? [t.id] : t.children.flatMap(flat);
    });
    if (requests.length === 0) return { ok: false, error: 'That folder has no requests to run.' };
    this.running = true;
    this.runCancelled = false;
    const steps: RunStep[] = [];
    let stop = false;
    try {
      for (const id of requests) {
        const r = c.request(id) as ApiRequest;
        const base = { id, name: r.name, method: r.props.method, url: r.withSecretsAsVariables().request.props.url };
        if (stop || this.runCancelled) {
          steps.push({ ...base, status: null, ms: 0, error: null, checks: [], saved: [], skipped: true });
          continue;
        }
        const res = await this.send({ key: `run-${id}`, request: r.props });
        const step: RunStep = res.ok
          ? { ...base, status: res.response.status, ms: res.response.ms, error: null, checks: res.after?.checks ?? [], saved: (res.after?.captured ?? []).filter((x) => x.found).map((x) => x.name), skipped: false }
          : { ...base, status: null, ms: 0, error: res.error, checks: [], saved: [], skipped: false };
        steps.push(step);
        if (req.stopOnFail && !RunReport.passed(step)) stop = true;
      }
    } finally {
      this.running = false;
    }
    const report = RunReport.of(folder.name, steps, this.deps.now().toISOString());
    return { ok: true, report: { folder: report.folder, steps: report.steps, at: report.at }, summary: report.summary(), markdown: report.toMarkdown(), envs: EnvironmentsDto.view(await this.deps.envs.load()) };
  }

  /** 폴더 실행을 멈춘다: 지금 가는 요청도 끊는다 */
  cancelRun(): boolean {
    if (!this.running) return false;
    this.runCancelled = true;
    for (const [key, ctrl] of this.inflight) if (key.startsWith('run-')) ctrl.abort();
    return true;
  }

  cookies(): CookiesView {
    const now = this.deps.now().getTime();
    return { count: this.jar.size(now), items: this.jar.list(now) };
  }

  clearCookies(domain?: unknown): CookiesView {
    this.jar = typeof domain === 'string' && domain !== '' ? this.jar.removeDomain(domain) : this.jar.clear();
    return this.cookies();
  }

  /** 마지막 응답 본문 전체를 파일로(기록 id 가 마지막 응답이어야 한다) */
  async saveBody(historyId: unknown): Promise<SaveBodyResult> {
    const last = this.lastBody;
    if (last === null || typeof historyId !== 'string' || historyId !== last.id) return { ok: false, error: 'Only the latest response can be saved. Send the request again.' };
    if (this.deps.saveBytes === undefined) return { ok: false, error: 'Saving files is not available.' };
    try {
      return { ok: true, saved: await this.deps.saveBytes(last.fileName, last.bytes) };
    } catch (e) {
      return { ok: false, error: message(e) };
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
        const dto = ImportRequestDto.from(raw);
        const format = dto.format === 'auto' ? detectImportFormat(dto.text) : dto.format;
        // YAML OpenAPI·Swagger 는 바깥(main)에서 JSON 으로 바꿔 같은 읽기로 넘긴다
        const textIn = format === 'openapi' && !dto.text.trimStart().startsWith('{') && this.deps.yamlToJson !== undefined ? this.deps.yamlToJson(dto.text) : dto.text;
        const req = { ...dto, format, text: textIn };
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
          const imp = req.format === 'postman' ? parsePostman(req.text, newId) : parseOpenApi(req.text, newId);
          const secretName = (n: string): boolean => SECRET_VAR_RE.test(n) || CAMEL_SECRET_RE.test(n);
          envs = envs.withSecrets(imp.variables.filter((v) => !secretName(v.name)), newId, false).withSecrets(imp.variables.filter((v) => secretName(v.name)), newId, true);
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

  // ── 프로젝트에서 컬렉션 만들기 ──

  private projectDeps() {
    const { projects, reader, listProjects } = this.deps;
    if (projects === undefined || reader === undefined || listProjects === undefined) throw new ApiError('Project collections are not available.');
    return { projects, reader, listProjects };
  }

  async listProjects(): Promise<ProjectList> {
    try {
      const { projects, listProjects } = this.projectDeps();
      const [rows, p] = await Promise.all([listProjects(), projects.load()]);
      const items = rows.map((r) => {
        const rec = p.record(r.root);
        return { root: r.root, name: r.name, relative: r.relative, source: rec?.source ?? null, endpoints: rec?.endpoints ?? 0 };
      });
      return { selected: items.some((i) => i.root === p.selected) ? p.selected : null, items };
    } catch {
      return { selected: null, items: [] };
    }
  }

  /**
   * 고른 프로젝트 하나를 읽어 컬렉션에 합친다: 훑기(지문) → 그대로면 끝 → 프론트엔드면 끝 →
   * OpenAPI 파일 먼저, 없으면 코드에서 추출 → 합치기 → 저장. 파일 읽기는 저장 줄 밖에서 한다.
   */
  async syncProject(raw: unknown): Promise<ProjectSyncResult> {
    let root: string | null = null;
    try {
      const { projects, reader, listProjects } = this.projectDeps();
      const req = ProjectSyncRequestDto.from(raw);
      const row = (await listProjects()).find((r) => r.root === req.root);
      if (row === undefined) throw new ApiError('That folder is not in the work folder.');
      if (this.syncing.has(row.root)) return { ok: true, status: 'busy', source: null, report: null, collections: await this.getCollections(), focusId: null, truncated: false, envs: null };
      root = row.root;
      this.syncing.add(root);
      const survey = await reader.survey(root);
      const stack = ProjectStack.judge(StackFactsDto.from(survey));
      const fingerprint = survey.fingerprint;
      const unchanged = await this.serial(async () => {
        const p = await projects.load();
        const c = await this.deps.collections.load();
        await projects.save(p.select(row.root));
        return req.force || p.needsSync(row.root, fingerprint, c.hasProject(row.root)) ? null : { c, rec: p.record(row.root) };
      });
      const done = (status: 'unchanged' | 'frontend' | 'empty', c: ApiCollections, source: ApiProjects['records'][number]['source'] | null): ProjectSyncResult => ({
        ok: true,
        status,
        source: source === 'frontend' || source === 'none' ? null : source,
        report: null,
        collections: this.safeJson(c),
        focusId: c.nodes.find((n) => n.kind === 'folder' && n.origin?.project === row.root && n.origin.key === 'root')?.id ?? null,
        truncated: survey.truncated,
        envs: null,
      });
      if (unchanged !== null) return done(ApiProjects.outcomeOf(unchanged.rec), unchanged.c, unchanged.rec?.source ?? null);
      const record = (source: 'frontend' | 'none', status: 'frontend' | 'empty') =>
        this.serial(async () => {
          const p = await projects.load();
          await projects.save(p.recordSync(row.root, fingerprint, this.deps.now(), source, 0, [...p.knownKeys(row.root)]));
          return done(status, await this.deps.collections.load(), source);
        });
      if (!stack.makesApi()) return await record('frontend', 'frontend');

      let spec: ProjectApiSpec | null = null;
      for (const path of stack.openApiPaths(survey.paths).slice(0, 3)) {
        const [file] = await reader.read(root, [path]);
        if (file === undefined) continue;
        try {
          const docText = /\.ya?ml$/i.test(path) && this.deps.yamlToJson !== undefined ? this.deps.yamlToJson(file.text) : file.text;
          spec = ProjectApiSpec.fromOpenApi(root, row.name, docText);
          if (!spec.isEmpty()) break;
        } catch {
          /* 읽지 못하는 문서(YAML·Swagger 2 등)는 건너뛰고 코드에서 읽는다 */
        }
        spec = null;
      }
      const sources = stack.sourcePaths(survey.paths);
      if (spec === null && sources.length > 0) {
        const api = stack.extract(await reader.read(root, sources));
        if (api !== null) spec = ProjectApiSpec.fromExtracted(root, row.name, api);
      }
      if (spec === null || spec.isEmpty()) return await record('none', 'empty');
      const found = spec;

      return await this.serial(async () => {
        const p = await projects.load();
        const merged = (await this.deps.collections.load()).syncProject(found, p.knownKeys(row.root), this.deps.newId);
        const before = await this.deps.envs.load();
        const envs = before.withSecrets(found.variables.filter((v) => !v.secret), this.deps.newId, false).withSecrets(found.variables.filter((v) => v.secret), this.deps.newId, true);
        if (envs !== before) await this.deps.envs.save(envs);
        await this.deps.collections.save(merged.collections);
        await projects.save(p.recordSync(row.root, fingerprint, this.deps.now(), found.source, found.requestCount(), merged.known));
        return { ok: true, status: 'synced', source: found.source, report: merged.report, collections: this.safeJson(merged.collections), focusId: merged.rootId, truncated: survey.truncated, envs: envs !== before ? EnvironmentsDto.view(envs) : null };
      });
    } catch (e) {
      return { ok: false, error: message(e) };
    } finally {
      if (root !== null) this.syncing.delete(root);
    }
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
