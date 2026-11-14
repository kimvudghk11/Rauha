import { pathVariableNames, type ApiAuth, type ApiBody, type ApiRequestProps, type KeyValue, type MultipartPart } from '../shared/api-request.js';
import { el } from './dom.js';
import { buildAfterEditor } from './api-after-editor.js';
import { kvTable } from './api-parts.js';
import { button, select } from './todo-parts.js';

type Section = 'params' | 'headers' | 'body' | 'auth' | 'after';
const SECTIONS: readonly (readonly [Section, string])[] = [
  ['params', 'Params'],
  ['headers', 'Headers'],
  ['body', 'Body'],
  ['auth', 'Auth'],
  ['after', 'After response'],
];
const BODY_KINDS = [
  ['none', 'None'],
  ['json', 'JSON'],
  ['form', 'Form (urlencoded)'],
  ['multipart', 'Form data (multipart, files)'],
  ['raw', 'Raw text'],
] as const;

export interface EditorDeps {
  /** multipart 파일 고르기(취소하면 null) */
  readonly pickFile: () => Promise<string | null>;
}

/** multipart 표: 켜기 · 이름 · 글/파일 · 값(파일이면 경로와 고르기 단추) · 지우기 */
function multipartTable(onChange: () => void, pickFile: () => Promise<string | null>) {
  const root = el('div', 'api-kv');
  let data: MultipartPart[] = [];
  const paint = (): void => {
    root.replaceChildren();
    data.forEach((row, i) => {
      const set = (patch: Partial<MultipartPart>): void => void (data[i] = { ...(data[i] as MultipartPart), ...patch });
      const line = el('div', 'api-kv-row api-mp-row');
      const on = el('input');
      on.type = 'checkbox';
      on.checked = row.enabled;
      on.setAttribute('aria-label', 'Enabled');
      on.addEventListener('change', () => (set({ enabled: on.checked }), onChange()));
      const key = el('input', 'sm');
      key.placeholder = 'Name';
      key.value = row.key;
      key.spellcheck = false;
      key.addEventListener('input', () => (set({ key: key.value }), onChange()));
      const kind = select([['text', 'Text'], ['file', 'File']] as const, row.file ? 'file' : 'text', (v) => {
        set({ file: v === 'file', value: '' });
        paint();
        onChange();
      });
      kind.setAttribute('aria-label', 'Field type');
      const value = el('input', 'sm');
      value.spellcheck = false;
      value.value = row.value;
      value.placeholder = row.file ? 'C:\\path\\to\\file.png' : 'Value';
      value.addEventListener('input', () => (set({ value: value.value }), onChange()));
      const del = button('×', 'btn icon sm ghost', () => {
        data = data.filter((_r, j) => j !== i);
        paint();
        onChange();
      });
      del.title = 'Remove row';
      del.setAttribute('aria-label', 'Remove row');
      line.append(on, key, kind, value);
      if (row.file)
        line.append(
          button('Choose…', 'btn sm', async () => {
            const p = await pickFile();
            if (p === null) return;
            set({ value: p });
            value.value = p;
            onChange();
          }),
        );
      line.append(del);
      root.append(line);
    });
    const add = el('div', 'bar');
    add.append(
      button('+ Text field', 'btn sm', () => ((data = [...data, { key: '', value: '', enabled: true, file: false }]), paint(), onChange())),
      button('+ File', 'btn sm', () => ((data = [...data, { key: 'file', value: '', enabled: true, file: true }]), paint(), onChange())),
    );
    root.append(add);
  };
  paint();
  return {
    root,
    rows: (): MultipartPart[] => data.filter((r) => r.key !== '' || r.value !== ''),
    set: (rows: readonly MultipartPart[]): void => {
      data = rows.map((r) => ({ ...r }));
      paint();
    },
  };
}
const AUTH_KINDS = [
  ['none', 'No auth'],
  ['bearer', 'Bearer token'],
  ['basic', 'Basic auth'],
  ['apikey', 'API key'],
] as const;

export interface RequestEditor {
  readonly root: HTMLElement;
  /** 요청을 불러온다(URL·메서드·이름은 바깥 줄이 맡는다) */
  load(request: ApiRequestProps): void;
  /** 편집기가 가진 부분(쿼리·헤더·본문·인증)을 합쳐 요청으로 */
  read(base: ApiRequestProps): ApiRequestProps;
  /** URL 이 바뀌면 경로 변수(:id · {id}) 줄을 맞춘다 */
  setUrl(url: string): void;
}

