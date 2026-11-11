import { ApiCollections } from '../shared/api-collections.js';
import { CollectionsDto, type CollectionsJson, type EnvironmentsView, type HistoryJson } from '../shared/api-dto.js';
import type { ApiApi, CollectionResult, SendResult } from '../shared/api-ipc.js';
import { API_METHODS, ApiRequest, type ApiMethod, type ApiRequestProps } from '../shared/api-request.js';
import type { HistoryEntry } from '../shared/api-response.js';
import { el, isEnterKey } from './dom.js';
import { buildRequestEditor } from './api-editor.js';
import { openEnvDialog } from './api-env-dialog.js';
import { askText } from './api-parts.js';
import { buildResponseView } from './api-response-view.js';
import { paintCollections, paintHistory, type TreeActions } from './api-tree.js';
import { button, confirmDialog, select } from './todo-parts.js';

export interface ApiViewDeps {
  readonly api: ApiApi;
  readonly copy: (text: string) => Promise<boolean>;
  readonly now?: () => number;
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
  head.append(toggleList, el('b', undefined, 'API'), el('span', 'hint grow', 'Send requests from here. Tokens stay in environments.'), envHost, importBtn);

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
  sidePane.append(sideTabs, sideTools, listHost);

  // ── 가운데: 요청 줄 · 편집기 · 응답 ──
  const methodSel = select(API_METHODS.map((m) => [m, m] as const), 'GET', (m) => edit({ method: m as ApiMethod }), 'api-method-select');
  const urlInput = el('input', 'api-url-input');
  urlInput.placeholder = '{{base_url}}/users or https://api.example.com/users';
  urlInput.spellcheck = false;
  urlInput.setAttribute('aria-label', 'Request URL');
  urlInput.addEventListener('input', () => edit({ url: urlInput.value }));
  urlInput.addEventListener('keydown', (e) => {
    if (isEnterKey(e)) {
      e.preventDefault();
      void send();
    }
  });
  const sendBtn = button('Send', 'btn primary api-send', () => (sending ? void cancel() : void send()));
  sendBtn.setAttribute('data-repeat-ok', '');
  const saveBtn = button('Save', 'btn', () => void saveDraft());
  const nameInput = el('input', 'api-name-input');
  nameInput.placeholder = 'Request name';
  nameInput.spellcheck = false;
  nameInput.setAttribute('aria-label', 'Request name');
  nameInput.addEventListener('input', () => edit({ name: nameInput.value }));
  const nameBar = el('div', 'bar api-name-bar');
  nameBar.append(nameInput, saveBtn);
  const urlBar = el('div', 'bar api-url-bar');
  urlBar.append(methodSel, urlInput, sendBtn);

  const editor = buildRequestEditor(() => {
    draft = editor.read(draft);
    markDirty();
  });
  const response = buildResponseView({ copy: deps.copy, say });
  response.empty();
  const requestPane = el('div', 'pane api-req');
  requestPane.append(nameBar, urlBar, editor.root);
  const responsePane = el('div', 'pane api-res');
  responsePane.append(response.root);
  const mainCol = el('div', 'api-main');
  mainCol.append(notice, requestPane, responsePane);

  const body = el('div', 'api-body');
  body.append(sidePane, mainCol);
  root.append(head, body);

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
    urlInput.value = request.url;
    nameInput.value = request.name;
    editor.load(request);
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
    sendBtn.classList.toggle('primary', !on);
    sendBtn.classList.toggle('danger', on);
  }

  function paintEnv(): void {
    envHost.replaceChildren();
    const opts: (readonly [string, string])[] = [['', 'No environment'], ...envs.items.map((e) => [e.id, e.name] as const)];
    const sel = select(opts, envs.selectedId ?? '', async (id) => {
      const r = await deps.api.env.apply({ kind: 'select', id: id === '' ? null : id });
      if (r.ok) envs = r.envs;
      else say(r.error);
      paintEnv();
    }, 'api-env-select');
    sel.setAttribute('aria-label', 'Environment');
    envHost.append(sel, button('Manage', 'btn', () => openEnvDialog({ envs: () => envs, apply: (op) => deps.api.env.apply(op), changed: (v) => ((envs = v), paintEnv()) }, envs.selectedId)));
  }

  function paintSide(): void {
    sideTabs.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', (i === 0) === (side === 'collections')));
    sideTools.replaceChildren();
    if (side === 'collections') {
      sideTools.append(button('+ Request', 'btn sm', () => void actions.newRequest(null)), button('+ Folder', 'btn sm', () => void actions.newFolder(null)));
      paintCollections(listHost, collections, open, saved ? draft.id : null, actions, (id) => {
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
  loadDraft(draft, false);
  void (async () => {
    const [c, e, h] = await Promise.all([deps.api.collections.get(), deps.api.env.get(), deps.api.history.get()]);
    collections = CollectionsDto.from(c satisfies CollectionsJson).toEntity();
    envs = e;
    history = h;
    paintEnv();
    paintSide();
  })();

  return { root };
}
