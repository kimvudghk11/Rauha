import { ApiCollections } from '../shared/api-collections.js';
import { CollectionsDto, type CollectionsJson, type EnvironmentsView, type HistoryJson } from '../shared/api-dto.js';
import { EnvBar } from '../shared/api-env.js';
import type { ApiSource } from '../shared/api-extract.js';
import type { ApiApi, CollectionResult, ProjectList, ProjectRow, SendResult } from '../shared/api-ipc.js';
import { API_METHODS, ApiRequest, variablesIn, type ApiMethod, type ApiRequestProps } from '../shared/api-request.js';
import type { HistoryEntry } from '../shared/api-response.js';
import { el, isEnterKey } from './dom.js';
import { buildRequestEditor } from './api-editor.js';
import { openEnvDialog } from './api-env-dialog.js';
import { askText, METHOD_CLASS } from './api-parts.js';
import { buildResponseView } from './api-response-view.js';
import { buildTestPanel } from './api-test-view.js';
import { paintCollections, paintHistory, type TreeActions } from './api-tree.js';
import { button, confirmDialog, select } from './todo-parts.js';

export interface ApiViewDeps {
  readonly api: ApiApi;
  readonly copy: (text: string) => Promise<boolean>;
  readonly now?: () => number;
  /** 채팅 입력칸에 글을 넣고 채팅 탭으로 간다(AI 시험의 "고쳐 달라고 맡기기") */
  readonly toChat?: (text: string) => void;
}

type Side = 'collections' | 'history';
const OPEN_KEY = 'rauha.api.open';

const readOpen = (): Set<string> => {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]');
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 500) : []);
  } catch {
    return new Set();
  }
};

/**
 * API 탭: Apidog·Postman 같은 API 클라이언트. 왼쪽에 컬렉션·기록, 가운데 요청 편집, 아래 응답.
 * 요청은 main이 보낸다(CORS 없음). 화면은 요청 정의(토큰은 {{변수}} 이름)만 다루고 비밀 값은 모른다.
 */