/** 요청 편집기: Params · Headers · Body · Auth · After response 탭. 바뀔 때마다 onChange를 부른다. */
export function buildRequestEditor(onChange: () => void, deps: EditorDeps = { pickFile: async () => null }): RequestEditor {
  const root = el('div', 'api-editor');
  let section: Section = 'params';
  const tabs = el('div', 'tabs');
  const panels = new Map<Section, HTMLElement>();

  const params = kvTable(onChange);
  const headers = kvTable(onChange);
  const form = kvTable(onChange);
  const multipart = multipartTable(onChange, deps.pickFile);
  const after = buildAfterEditor(onChange);

  // 경로 변수: URL 에 있는 :id · {id} 마다 값 한 칸(없어진 이름의 값도 기억해 둔다)
  let pathVars: KeyValue[] = [];
  let pathNames: string[] = [];
  const pathHost = el('div', 'api-path-vars');
  const paintPath = (): void => {
    pathHost.replaceChildren();
    pathHost.hidden = pathNames.length === 0;
    if (pathNames.length === 0) return;
    pathHost.append(el('div', 'lbl', 'Path variables'));
    for (const name of pathNames) {
      const row = el('label', 'api-field');
      row.append(el('span', 'lbl mono', `:${name}`));
      const input = el('input', 'sm');
      input.spellcheck = false;
      input.placeholder = `value for ${name} (or {{variable}})`;
      input.value = pathVars.find((v) => v.key === name)?.value ?? '';
      input.addEventListener('input', () => {
        pathVars = [...pathVars.filter((v) => v.key !== name), { key: name, value: input.value, enabled: true }];
        onChange();
      });
      row.append(input);
      pathHost.append(row);
    }
  };

  // Body
  let bodyKind: ApiBody['kind'] = 'none';
  const bodyText = el('textarea', 'api-body-text mono');
  bodyText.placeholder = '{ "name": "value" }';
  bodyText.spellcheck = false;
  bodyText.addEventListener('input', onChange);
  const bodyNote = el('div', 'hint');
  const bodyKindSelect = select(BODY_KINDS, 'none', (v) => {
    bodyKind = v;
    paintBody();
    onChange();
  });
  const bodyArea = el('div', 'api-fields');
  const paintBody = (): void => {
    bodyKindSelect.value = bodyKind;
    bodyArea.replaceChildren();
    if (bodyKind === 'none') bodyArea.append(el('div', 'hint', 'This request has no body.'));
    else if (bodyKind === 'form') bodyArea.append(form.root);
    else if (bodyKind === 'multipart') bodyArea.append(multipart.root, el('div', 'hint', 'Sent as multipart/form-data. Files are read from this computer when you press Send (up to 100 MB each).'));
    else {
      bodyText.placeholder = bodyKind === 'json' ? '{ "name": "value" }' : 'Text to send as the request body';
      bodyNote.textContent = bodyKind === 'json' ? 'Sent with Content-Type: application/json. Use {{name}} for variables.' : 'Sent as is. Add a Content-Type header if the server needs one.';
      bodyArea.append(bodyText, bodyNote);
    }
  };

  // Auth
  let auth: ApiAuth = { kind: 'none' };
  const authArea = el('div', 'api-fields');
  const field = (label: string, value: string, set: (v: string) => void, placeholder: string): HTMLElement => {
    const row = el('label', 'api-field');
    row.append(el('span', 'lbl', label));
    const input = el('input');
    input.value = value;
    input.placeholder = placeholder;
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.addEventListener('input', () => {
      set(input.value);
      onChange();
    });
    row.append(input);
    return row;
  };
  const authKindSelect = select(AUTH_KINDS, 'none', (v) => {
    auth = v === 'none' ? { kind: 'none' } : v === 'bearer' ? { kind: 'bearer', token: '' } : v === 'basic' ? { kind: 'basic', username: '', password: '' } : { kind: 'apikey', name: 'X-API-Key', value: '', in: 'header' };
    paintAuth();
    onChange();
  });
  const paintAuth = (): void => {
    authKindSelect.value = auth.kind;
    authArea.replaceChildren();
    const a = auth;
    if (a.kind === 'none') authArea.append(el('div', 'hint', 'This request sends no credentials.'));
    else {
      if (a.kind === 'bearer') authArea.append(field('Token', a.token, (v) => (auth = { kind: 'bearer', token: v }), '{{token}}'));
      else if (a.kind === 'basic') {
        authArea.append(
          field('Username', a.username, (v) => (auth = { ...(auth as Extract<ApiAuth, { kind: 'basic' }>), username: v }), '{{username}}'),
          field('Password', a.password, (v) => (auth = { ...(auth as Extract<ApiAuth, { kind: 'basic' }>), password: v }), '{{password}}'),
        );
      } else {
        const where = select([['header', 'Header'], ['query', 'Query parameter']] as const, a.in, (v) => {
          auth = { ...(auth as Extract<ApiAuth, { kind: 'apikey' }>), in: v };
          onChange();
        });
        const wrap = el('label', 'api-field');
        wrap.append(el('span', 'lbl', 'Send in'), where);
        authArea.append(
          wrap,
          field('Name', a.name, (v) => (auth = { ...(auth as Extract<ApiAuth, { kind: 'apikey' }>), name: v }), 'X-API-Key'),
          field('Value', a.value, (v) => (auth = { ...(auth as Extract<ApiAuth, { kind: 'apikey' }>), value: v }), '{{api_key}}'),
        );
      }
      authArea.append(el('div', 'hint', 'Type a variable like {{token}}. A secret typed as plain text moves into the selected environment when you save, and the request keeps only its name.'));
    }
  };

  const show = (s: Section): void => {
    section = s;
    for (const [id, p] of panels) p.hidden = id !== s;
    tabs.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', SECTIONS[i]?.[0] === s));
  };
  for (const [id, label] of SECTIONS) {
    const b = el('button', 'tab', label);
    b.type = 'button';
    b.dataset['section'] = id;
    b.addEventListener('click', () => show(id));
    tabs.append(b);
  }
  const kvHint = (text: string): HTMLElement => el('div', 'hint', text);
  const mk = (id: Section, ...nodes: HTMLElement[]): void => {
    const p = el('div', 'api-panel');
    p.append(...nodes);
    panels.set(id, p);
  };
  mk('params', pathHost, params.root, kvHint('Checked rows are added to the URL as ?name=value. Write :id or {id} in the URL for a path variable.'));
  mk('headers', headers.root, kvHint('Example: Accept: application/json'));
  const bodyBar = el('div', 'bar');
  bodyBar.append(el('span', 'lbl', 'Type'), bodyKindSelect);
  mk('body', bodyBar, bodyArea);
  mk('auth', (() => {
    const bar = el('div', 'bar');
    bar.append(el('span', 'lbl', 'Type'), authKindSelect);
    return bar;
  })(), authArea);
  mk('after', after.root);
  root.append(tabs, ...panels.values());
  show(section);
  paintBody();
  paintAuth();
  paintPath();

  const badge = (): void => {
    const counts: Record<Section, number> = {
      params: params.rows().filter((r) => r.enabled).length + pathNames.length,
      headers: headers.rows().filter((r) => r.enabled).length,
      body: bodyKind === 'none' ? 0 : 1,
      auth: auth.kind === 'none' ? 0 : 1,
      after: after.count(),
    };
    tabs.querySelectorAll('button').forEach((b, i) => {
      const [id, label] = SECTIONS[i] as readonly [Section, string];
      b.textContent = counts[id] > 0 ? `${label} (${counts[id]})` : label;
    });
  };
  tabs.addEventListener('input', badge);
  root.addEventListener('input', badge);
  root.addEventListener('change', badge);

  return {
    root,
    load: (r) => {
      params.set(r.query);
      headers.set(r.headers);
      bodyKind = r.body.kind;
      bodyText.value = r.body.kind === 'json' || r.body.kind === 'raw' ? r.body.text : '';
      form.set(r.body.kind === 'form' ? r.body.fields : []);
      multipart.set(r.body.kind === 'multipart' ? r.body.parts : []);
      auth = r.auth;
      pathVars = r.pathVars.map((v) => ({ ...v }));
      pathNames = pathVariableNames(r.url);
      after.load(r.after);
      paintBody();
      paintAuth();
      paintPath();
      badge();
    },
    read: (base) => {
      const body: ApiBody = bodyKind === 'none' ? { kind: 'none' } : bodyKind === 'form' ? { kind: 'form', fields: form.rows() } : bodyKind === 'multipart' ? { kind: 'multipart', parts: multipart.rows() } : { kind: bodyKind as 'json' | 'raw', text: bodyText.value };
      // 저장하는 경로 변수는 지금 URL 에 있는 이름만
      const names = new Set(pathVariableNames(base.url));
      return { ...base, query: params.rows(), headers: headers.rows(), body, auth, pathVars: pathVars.filter((v) => names.has(v.key)), after: after.read() };
    },
    setUrl: (url) => {
      const next = pathVariableNames(url);
      if (next.join('\n') === pathNames.join('\n')) return;
      pathNames = next;
      paintPath();
      badge();
    },
  };
}