export function buildApi(deps: ApiViewDeps) {
  const now = deps.now ?? Date.now;
  const root = el('section', 'api');
  let collections = ApiCollections.empty();
  let envs: EnvironmentsView = { selectedId: null, items: [] };
  let history: HistoryJson = { version: 1, entries: [] };
  let side: Side = 'collections';
  const open = readOpen();
  let draft: ApiRequestProps = ApiRequest.create({ id: 'draft-0' }).props;
  /** 컬렉션에 들어 있는 요청을 편집 중인가(아니면 저장 전 임시 요청) */
  let saved = false;
  let dirty = false;
  let sending = false;
  let counter = 0;
  const lastResult = new Map<string, SendResult>();

  // ── 머리줄 ──
  const notice = el('div', 'notice');
  notice.hidden = true;
  const say = (t: string): void => {
    notice.textContent = t;
    notice.hidden = t === '';
  };
  const envHost = el('div', 'api-env-bar');
  const toggleList = button('Requests', 'btn api-toggle', () => root.classList.toggle('list-open'));
  const importBtn = button('Import', 'btn', () => void importDialog());
  const head = el('div', 'rhead api-head');
  head.append(toggleList, el('b', undefined, 'API'), el('span', 'hint grow', 'Send requests from here. Tokens stay in environments.'), importBtn);
  envHost.setAttribute('role', 'region');
  envHost.setAttribute('aria-label', 'Environment and base URL');

  // ── 왼쪽: 컬렉션 · 기록 ──
  const sideTabs = el('div', 'tabs');
  const listHost = el('div', 'api-list');
  const sideTools = el('div', 'bar api-side-tools');
  const sidePane = el('aside', 'pane api-side');
  for (const [id, label] of [['collections', 'Collections'], ['history', 'History']] as const) {
    const b = el('button', 'tab sm', label);
    b.type = 'button';
    b.addEventListener('click', () => {
      side = id;
      paintSide();
    });
    sideTabs.append(b);
  }
  // 프로젝트 고르기: 작업 폴더의 레포 하나를 골라 그 프로젝트의 API로 컬렉션을 만든다(전부 미리 읽지 않는다)
  let projectList: ProjectList = { selected: null, items: [] };
  let syncingProject = false;
  const projectHost = el('div', 'bar api-project-bar');
  const refreshBtn = button('↻', 'btn sm icon api-project-refresh', () => {
    if (projectList.selected !== null) void syncProject(projectList.selected, true);
  });
  refreshBtn.title = 'Read the project again';
  refreshBtn.setAttribute('aria-label', 'Read the project again');
  sidePane.append(projectHost, sideTabs, sideTools, listHost);

  // ── 가운데: 요청 줄 · 편집기 · 응답 ──
  const methodSel = select(API_METHODS.map((m) => [m, m] as const), 'GET', (m) => (edit({ method: m as ApiMethod }), tintMethod()), 'api-method-select');
  /** 메서드 고르기 상자를 지금 메서드 색으로(배지와 같은 색) */
  const tintMethod = (): void => {
    for (const c of Object.values(METHOD_CLASS)) methodSel.classList.remove(c);
    const c = METHOD_CLASS[methodSel.value];
    if (c !== undefined) methodSel.classList.add(c);
  };
  tintMethod();
  const urlInput = el('input', 'api-url-input');
  urlInput.placeholder = '{{base_url}}/users or https://api.example.com/users';
  urlInput.spellcheck = false;
  urlInput.setAttribute('aria-label', 'Request URL');
  urlInput.addEventListener('input', () => (edit({ url: urlInput.value }), paintVars()));
  urlInput.addEventListener('keydown', (e) => {
    if (isEnterKey(e)) {
      e.preventDefault();
      void send();
    }
  });
  const sendBtn = button('Send', 'btn run api-send', () => (sending ? void cancel() : void send()));
  sendBtn.setAttribute('data-repeat-ok', '');
  const saveBtn = button('Save', 'btn', () => void saveDraft());
  const nameInput = el('input', 'api-name-input');
  nameInput.placeholder = 'Request name';
  nameInput.spellcheck = false;
  nameInput.setAttribute('aria-label', 'Request name');
  nameInput.addEventListener('input', () => edit({ name: nameInput.value }));
  // AI 시험: 고른 요청의 코드를 읽어 케이스를 만들고 로컬 서버로 돌려 본다
  const testBtn = button('Test this API', 'btn run api-test-btn', () => startTest());
  testBtn.title = 'AI reads the code behind this request, previews test cases, then runs them on your local server';
  const nameBar = el('div', 'bar api-name-bar');
  nameBar.append(nameInput, saveBtn, testBtn);
  const urlBar = el('div', 'bar api-url-bar');
  urlBar.append(methodSel, urlInput, sendBtn);
  /** URL 의 {{변수}}가 지금 환경에 있는지 색으로(있으면 파랑, 없으면 빨강) */
  const varsLine = el('div', 'api-vars-line');
  function paintVars(): void {
    const names = variablesIn(urlInput.value);
    const env = envs.items.find((e) => e.id === envs.selectedId);
    varsLine.replaceChildren();
    varsLine.hidden = names.length === 0;
    for (const n of names) {
      const v = env?.vars.find((x) => x.name === n);
      const has = v !== undefined && (v.secret ? v.has : v.value !== '');
      const chip = el('span', `chip ${has ? 'blue' : 'red'} api-var-chip`, has ? (v?.secret === true ? `${n} = ••••` : `${n} = ${(v?.value ?? '').slice(0, 40)}`) : `${n} missing`);
      chip.title = has ? `{{${n}}} comes from the ${env?.name ?? ''} environment` : `{{${n}}} is not in the selected environment. Add it in Manage.`;
      varsLine.append(chip);
    }
  }

  const editor = buildRequestEditor(() => {
    draft = editor.read(draft);
    markDirty();
  });
  const response = buildResponseView({ copy: deps.copy, say });
  response.empty();
  const requestPane = el('div', 'pane api-req');
  requestPane.append(nameBar, urlBar, varsLine, editor.root);
  const responsePane = el('div', 'pane api-res');
  const testPanel = buildTestPanel({
    api: deps.api.tests,
    say,
    ...(deps.toChat !== undefined ? { toChat: deps.toChat } : {}),
    closed: () => {
      testPanel.root.hidden = true;
      response.root.hidden = false;
      root.classList.remove('testing');
    },
  });
  testPanel.root.hidden = true;
  responsePane.append(response.root, testPanel.root);

  function startTest(): void {
    draft = editor.read({ ...draft, url: urlInput.value });
    if (!saved || collections.node(draft.id)?.origin === undefined) {
      say('AI tests read the code behind a request. Pick a request under a project folder on the left (choose the project first).');
      return;
    }
    response.root.hidden = true;
    testPanel.root.hidden = false;
    root.classList.add('testing');
    void testPanel.start(draft.id, draft);
  }
  const mainCol = el('div', 'api-main');
  mainCol.append(notice, requestPane, responsePane);

  const body = el('div', 'api-body');
  body.append(sidePane, mainCol);
  root.append(head, envHost, body);

  // ── 상태 ──
  function markDirty(): void {
    dirty = true;
    saveBtn.textContent = saved ? 'Save changes' : 'Save to collection';
    saveBtn.classList.toggle('primary', false);
  }

  function edit(patch: Partial<ApiRequestProps>): void {
    draft = { ...draft, ...patch };
    markDirty();
  }

  function loadDraft(request: ApiRequestProps, fromCollection: boolean): void {
    draft = request;
    saved = fromCollection;
    dirty = false;
    methodSel.value = request.method;
    tintMethod();
    urlInput.value = request.url;
    nameInput.value = request.name;
    editor.load(request);
    paintVars();
    // 다른 요청으로 옮기면 AI 시험 칸은 닫고 응답 칸으로 돌아간다
    testPanel.root.hidden = true;
    response.root.hidden = false;
    root.classList.remove('testing');
    saveBtn.textContent = saved ? 'Save changes' : 'Save to collection';
    const r = lastResult.get(request.id);
    if (r === undefined) response.empty();
    else response.show(r);
    setSending(false);
    paintSide();
    root.classList.remove('list-open');
  }

  function setSending(on: boolean): void {
    sending = on;
    sendBtn.textContent = on ? 'Cancel' : 'Send';
    sendBtn.classList.toggle('run', !on);
    sendBtn.classList.toggle('danger', on);
  }

  /**
   * 환경 바: 탭 맨 위 한 줄 전체. 지금 환경(색 배지) · 환경 바꾸기 · base_url 을 그 자리에서 고치기 · Manage.
   * 색으로 어디로 보내는지 한눈에: 이 컴퓨터(초록) · 원격(주황) · 운영(빨강)
   */
  function paintEnv(): void {
    envHost.replaceChildren();
    const env = envs.items.find((e) => e.id === envs.selectedId) ?? null;
    const baseVar = env?.vars.find((v) => v.name === 'base_url');
    const base = baseVar === undefined || baseVar.secret ? null : baseVar.value;
    const tone = EnvBar.tone(env?.name ?? null, base);
    envHost.className = `api-env-bar tone-${tone}`;
    const badge = el('span', 'api-env-badge', tone === 'local' ? 'LOCAL' : tone === 'prod' ? 'PROD' : tone === 'remote' ? 'REMOTE' : 'NO ENV');
    badge.title = tone === 'local' ? 'Requests go to this computer' : tone === 'prod' ? 'Careful: this looks like production' : tone === 'remote' ? 'Requests go to another server' : 'No environment: {{variables}} are not filled in';

    const opts: (readonly [string, string])[] = [['', 'No environment'], ...envs.items.map((e) => [e.id, e.name] as const)];
    const sel = select(opts, envs.selectedId ?? '', async (id) => {
      const r = await deps.api.env.apply({ kind: 'select', id: id === '' ? null : id });
      if (r.ok) envs = r.envs;
      else say(r.error);
      paintEnv();
    }, 'api-env-select');
    sel.setAttribute('aria-label', 'Environment');

    const baseInput = el('input', 'api-env-base');
    baseInput.spellcheck = false;
    baseInput.value = base ?? '';
    baseInput.placeholder = env === null ? 'Pick or create an environment first' : 'http://localhost:3000';
    baseInput.disabled = env === null;
    baseInput.setAttribute('aria-label', 'base_url of the selected environment');
    baseInput.title = 'Used wherever a request has {{base_url}}. Press Enter to save.';
    const status = el('span', 'hint api-env-saved');
    const commit = async (): Promise<void> => {
      if (env === null || baseInput.value.trim().replace(/\/+$/, '') === (base ?? '')) return;
      const r = await deps.api.env.apply({ kind: 'save', id: env.id, name: env.name, vars: EnvBar.withBaseUrl(env, baseInput.value) });
      if (!r.ok) {
        say(r.error);
        return;
      }
      envs = r.envs;
      paintEnv();
      const s = envHost.querySelector('.api-env-saved');
      if (s !== null) s.textContent = 'Saved';
    };
    baseInput.addEventListener('keydown', (e) => {
      if (isEnterKey(e)) {
        e.preventDefault();
        void commit();
      } else if (e.key === 'Escape') {
        baseInput.value = base ?? '';
        baseInput.blur();
      }
    });
    baseInput.addEventListener('change', () => void commit());

    const label = el('span', 'api-env-label', 'base_url');
    envHost.append(badge, sel, label, baseInput, status, button('Manage', 'btn sm', () => openEnvDialog({ envs: () => envs, apply: (op) => deps.api.env.apply(op), changed: (v) => ((envs = v), paintEnv()) }, envs.selectedId)));
    paintVars();
    testPanel.setTarget({ env: env?.name ?? null, baseUrl: base });
  }

  function paintSide(): void {
    sideTabs.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', (i === 0) === (side === 'collections')));
    sideTools.replaceChildren();
    if (side === 'collections') {
      sideTools.append(button('+ Request', 'btn sm', () => void actions.newRequest(null)), button('+ Folder', 'btn sm', () => void actions.newFolder(null)));
      // Git 탭처럼 고른 프로젝트의 API 만 보인다(다른 프로젝트 폴더는 숨길 뿐 지우지 않는다)
      paintCollections(listHost, collections.scopedTo(projectList.selected), open, saved ? draft.id : null, actions, (id) => {
        if (open.has(id)) open.delete(id);
        else open.add(id);
        try {
          localStorage.setItem(OPEN_KEY, JSON.stringify([...open]));
        } catch {
          /* 접힘 기억은 없어도 된다 */
        }
        paintSide();
      });
    } else {
      const clear = button('Clear history', 'btn sm', () => {
        if (history.entries.length === 0) return;
        confirmDialog('Clear history?', 'All sent requests are removed from the list. Your collections are not touched.', [
          {
            label: 'Clear',
            cls: 'btn danger',
            pick: async () => {
              history = await deps.api.history.clear();
              paintSide();
            },
          },
        ]);
      });
      sideTools.append(clear);
      paintHistory(listHost, history.entries, now(), actions);
    }
  }

  /** 컬렉션 바꾸기 결과를 반영한다. 실패하면 안내 줄에 이유를 띄운다. */
  function applied(r: CollectionResult): CollectionResult {
    if (!r.ok) {
      say(r.error);
      return r;
    }
    say('');
    collections = CollectionsDto.from(r.collections).toEntity();
    if (r.envs !== null) envs = r.envs;
    paintEnv();
    paintSide();
    return r;
  }

  /** 지금 편집 중인 요청이 저장 전에 바뀌었으면 묻고, 괜찮으면 넘어간다 */
  function leave(go: () => void): void {
    if (!dirty) return go();
    confirmDialog('Discard unsaved changes?', 'This request has changes that are not saved.', [{ label: 'Discard', cls: 'btn danger', pick: go }]);
  }

  const actions: TreeActions = {
    openRequest: (id) =>
      leave(() => {
        const r = collections.request(id);
        if (r !== undefined) loadDraft(r.props, true);
      }),
    openHistory: (entry: HistoryEntry) =>
      leave(() => {
        counter += 1;
        loadDraft({ ...entry.request, id: `draft-${counter}` }, false);
        dirty = true;
        markDirty();
      }),
    newRequest: async (parentId) =>
      leave(async () => {
        const r = applied(await deps.api.collections.apply({ kind: 'add-request', parentId, request: null }));
        if (r.ok && r.focusId !== null) {
          if (parentId !== null) open.add(parentId);
          const created = collections.request(r.focusId);
          if (created !== undefined) loadDraft(created.props, true);
          nameInput.focus();
          nameInput.select();
        }
      }),
    newFolder: async (parentId) => {
      const name = await askText({ title: 'New folder', placeholder: 'Users', ok: 'Create' });
      if (name === null) return;
      const r = applied(await deps.api.collections.apply({ kind: 'add-folder', name, parentId }));
      if (r.ok && r.focusId !== null) {
        open.add(r.focusId);
        if (parentId !== null) open.add(parentId);
        paintSide();
      }
    },
    rename: async (id, current) => {
      const name = await askText({ title: 'Rename', value: current, ok: 'Rename' });
      if (name === null) return;
      const r = applied(await deps.api.collections.apply({ kind: 'rename', id, name }));
      if (r.ok && saved && draft.id === id) {
        const again = collections.request(id);
        if (again !== undefined) {
          draft = { ...draft, name: again.name };
          nameInput.value = again.name;
        }
      }
    },
    duplicate: async (id) => {
      const r = applied(await deps.api.collections.apply({ kind: 'duplicate', id }));
      if (r.ok && r.focusId !== null) {
        const parent = collections.node(r.focusId)?.parentId;
        if (parent !== null && parent !== undefined) open.add(parent);
        paintSide();
      }
    },
    remove: (id, name, isFolder) =>
      confirmDialog(isFolder ? 'Delete this folder?' : 'Delete this request?', isFolder ? `"${name}" and everything inside it will be deleted.` : `"${name}" will be deleted.`, [
        {
          label: 'Delete',
          cls: 'btn danger',
          pick: async () => {
            const wasCurrent = saved && (draft.id === id || collections.node(draft.id) === undefined);
            const r = applied(await deps.api.collections.apply({ kind: 'remove', id }));
            if (r.ok && (wasCurrent || (saved && collections.node(draft.id) === undefined))) {
              counter += 1;
              loadDraft(ApiRequest.create({ id: `draft-${counter}` }).props, false);
            }
          },
        },
      ]),
    copyCurl: async (id) => {
      const r = await deps.api.export({ format: 'curl', id });
      if (!r.ok) return say(r.error);
      say((await deps.copy(r.text)) ? 'Copied as cURL. Secrets are written as {{variables}}.' : 'Could not copy to the clipboard.');
    },
    exportHttp: async (id) => {
      const r = await deps.api.export({ format: 'http', id }, true);
      if (!r.ok) return say(r.error);
      say(r.saved === null ? 'Export cancelled.' : `Saved ${r.fileName}. Secrets are written as {{variables}}.`);
    },
    removeHistory: async (id) => {
      history = await deps.api.history.remove(id);
      paintSide();
    },
  };

  async function saveDraft(): Promise<void> {
    draft = editor.read(draft);
    const r = applied(await deps.api.collections.apply(saved ? { kind: 'update-request', request: draft } : { kind: 'add-request', parentId: null, request: draft }));
    if (!r.ok) return;
    const stored = collections.request(r.focusId ?? draft.id);
    if (stored !== undefined) loadDraft(stored.props, true);
    say('Saved.');
  }

  async function send(): Promise<void> {
    if (sending) return;
    draft = editor.read({ ...draft, url: urlInput.value });
    setSending(true);
    response.sending();
    const key = draft.id;
    const result = await deps.api.send({ key, request: draft });
    if (draft.id !== key) {
      // 보내는 동안 다른 요청으로 옮겨 갔다: 결과는 그 요청 자리에 기억만 해 둔다
      lastResult.set(key, result);
    } else {
      lastResult.set(key, result);
      response.show(result);
      setSending(false);
    }
    if (result.ok || result.kind !== 'busy') history = await deps.api.history.get();
    if (side === 'history') paintSide();
  }

  async function cancel(): Promise<void> {
    await deps.api.cancel(draft.id);
  }

  function paintProjects(): void {
    projectHost.replaceChildren();
    const label = (p: ProjectRow): string => `${p.name}${p.source === 'frontend' ? ' (frontend)' : ''}`;
    const opts: (readonly [string, string])[] = [['', projectList.items.length === 0 ? 'No projects in the work folder' : 'Choose a project…'], ...projectList.items.map((p) => [p.root, label(p)] as const)];
    const sel = select(opts, projectList.selected ?? '', (root) => {
      if (root === '') return;
      void syncProject(root, false);
    }, 'api-project-select');
    sel.setAttribute('aria-label', 'Project');
    sel.title = 'Make requests from this project\'s API (OpenAPI file or controllers)';
    sel.disabled = syncingProject;
    refreshBtn.disabled = syncingProject || projectList.selected === null;
    refreshBtn.textContent = syncingProject ? '…' : '↻';
    projectHost.append(sel, refreshBtn);
  }

  const SOURCE_LABEL: Record<ApiSource, string> = { openapi: 'OpenAPI file', nest: 'NestJS', spring: 'Spring', express: 'Express routes', next: 'Next.js API routes' };

  /** 고른 프로젝트를 읽어 합친다. 지문이 같으면 main이 다시 읽지 않는다 */
  async function syncProject(root: string, force: boolean, quiet = false): Promise<void> {
    if (syncingProject) return;
    syncingProject = true;
    projectList = { ...projectList, selected: root };
    paintProjects();
    const name = projectList.items.find((p) => p.root === root)?.name ?? 'This project';
    if (!quiet) say(`Reading ${name}…`);
    try {
      const r = await deps.api.projects.sync({ root, force });
      if (!r.ok) return say(r.error);
      collections = CollectionsDto.from(r.collections).toEntity();
      if (r.envs !== null) envs = r.envs;
      if (r.focusId !== null && r.status === 'synced') {
        open.add(r.focusId);
        try {
          localStorage.setItem(OPEN_KEY, JSON.stringify([...open]));
        } catch {
          /* 접힘 기억은 없어도 된다 */
        }
      }
      const big = r.truncated ? ' The project is large, so only part of it was scanned.' : '';
      if (r.status === 'frontend') say(`${name} looks like a frontend repo, so no API list is made for it.`);
      else if (r.status === 'empty') say(`No API found in ${name}. Rauha reads OpenAPI JSON files and NestJS, Spring, Express and Next.js routes.${big}`);
      else if (r.status === 'synced' && r.report !== null) {
        const rp = r.report;
        const extra = [rp.added > 0 ? `${rp.added} new` : '', rp.updated > 0 ? `${rp.updated} updated` : '', rp.gone > 0 ? `${rp.gone} removed in code` : '', rp.kept > 0 ? `${rp.kept} kept with your edits` : ''].filter((x) => x !== '');
        say(`${name}: ${rp.groups} ${rp.groups === 1 ? 'group' : 'groups'}, ${rp.total} requests from ${r.source === null ? 'the code' : SOURCE_LABEL[r.source]}.${extra.length > 0 ? ` ${extra.join(', ')}.` : ''}${big}`);
      } else if (!quiet) say(r.status === 'busy' ? `Still reading ${name}…` : `${name} is up to date.`);
      projectList = await deps.api.projects.list();
      paintEnv();
      paintSide();
    } finally {
      syncingProject = false;
      paintProjects();
    }
  }

  async function importDialog(): Promise<void> {
    let format: 'curl' | 'http' | 'openapi' = 'curl';
    const hints = { curl: 'Paste a curl command (one line or several lines).', http: 'Paste the contents of a .http file (VS Code REST Client format).', openapi: 'Paste an OpenAPI 3.x JSON document. Paths become requests and the server URL becomes {{base_url}}.' };
    const text = await askText({
      title: 'Import',
      hint: hints.curl,
      multiline: true,
      placeholder: "curl -X POST https://api.example.com/users -H 'Content-Type: application/json' -d '{\"name\":\"kim\"}'",
      ok: 'Import',
      extra: (field) => {
        const wrap = el('div', 'bar');
        const hint = field.parentElement?.querySelector('.hint');
        const kind = select([['curl', 'cURL command'], ['http', '.http file'], ['openapi', 'OpenAPI JSON']] as const, 'curl', (v) => {
          format = v;
          if (hint !== null && hint !== undefined) hint.textContent = hints[v];
        });
        const file = el('input');
        file.type = 'file';
        file.accept = '.http,.rest,.json,.txt,.sh';
        file.hidden = true;
        file.addEventListener('change', async () => {
          const f = file.files?.[0];
          if (f === undefined) return;
          if (f.size > 5_000_000) return void say('That file is too large to import (5 MB limit).');
          field.value = await f.text();
          if (/\.(http|rest)$/i.test(f.name)) (kind.value = 'http'), (format = 'http');
          else if (/\.json$/i.test(f.name)) (kind.value = 'openapi'), (format = 'openapi');
        });
        wrap.append(kind, button('Choose file', 'btn', () => file.click()), file);
        return wrap;
      },
    });
    if (text === null) return;
    const r = applied(await deps.api.import({ format, text, parentId: null }));
    if (!r.ok) return;
    if (r.focusId !== null) {
      const first = collections.node(r.focusId);
      if (first?.kind === 'folder') {
        open.add(first.id);
        for (const n of collections.nodes) if (n.kind === 'folder' && n.parentId === first.id) open.add(n.id);
        paintSide();
      } else if (first?.kind === 'request') leave(() => loadDraft(first.request.props, true));
    }
    say(`Imported. ${format === 'curl' ? '' : 'Fill in the variables in Manage (for example {{token}}).'}`.trim());
  }

  // ── 시작 ──
  paintEnv();
  paintSide();
  paintProjects();
  loadDraft(draft, false);
  void (async () => {
    const [c, e, h, p] = await Promise.all([deps.api.collections.get(), deps.api.env.get(), deps.api.history.get(), deps.api.projects.list()]);
    collections = CollectionsDto.from(c satisfies CollectionsJson).toEntity();
    envs = e;
    history = h;
    projectList = p;
    paintEnv();
    paintSide();
    paintProjects();
    // 탭을 열 때 마지막에 고른 프로젝트가 바뀌었으면 다시 읽어 합친다(그대로면 main이 바로 답한다)
    if (p.selected !== null) await syncProject(p.selected, false, true);
  })();

  return { root };
}
